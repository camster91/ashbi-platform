// Organization bring-your-own-key AI connection (#413 slice 1,
// docs/ai-byok.md). ADMIN only. Connect, rotate, revoke and the kill switch
// also require step-up re-authentication (docs/privileged-actions.md).
//
// The API key is accepted on connect and rotate, validated against the
// provider, encrypted with src/utils/crypto.js and never returned: responses
// show only its last four characters.

import { encrypt, decrypt } from '../utils/crypto.js';
import {
  validateBody,
  aiConnectionConnectSchema,
  aiConnectionRotateSchema,
  aiConnectionSettingsSchema,
} from '../validators/schemas.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import {
  baseUrlHost,
  keyLast4,
  maskConnection,
  validateProviderCredentials,
} from '../services/ai-connection.service.js';
import {
  AI_BUDGET_ALERT_RATIO,
  computeMonthToDateUsage,
  createByokProvider,
  getPlatformAiStatus,
  invalidateAiOrganization,
} from '../ai/governance.js';
import { AiProviderError } from '../ai/errors.js';
import { UnsafeOutboundUrlError } from '../security/outbound-url-policy.js';
import { OPENAI_COMPATIBLE_KIND } from '../ai/providers/openai-compatible.js';
import { getModelPrices, unpricedModels } from '../ai/pricing.js';

function validationFailure(reply, err) {
  if (err instanceof UnsafeOutboundUrlError) {
    return reply.status(400).send({ error: err.message, code: err.code });
  }
  if (err instanceof AiProviderError) {
    return reply.status(422).send({
      error: `Validation failed: ${err.message}`,
      code: 'AI_CONNECTION_VALIDATION_FAILED',
      errorType: err.type,
    });
  }
  throw err;
}

// Budgets only count priced usage, so every model a connection may use must
// have a price (AI_MODEL_PRICES, set by the operator at deploy time).
function rejectUnpricedModels(reply, models, monthlyBudgetCents) {
  if (!(monthlyBudgetCents > 0)) return null;
  const missing = unpricedModels(models);
  if (!missing.length) return null;
  return reply.status(400).send({
    error: `No price is configured for: ${missing.join(', ')}. Ask the platform operator to add them to AI_MODEL_PRICES, or choose priced models.`,
    code: 'MODEL_PRICE_UNKNOWN',
    models: missing,
  });
}

function connectionUnavailable(reply) {
  return reply.status(503).send({
    error: 'The stored AI key could not be decrypted. Rotate the key.',
    code: 'AI_CONNECTION_UNAVAILABLE',
  });
}

function encryptionUnavailable(reply) {
  return reply.status(503).send({
    error: 'Credential encryption is not configured on this deployment.',
    code: 'CREDENTIALS_KEY_MISSING',
  });
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ createProvider?: typeof createByokProvider, lookup?: any, allowLocalhost?: boolean, now?: () => Date }} [options]
 */
