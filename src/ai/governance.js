// AI control plane, slice 1 (#413, docs/ai-byok.md).
//
// Every AI call made through getProvider() / aiClient passes through here:
//
//   1. platform kill switch (AI_DISABLED=true or the operator's runtime
//      toggle)                                   -> AiDisabledError('platform')
//   2. no organization in the request/job context -> platform provider
//   3. organization aiDisabled                    -> AiDisabledError('organization')
//   4. organization BYOK connection:
//        active   -> budget check, one call to the organization's provider,
//                    one AiUsageRecord (success or failure)
//        disabled -> AiControlError AI_CONNECTION_DISABLED (never falls back)
//        revoked  -> treated as no connection
//   5. otherwise                                  -> platform provider, unchanged
//
// A BYOK failure never falls back to the platform provider and is never
// retried: the caller gets a typed error.
//
// Slice 2 (tool registry, approval queue, adversarial evaluation) plugs in at
// `beforeCall` / `afterCall` in createAiGovernance: they see the resolved
// route and the call options before any provider is contacted.

import env from '../config/env.js';
import { prisma as basePrisma } from '../config/db.js';
import defaultLogger from '../utils/logger.js';
import { decrypt } from '../utils/crypto.js';
import { requestStorage } from '../utils/request-context.js';
import { recordAuditEvent } from '../services/audit-event.service.js';
import { assertSafeOutboundUrl } from '../security/outbound-url-policy.js';
import { getPlatformProvider } from './providers/platform.js';
import OpenAICompatibleProvider, { JSON_ONLY_INSTRUCTION, parseJsonReply } from './providers/openai-compatible.js';
import { estimateCostCents } from './pricing.js';
import { AiBudgetExceededError, AiControlError, AiDisabledError, AiProviderError } from './errors.js';

// Proposals for owner approval (docs/ai-byok.md):
/** How long an organization's kill switch and connection are cached per process. */
export const AI_ORG_CACHE_TTL_MS = 30_000;
/** Month-to-date spend ratio that triggers the once-a-month ai.budget_alert. */
export const AI_BUDGET_ALERT_RATIO = 0.8;
/** At most one ai.budget_exceeded audit event per organization per window. */
export const AI_BUDGET_EXCEEDED_AUDIT_WINDOW_MS = 60 * 60 * 1000;

const FEATURE_MAX_LENGTH = 100;

/** First instant of the current UTC month. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function monthKey(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Month-to-date usage of an organization's BYOK connection.
 * @param {any} prisma raw or request-scoped client
 * @param {string} organizationId
 * @param {Date} [at]
 */
