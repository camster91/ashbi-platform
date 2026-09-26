// AI control plane, slice 1 (#413, docs/ai-byok.md).
//
// Every AI call made through getProvider() / aiClient passes through here:
//
//   1. platform kill switch (AI_DISABLED=true, or the operator's persisted
//      switch in platform_settings)             -> AiDisabledError('platform')
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
// AI entry points that do not use the chat provider apply the same switches:
// embeddings call `assertAllowed`, and Ash chat runs its own provider chain
// through `chatVia`, which gates it and runs the beforeCall/afterCall hooks.
//
// Slice 2 (tool registry, approval queue, adversarial evaluation) plugs in at
// `beforeCall` / `afterCall` in createAiGovernance: they see the resolved
// route (source and connection metadata, never the provider object) and the
// call options before any provider is contacted.

import { prisma as basePrisma } from '../config/db.js';
import defaultLogger from '../utils/logger.js';
import { decrypt } from '../utils/crypto.js';
import { requestStorage } from '../utils/request-context.js';
import { recordAuditEvent } from '../services/audit-event.service.js';
import { assertSafeOutboundUrl, localhostAllowedByEnv } from '../security/outbound-url-policy.js';
import { createSafeFetch } from '../security/safe-fetch.js';
import { getPlatformProvider } from './providers/platform.js';
import OpenAICompatibleProvider, { JSON_ONLY_INSTRUCTION, parseJsonReply } from './providers/openai-compatible.js';
import { estimateCostCents } from './pricing.js';
import { AiBudgetExceededError, AiControlError, AiDisabledError, AiProviderError } from './errors.js';

// Proposals for owner approval (docs/ai-byok.md):
/** How long kill switches and connections are cached per process. */
export const AI_ORG_CACHE_TTL_MS = 30_000;
/** Month-to-date spend ratio that triggers the once-a-month ai.budget_alert. */
export const AI_BUDGET_ALERT_RATIO = 0.8;
/** At most one ai.budget_exceeded audit event per organization per window. */
export const AI_BUDGET_EXCEEDED_AUDIT_WINDOW_MS = 60 * 60 * 1000;

export const PLATFORM_SETTING_ID = 'platform';
const FEATURE_MAX_LENGTH = 100;

/** First instant of the current UTC month. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function monthKey(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function envAiDisabled() {
  return process.env.AI_DISABLED === 'true';
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

/** Connection fields safe to keep in memory and hand to hooks (no ciphertext). */
function publicConnection(row) {
  if (!row) return null;
  const { encryptedApiKey: _encrypted, ...rest } = row;
  return rest;
}

/**
 * Build a BYOK provider. By default requests go through safe-fetch: the host
 * is checked against the outbound URL policy before every request and again
 * inside the socket's DNS lookup (DNS pinning), and redirects are never
 * followed. `fetchImpl` replaces the transport entirely (tests); `lookup`
 * (promise style, pre-check) and `socketLookup` (callback style, the socket's
 * own lookup) replace DNS.
 */