export default async function aiConnectionRoutes(fastify, options = {}) {
  const createProvider = options.createProvider ?? createByokProvider;
  const now = options.now ?? (() => new Date());
  const validationOptions = {
    createProvider,
    ...(options.allowLocalhost === undefined ? {} : { allowLocalhost: options.allowLocalhost }),
    ...(options.lookup ? { lookup: options.lookup } : {}),
  };

  const orgId = (request) => request.user.organizationId;
  const findConnection = (request) => request.prisma.aiProviderConnection.findFirst({
    where: { organizationId: orgId(request) },
  });

  async function view(request) {
    const [connection, organization, usage] = await Promise.all([
      findConnection(request),
      request.prisma.organization.findUnique({ where: { id: orgId(request) }, select: { aiDisabled: true } }),
      computeMonthToDateUsage(request.prisma, orgId(request), now()),
    ]);
    return {
      connection: maskConnection(connection),
      aiDisabled: Boolean(organization?.aiDisabled),
      platformAiDisabled: (await getPlatformAiStatus()).disabled,
      // Models with a configured price (AI_MODEL_PRICES); every allowed model
      // must be one of these so the budget counts all usage.
      pricedModels: Object.keys(getModelPrices()).sort(),
      usage: {
        since: usage.since,
        calls: usage.calls,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        unpricedTokens: usage.unpricedTokens,
        spentCents: Math.round(usage.spentCents * 100) / 100,
        budgetCents: connection?.monthlyBudgetCents ?? null,
        alertThresholdPercent: Math.round(AI_BUDGET_ALERT_RATIO * 100),
      },
    };
  }

  fastify.get('/', { onRequest: [fastify.adminOnly] }, async (request) => view(request));

  // Connect (or replace) the organization's connection. Nothing is stored
  // unless the provider accepts the key.
  fastify.post('/connect', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(aiConnectionConnectSchema)],
  }, async (request, reply) => {
    const { baseUrl, apiKey, allowedModels, defaultModel, monthlyBudgetCents } = request.body;
    const unpriced = rejectUnpricedModels(reply, [defaultModel, ...allowedModels], monthlyBudgetCents);
    if (unpriced) return unpriced;
    let normalizedBaseUrl;
    try {
      normalizedBaseUrl = await validateProviderCredentials({ baseUrl, apiKey, defaultModel }, validationOptions);
    } catch (err) {
      return validationFailure(reply, err);
    }
    let encryptedApiKey;
    try {
      encryptedApiKey = encrypt(apiKey);
    } catch {
      return encryptionUnavailable(reply);
    }
    const existing = await findConnection(request);
    const at = now();
    const data = {
      providerKind: OPENAI_COMPATIBLE_KIND,
      baseUrl: normalizedBaseUrl,
      encryptedApiKey,
      keyLast4: keyLast4(apiKey),
      allowedModels: [...new Set(allowedModels)],
      defaultModel,
      monthlyBudgetCents,
      status: 'active',
      disabledReason: null,
      lastValidatedAt: at,
      lastValidationError: null,
      createdById: request.user.id,
      rotatedAt: null,
      revokedAt: null,
    };
    const connection = await request.prisma.aiProviderConnection.upsert({
      where: { organizationId: orgId(request) },
      create: { ...data, organizationId: orgId(request) },
      update: data,
    });
    invalidateAiOrganization(orgId(request));
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'ai.connection_connected',
      entityId: connection.id,
      metadata: {
        keyLast4: connection.keyLast4,
        baseUrlHost: baseUrlHost(connection.baseUrl),
        defaultModel,
        allowedModelCount: connection.allowedModels.length,
        monthlyBudgetCents,
        replacedStatus: existing?.status ?? null,
      },
    });
    return reply.status(201).send({ connection: maskConnection(connection) });
  });

  // Re-check the stored key. A rejected key (auth) disables the connection so
  // AI calls fail fast with AI_CONNECTION_DISABLED; a later success re-enables
  // it. Transient failures (timeout, upstream, rate limit) change nothing but
  // the recorded result.
  fastify.post('/validate', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    const connection = await findConnection(request);
    if (!connection || connection.status === 'revoked' || !connection.encryptedApiKey) {
      return reply.status(404).send({ error: 'No AI connection to validate', code: 'AI_CONNECTION_NOT_FOUND' });
    }
    let apiKey;
    try {
      apiKey = decrypt(connection.encryptedApiKey);
    } catch {
      return connectionUnavailable(reply);
    }
    let errorType = null;
    try {
      await validateProviderCredentials({
        baseUrl: connection.baseUrl,
        apiKey,
        defaultModel: connection.defaultModel,
      }, validationOptions);
    } catch (err) {
      if (err instanceof AiProviderError) errorType = err.type;
      else if (err instanceof UnsafeOutboundUrlError) errorType = 'unsafe_url';
      else throw err;
    }
    const at = now();
    const data = { lastValidatedAt: at, lastValidationError: errorType };
    if (!errorType) {
      data.status = 'active';
      data.disabledReason = null;
    } else if (errorType === 'auth' || errorType === 'unsafe_url') {
      data.status = 'disabled';
      data.disabledReason = `validation_failed:${errorType}`;
    }
    const updated = await request.prisma.aiProviderConnection.update({
      where: { organizationId: orgId(request) },
      data,
    });
    invalidateAiOrganization(orgId(request));
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'ai.connection_validated',
      entityId: updated.id,
      metadata: {
        keyLast4: updated.keyLast4,
        baseUrlHost: baseUrlHost(updated.baseUrl),
        result: errorType ? 'failed' : 'ok',
        errorType,
        fromStatus: connection.status,
        toStatus: updated.status,
      },
    });
    return { valid: !errorType, errorType, connection: maskConnection(updated) };
  });

  // Replace the key. The new key is validated first; on failure the old key
  // stays in place untouched.
  fastify.post('/rotate', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(aiConnectionRotateSchema)],
  }, async (request, reply) => {
    const connection = await findConnection(request);
    if (!connection || connection.status === 'revoked') {
      return reply.status(404).send({ error: 'No AI connection to rotate. Connect a provider instead.', code: 'AI_CONNECTION_NOT_FOUND' });
    }
    const { apiKey } = request.body;
    try {
      await validateProviderCredentials({ baseUrl: connection.baseUrl, apiKey, defaultModel: connection.defaultModel }, validationOptions);
    } catch (err) {
      return validationFailure(reply, err);
    }
    let encryptedApiKey;
    try {
      encryptedApiKey = encrypt(apiKey);
    } catch {
      return encryptionUnavailable(reply);
    }
    const at = now();
    const updated = await request.prisma.aiProviderConnection.update({
      where: { organizationId: orgId(request) },
      data: {
        encryptedApiKey,
        keyLast4: keyLast4(apiKey),
        rotatedAt: at,
        lastValidatedAt: at,
        lastValidationError: null,
        status: 'active',
        disabledReason: null,
      },
    });
    invalidateAiOrganization(orgId(request));
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'ai.connection_rotated',
      entityId: updated.id,
      metadata: { keyLast4: updated.keyLast4, previousKeyLast4: connection.keyLast4, baseUrlHost: baseUrlHost(updated.baseUrl) },
    });
    return { connection: maskConnection(updated) };
  });

  // Revoke: wipe the ciphertext. AI falls back to the platform provider.
  fastify.post('/revoke', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth],
  }, async (request, reply) => {
    const connection = await findConnection(request);
    if (!connection || connection.status === 'revoked') {
      return reply.status(404).send({ error: 'No AI connection to revoke', code: 'AI_CONNECTION_NOT_FOUND' });
    }
    const updated = await request.prisma.aiProviderConnection.update({
      where: { organizationId: orgId(request) },
      data: { encryptedApiKey: null, status: 'revoked', revokedAt: now(), disabledReason: null },
    });
    invalidateAiOrganization(orgId(request));
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'ai.connection_revoked',
      entityId: updated.id,
      metadata: { keyLast4: updated.keyLast4, baseUrlHost: baseUrlHost(updated.baseUrl), fromStatus: connection.status },
    });
    return { connection: maskConnection(updated) };
  });

  fastify.patch('/settings', {
    onRequest: [fastify.adminOnly],
    preHandler: [validateBody(aiConnectionSettingsSchema)],
  }, async (request, reply) => {
    const connection = await findConnection(request);
    if (!connection || connection.status === 'revoked') {
      return reply.status(404).send({ error: 'No AI connection to update', code: 'AI_CONNECTION_NOT_FOUND' });
    }
    const allowedModels = request.body.allowedModels ? [...new Set(request.body.allowedModels)] : connection.allowedModels;
    const defaultModel = request.body.defaultModel ?? connection.defaultModel;
    if (!allowedModels.includes(defaultModel)) {
      return reply.status(400).send({ error: 'defaultModel must be one of allowedModels' });
    }
    const monthlyBudgetCents = request.body.monthlyBudgetCents ?? connection.monthlyBudgetCents;
    const unpriced = rejectUnpricedModels(reply, [defaultModel, ...allowedModels], monthlyBudgetCents);
    if (unpriced) return unpriced;
    const updated = await request.prisma.aiProviderConnection.update({
      where: { organizationId: orgId(request) },
      data: { allowedModels, defaultModel, monthlyBudgetCents },
    });
    invalidateAiOrganization(orgId(request));
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'ai.connection_settings_changed',
      entityId: updated.id,
      metadata: {
        fromDefaultModel: connection.defaultModel,
        toDefaultModel: updated.defaultModel,
        fromMonthlyBudgetCents: connection.monthlyBudgetCents,
        toMonthlyBudgetCents: updated.monthlyBudgetCents,
        allowedModelCount: updated.allowedModels.length,
      },
    });
    return { connection: maskConnection(updated) };
  });

  // Organization kill switch: every AI call for this workspace, BYOK or
  // platform, fails with AI_DISABLED while it is on.
  async function setOrganizationAiDisabled(request, disabled) {
    await request.prisma.organization.update({ where: { id: orgId(request) }, data: { aiDisabled: disabled } });
    invalidateAiOrganization(orgId(request));
    await recordRequestAuditEvent(request.prisma, request, {
      action: disabled ? 'ai.disabled' : 'ai.enabled',
      entityId: orgId(request),
      metadata: { scope: 'organization' },
    });
    return view(request);
  }

  fastify.post('/disable', { onRequest: [fastify.adminOnly], preHandler: [requireRecentAuth] }, async (request) => (
    setOrganizationAiDisabled(request, true)
  ));

  fastify.post('/enable', { onRequest: [fastify.adminOnly], preHandler: [requireRecentAuth] }, async (request) => (
    setOrganizationAiDisabled(request, false)
  ));
}