export async function computeMonthToDateUsage(prisma, organizationId, at = new Date()) {
  const since = monthStart(at);
  const [all, unpriced] = await Promise.all([
    prisma.aiUsageRecord.aggregate({
      where: { organizationId, createdAt: { gte: since } },
      _sum: { estimatedCostCents: true, promptTokens: true, completionTokens: true },
      _count: { _all: true },
    }),
    prisma.aiUsageRecord.aggregate({
      where: { organizationId, createdAt: { gte: since }, estimatedCostCents: null },
      _sum: { promptTokens: true, completionTokens: true },
    }),
  ]);
  return {
    since,
    spentCents: Number(all._sum?.estimatedCostCents ?? 0),
    promptTokens: all._sum?.promptTokens ?? 0,
    completionTokens: all._sum?.completionTokens ?? 0,
    calls: all._count?._all ?? 0,
    unpricedTokens: (unpriced._sum?.promptTokens ?? 0) + (unpriced._sum?.completionTokens ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Platform kill switch

let platformRuntimeDisabled = false;

/** Whether AI is off for the whole deployment (env or operator toggle). */
export function isPlatformAiDisabled() {
  return process.env.AI_DISABLED === 'true' || platformRuntimeDisabled;
}

/**
 * The operator's runtime toggle. It can only add to AI_DISABLED: when the env
 * switch is on, AI stays off whatever the toggle says. Process-local, like
 * the platform provider switch.
 */
export function setPlatformAiDisabled(disabled) {
  platformRuntimeDisabled = Boolean(disabled);
}

export function getPlatformAiStatus() {
  return {
    disabled: isPlatformAiDisabled(),
    envDisabled: process.env.AI_DISABLED === 'true',
    runtimeDisabled: platformRuntimeDisabled,
  };
}

// ---------------------------------------------------------------------------

/** Connection fields safe to keep in memory and return (no ciphertext). */
function publicConnection(row) {
  if (!row) return null;
  const { encryptedApiKey: _encrypted, ...rest } = row;
  return rest;
}

/**
 * Build a BYOK provider. In production the host is re-checked before every
 * request, so a DNS change after validation cannot point the key at a
 * private address.
 */
export function createByokProvider({ baseUrl, apiKey, model, isProduction = env.isProduction, fetchImpl, lookup }) {
  const baseFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const guardedFetch = isProduction
    ? async (url, init) => {
      await assertSafeOutboundUrl(new URL(url).origin, { isProduction: true, ...(lookup ? { lookup } : {}) });
      return baseFetch(url, init);
    }
    : baseFetch;
  return new OpenAICompatibleProvider({ baseUrl, apiKey, model, fetchImpl: guardedFetch });
}

/**
 * @param {{
 *   prisma?: any,
 *   logger?: any,
 *   now?: () => Date,
 *   createProvider?: (options: { baseUrl: string, apiKey: string, model: string }) => any,
 *   platformProvider?: () => any,
 *   getContext?: () => any,
 *   audit?: (prisma: any, event: any) => Promise<any>,
 *   cacheTtlMs?: number,
 *   beforeCall?: (call: any) => Promise<void> | void,
 *   afterCall?: (call: any) => Promise<void> | void,
 * }} [deps]
 */
export function createAiGovernance(deps = {}) {
  const prisma = deps.prisma ?? basePrisma;
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const createProvider = deps.createProvider ?? createByokProvider;
  const platformProvider = deps.platformProvider ?? getPlatformProvider;
  const getContext = deps.getContext ?? (() => requestStorage.getStore());
  const audit = deps.audit ?? ((client, event) => recordAuditEvent(client, event, { logger }));
  const cacheTtlMs = deps.cacheTtlMs ?? AI_ORG_CACHE_TTL_MS;
  const beforeCall = deps.beforeCall;
  const afterCall = deps.afterCall;

  /** @type {Map<string, { expiresAt: number, state: any }>} */
  const cache = new Map();
  /** @type {Map<string, number>} */
  const budgetExceededAuditAt = new Map();
  /** @type {Set<string>} */
  const budgetAlertSent = new Set();

  function invalidate(organizationId) {
    if (organizationId) cache.delete(organizationId);
    else cache.clear();
  }

  async function loadOrgState(organizationId) {
    const hit = cache.get(organizationId);
    const nowMs = now().getTime();
    if (hit && hit.expiresAt > nowMs) return hit.state;

    const [organization, row] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { aiDisabled: true } }),
      prisma.aiProviderConnection.findFirst({ where: { organizationId } }),
    ]);
    let provider = null;
    let loadError = null;
    if (row?.status === 'active') {
      try {
        provider = createProvider({ baseUrl: row.baseUrl, apiKey: decrypt(row.encryptedApiKey), model: row.defaultModel });
      } catch (err) {
        // Never log the error object: it could be a decryption failure on key
        // material. The message names only the missing key version.
        logger.error({ organizationId, connectionId: row.id, errorName: err?.name }, 'AI connection could not be loaded');
        loadError = new AiControlError(
          'The workspace AI connection could not be loaded. An admin should rotate the key in Settings.',
          { code: 'AI_CONNECTION_UNAVAILABLE', statusCode: 503 },
        );
      }
    }
    const state = {
      aiDisabled: Boolean(organization?.aiDisabled),
      connection: row && row.status !== 'revoked' ? publicConnection(row) : null,
      provider,
      loadError,
    };
    cache.set(organizationId, { expiresAt: nowMs + cacheTtlMs, state });
    return state;
  }

  /**
   * Resolve where a call for this organization goes, applying kill switches.
   * The platform provider is not instantiated here (the caller asks for it
   * only when it makes a call).
   * @returns {Promise<{ source: 'platform' } | { source: 'byok', provider: any, connection: any }>}
   */
  async function resolve(organizationId) {
    if (isPlatformAiDisabled()) throw new AiDisabledError('platform');
    if (!organizationId) return { source: 'platform' };
    const state = await loadOrgState(organizationId);
    if (state.aiDisabled) throw new AiDisabledError('organization');
    if (!state.connection) return { source: 'platform' };
    if (state.connection.status === 'disabled') {
      throw new AiControlError(
        'The workspace AI connection is disabled. An admin can validate or rotate the key in Settings.',
        { code: 'AI_CONNECTION_DISABLED', statusCode: 503 },
      );
    }
    if (state.loadError) throw state.loadError;
    return { source: 'byok', provider: state.provider, connection: state.connection };
  }

  function monthToDateUsage(organizationId) {
    return computeMonthToDateUsage(prisma, organizationId, now());
  }

  async function assertWithinBudget(connection, context) {
    const { spentCents } = await monthToDateUsage(connection.organizationId);
    if (spentCents < connection.monthlyBudgetCents) return spentCents;
    const at = now();
    const last = budgetExceededAuditAt.get(connection.organizationId) ?? 0;
    if (at.getTime() - last >= AI_BUDGET_EXCEEDED_AUDIT_WINDOW_MS) {
      budgetExceededAuditAt.set(connection.organizationId, at.getTime());
      await audit(prisma, {
        organizationId: connection.organizationId,
        actorType: 'SYSTEM',
        action: 'ai.budget_exceeded',
        entityId: connection.id,
        requestId: context?.requestId ?? null,
        metadata: { month: monthKey(at), spentCents: Math.round(spentCents), budgetCents: connection.monthlyBudgetCents },
      });
    }
    throw new AiBudgetExceededError();
  }

  async function maybeAlert(connection, context) {
    if (!(connection.monthlyBudgetCents > 0)) return;
    const at = now();
    const key = `${connection.organizationId}:${monthKey(at)}`;
    if (budgetAlertSent.has(key)) return;
    const { spentCents } = await monthToDateUsage(connection.organizationId);
    if (spentCents < connection.monthlyBudgetCents * AI_BUDGET_ALERT_RATIO) return;
    budgetAlertSent.add(key);
    // Another API instance or a restart may already have sent this month's.
    const existing = await prisma.auditEvent.findFirst({
      where: { organizationId: connection.organizationId, action: 'ai.budget_alert', createdAt: { gte: monthStart(at) } },
      select: { id: true },
    });
    if (existing) return;
    await audit(prisma, {
      organizationId: connection.organizationId,
      actorType: 'SYSTEM',
      action: 'ai.budget_alert',
      entityId: connection.id,
      requestId: context?.requestId ?? null,
      metadata: {
        month: monthKey(at),
        spentCents: Math.round(spentCents),
        budgetCents: connection.monthlyBudgetCents,
        thresholdPercent: Math.round(AI_BUDGET_ALERT_RATIO * 100),
      },
    });
  }

  async function recordUsage(connection, context, { model, promptTokens = 0, completionTokens = 0, costCents = null, success, errorType = null }) {
    try {
      await prisma.aiUsageRecord.create({
        data: {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          model: String(model).slice(0, 200),
          promptTokens,
          completionTokens,
          estimatedCostCents: costCents,
          feature: context?.feature ? String(context.feature).slice(0, FEATURE_MAX_LENGTH) : null,
          requestId: context?.requestId ? String(context.requestId).slice(0, 100) : null,
          success,
          errorType,
        },
      });
    } catch (err) {
      // Metering must not turn a successful answer into a failure, but a
      // lost record under-counts spend: alert on this log line.
      logger.error({ organizationId: connection.organizationId, connectionId: connection.id, errorCode: err?.code }, 'AI usage record write failed');
    }
  }

  function pickModel(connection, requested) {
    if (requested && (connection.allowedModels ?? []).includes(requested)) return requested;
    return connection.defaultModel;
  }

  /**
   * One governed call. `json` selects chatJSON semantics.
   * @param {Record<string, any>} options
   * @param {{ json: boolean }} mode
   */
  async function call(options = {}, { json }) {
    const { feature, model: requestedModel, ...providerOptions } = options;
    const context = getContext() ?? null;
    const organizationId = context?.organizationId ?? null;
    const route = await resolve(organizationId);
    const callContext = { ...context, feature: feature ?? context?.feature ?? null };
    if (beforeCall) await beforeCall({ route, organizationId, options: providerOptions, feature: callContext.feature });

    if (route.source === 'platform') {
      const provider = platformProvider();
      const result = json ? await provider.chatJSON(providerOptions) : await provider.chat(providerOptions);
      if (afterCall) await afterCall({ route, organizationId, feature: callContext.feature });
      return result;
    }

    const { connection, provider } = route;
    await assertWithinBudget(connection, callContext);
    const model = pickModel(connection, requestedModel);
    const system = json ? `${providerOptions.system || ''}\n\n${JSON_ONLY_INSTRUCTION}`.trim() : providerOptions.system;
    let completion;
    try {
      completion = await provider.complete({ ...providerOptions, system, model });
    } catch (err) {
      const errorType = err instanceof AiProviderError ? err.type : 'upstream';
      await recordUsage(connection, callContext, { model, success: false, errorType });
      throw err instanceof AiProviderError ? err : new AiProviderError('upstream');
    }
    const { promptTokens, completionTokens } = completion.usage;
    const costCents = estimateCostCents(completion.model, promptTokens, completionTokens)
      ?? estimateCostCents(model, promptTokens, completionTokens);
    await recordUsage(connection, callContext, { model, promptTokens, completionTokens, costCents, success: true });
    await maybeAlert(connection, callContext).catch((err) => {
      logger.error({ organizationId: connection.organizationId, errorName: err?.name }, 'AI budget alert check failed');
    });
    if (afterCall) await afterCall({ route, organizationId, feature: callContext.feature, usage: completion.usage });
    return json ? parseJsonReply(completion.content) : completion.content;
  }

  return {
    resolve,
    invalidate,
    monthToDateUsage,
    chat: (options) => call(options, { json: false }),
    chatJSON: (options) => call(options, { json: true }),
    _resetThrottles() {
      budgetExceededAuditAt.clear();
      budgetAlertSent.clear();
    },
  };
}

/** The process-wide control plane used by getProvider() and aiClient. */
export const aiGovernance = createAiGovernance();

/** Drop cached kill-switch / connection state after an admin change. */
export function invalidateAiOrganization(organizationId) {
  aiGovernance.invalidate(organizationId);
}