export function createByokProvider({ baseUrl, apiKey, model, fetchImpl, lookup, socketLookup, allowLocalhost = localhostAllowedByEnv() }) {
  let transport = fetchImpl;
  if (!transport) {
    const safeFetch = createSafeFetch({ allowLocalhost, ...(socketLookup ? { lookup: socketLookup } : {}) });
    transport = async (url, init) => {
      await assertSafeOutboundUrl(new URL(url).origin, { allowLocalhost, ...(lookup ? { lookup } : {}) });
      return safeFetch(url, init);
    };
  }
  return new OpenAICompatibleProvider({ baseUrl, apiKey, model, fetchImpl: transport });
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
  /** @type {{ expiresAt: number, disabled: boolean } | null} */
  let platformCache = null;
  /** @type {Map<string, number>} */
  const budgetExceededAuditAt = new Map();
  /** @type {Set<string>} */
  const budgetAlertSent = new Set();

  function invalidate(organizationId) {
    if (organizationId) cache.delete(organizationId);
    else cache.clear();
  }

  function invalidatePlatform() {
    platformCache = null;
  }

  /** The persisted operator switch, cached like organization state. */
  async function storedPlatformDisabled() {
    const nowMs = now().getTime();
    if (platformCache && platformCache.expiresAt > nowMs) return platformCache.disabled;
    const row = await prisma.platformSetting.findUnique({ where: { id: PLATFORM_SETTING_ID }, select: { aiDisabled: true } });
    platformCache = { expiresAt: nowMs + cacheTtlMs, disabled: Boolean(row?.aiDisabled) };
    return platformCache.disabled;
  }

  async function isPlatformDisabled() {
    if (envAiDisabled()) return true;
    return storedPlatformDisabled();
  }

  async function getPlatformStatus() {
    const envDisabled = envAiDisabled();
    const storedDisabled = await storedPlatformDisabled();
    return { disabled: envDisabled || storedDisabled, envDisabled, storedDisabled };
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
   * Kill switches only: throws AiDisabledError when AI is off for the
   * deployment or the organization. For AI entry points that do not use the
   * chat provider (embeddings).
   */
  async function assertAllowed(organizationId = getContext()?.organizationId ?? null) {
    if (await isPlatformDisabled()) throw new AiDisabledError('platform');
    if (!organizationId) return;
    const state = await loadOrgState(organizationId);
    if (state.aiDisabled) throw new AiDisabledError('organization');
  }

  /** Internal routing, including the live provider object. */
  async function route(organizationId) {
    await assertAllowed(organizationId);
    if (!organizationId) return { source: 'platform', connection: null, provider: null };
    const state = await loadOrgState(organizationId);
    if (!state.connection) return { source: 'platform', connection: null, provider: null };
    if (state.connection.status === 'disabled') {
      throw new AiControlError(
        'The workspace AI connection is disabled. An admin can validate or rotate the key in Settings.',
        { code: 'AI_CONNECTION_DISABLED', statusCode: 503 },
      );
    }
    if (state.loadError) throw state.loadError;
    return { source: 'byok', connection: state.connection, provider: state.provider };
  }

  /**
   * Where a call for this organization goes, after the kill switches.
   * Returns metadata only: the provider object stays inside this module so
   * no caller can make an unmetered, unbudgeted call.
   * @returns {Promise<{ source: 'platform' | 'byok', connection: any }>}
   */
  async function resolve(organizationId) {
    const { source, connection } = await route(organizationId);
    return { source, connection };
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

  async function recordUsage(connection, context, {
    model, promptTokens = 0, completionTokens = 0, usageEstimated = false, costCents = null, success, errorType = null,
  }) {
    try {
      await prisma.aiUsageRecord.create({
        data: {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          model: String(model).slice(0, 200),
          promptTokens,
          completionTokens,
          usageEstimated,
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
   * One governed call.
   * @param {Record<string, any>} options
   * @param {{ json: boolean, platformCall?: (options: any) => Promise<any> }} mode
   *   platformCall replaces the platform provider for callers with their own
   *   platform chain (Ash chat); it still runs behind the switches and hooks.
   */
  async function call(options = {}, { json, platformCall }) {
    const { feature, model: requestedModel, ...providerOptions } = options;
    const context = getContext() ?? null;
    const organizationId = context?.organizationId ?? null;
    const routed = await route(organizationId);
    const hookRoute = { source: routed.source, connection: routed.connection };
    const callContext = { ...context, feature: feature ?? context?.feature ?? null };
    if (beforeCall) await beforeCall({ route: hookRoute, organizationId, options: providerOptions, feature: callContext.feature });

    if (routed.source === 'platform') {
      let result;
      if (platformCall) {
        result = await platformCall(providerOptions);
      } else {
        const provider = platformProvider();
        result = json ? await provider.chatJSON(providerOptions) : await provider.chat(providerOptions);
      }
      if (afterCall) await afterCall({ route: hookRoute, organizationId, feature: callContext.feature });
      return result;
    }

    const { connection, provider } = routed;
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
    const { promptTokens, completionTokens, estimated } = completion.usage;
    // Price by the model we asked for (an allowed model with a configured
    // price), never by the id the provider reports back.
    const costCents = estimateCostCents(model, promptTokens, completionTokens);
    await recordUsage(connection, callContext, {
      model, promptTokens, completionTokens, usageEstimated: Boolean(estimated), costCents, success: true,
    });
    await maybeAlert(connection, callContext).catch((err) => {
      logger.error({ organizationId: connection.organizationId, errorName: err?.name }, 'AI budget alert check failed');
    });
    if (afterCall) await afterCall({ route: hookRoute, organizationId, feature: callContext.feature, usage: completion.usage });
    return json ? parseJsonReply(completion.content) : completion.content;
  }

  return {
    resolve,
    assertAllowed,
    invalidate,
    invalidatePlatform,
    isPlatformDisabled,
    getPlatformStatus,
    monthToDateUsage,
    chat: (options) => call(options, { json: false }),
    chatJSON: (options) => call(options, { json: true }),
    /** A text call whose platform route is `platformCall` instead of the platform provider. */
    chatVia: (options, platformCall) => call(options, { json: false, platformCall }),
    _resetThrottles() {
      budgetExceededAuditAt.clear();
      budgetAlertSent.clear();
    },
  };
}

let currentGovernance = createAiGovernance();

/**
 * The process-wide control plane used by getProvider(), aiClient, embeddings
 * and Ash chat. A stable facade over the current instance.
 */
export const aiGovernance = Object.freeze({
  resolve: (organizationId) => currentGovernance.resolve(organizationId),
  assertAllowed: (organizationId) => currentGovernance.assertAllowed(organizationId),
  invalidate: (organizationId) => currentGovernance.invalidate(organizationId),
  invalidatePlatform: () => currentGovernance.invalidatePlatform(),
  isPlatformDisabled: () => currentGovernance.isPlatformDisabled(),
  getPlatformStatus: () => currentGovernance.getPlatformStatus(),
  monthToDateUsage: (organizationId) => currentGovernance.monthToDateUsage(organizationId),
  chat: (options) => currentGovernance.chat(options),
  chatJSON: (options) => currentGovernance.chatJSON(options),
  chatVia: (options, platformCall) => currentGovernance.chatVia(options, platformCall),
});

/**
 * Test seam: route the process-wide facade to another instance (for example
 * one built on an in-memory database). Returns a function that restores the
 * previous instance.
 * @param {ReturnType<typeof createAiGovernance>} instance
 */
export function useAiGovernance(instance) {
  const previous = currentGovernance;
  currentGovernance = instance;
  return () => { currentGovernance = previous; };
}

/** Drop cached kill-switch / connection state after an admin change. */
export function invalidateAiOrganization(organizationId) {
  aiGovernance.invalidate(organizationId);
}

/** Whether AI is off for the whole deployment (env or persisted operator switch). */
export function isPlatformAiDisabled() {
  return aiGovernance.isPlatformDisabled();
}

/** { disabled, envDisabled, storedDisabled } for the deployment switch. */
export function getPlatformAiStatus() {
  return aiGovernance.getPlatformStatus();
}

/**
 * Persist the operator's deployment kill switch and drop this process's
 * cache; other processes pick it up within AI_ORG_CACHE_TTL_MS. The
 * AI_DISABLED env var still wins when it is true.
 * @param {any} prisma
 * @param {boolean} disabled
 * @param {{ actorUserId?: string | null, at?: Date }} [options]
 */
export async function setPlatformAiDisabled(prisma, disabled, { actorUserId = null, at = new Date() } = {}) {
  const data = {
    aiDisabled: Boolean(disabled),
    aiDisabledAt: disabled ? at : null,
    aiDisabledById: disabled ? actorUserId : null,
  };
  await prisma.platformSetting.upsert({
    where: { id: PLATFORM_SETTING_ID },
    create: { id: PLATFORM_SETTING_ID, ...data },
    update: data,
  });
  aiGovernance.invalidatePlatform();
}
