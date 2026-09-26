// Organization BYOK AI connection helpers (#413, docs/ai-byok.md): masking,
// credential validation and audit-safe descriptors. The decrypted key only
// ever lives in local variables here and in the provider instance; it is never
// returned, logged or written to audit metadata.

import { assertSafeOutboundUrl } from '../security/outbound-url-policy.js';
import { createByokProvider } from '../ai/governance.js';
import { AiProviderError } from '../ai/errors.js';

/** Host (and port) of a base URL, for display and audit metadata. */
export function baseUrlHost(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

export function keyLast4(apiKey) {
  return typeof apiKey === 'string' && apiKey.length >= 8 ? apiKey.slice(-4) : null;
}

/**
 * The connection as the API returns it: an explicit allowlist of fields, so
 * the ciphertext can never leak through a new column.
 */
export function maskConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerKind: row.providerKind,
    baseUrl: row.baseUrl,
    baseUrlHost: baseUrlHost(row.baseUrl),
    keyLast4: row.keyLast4 ?? null,
    hasKey: Boolean(row.encryptedApiKey),
    allowedModels: row.allowedModels ?? [],
    defaultModel: row.defaultModel,
    monthlyBudgetCents: row.monthlyBudgetCents,
    status: row.status,
    disabledReason: row.disabledReason ?? null,
    lastValidatedAt: row.lastValidatedAt ?? null,
    lastValidationError: row.lastValidationError ?? null,
    rotatedAt: row.rotatedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prove a base URL + key work before anything is stored: the URL must pass
 * the outbound policy, then GET /v1/models must succeed and offer the default
 * model. A provider without a models endpoint (404/400) is checked with a
 * one-token completion instead. One attempt each; no retries.
 *
 * Resolves to the normalized base URL, or throws UnsafeOutboundUrlError or
 * AiProviderError.
 *
 * @param {{ baseUrl: string, apiKey: string, defaultModel: string }} input
 * @param {{ allowLocalhost?: boolean, createProvider?: typeof createByokProvider, lookup?: any }} [options]
 */
export async function validateProviderCredentials({ baseUrl, apiKey, defaultModel }, { allowLocalhost, createProvider = createByokProvider, lookup } = {}) {
  const policy = { ...(allowLocalhost === undefined ? {} : { allowLocalhost }), ...(lookup ? { lookup } : {}) };
  const url = await assertSafeOutboundUrl(baseUrl, policy);
  const normalized = url.href.replace(/\/+$/, '').replace(/\/v1$/, '');
  const provider = createProvider({ baseUrl: normalized, apiKey, model: defaultModel, ...policy });

  let models = null;
  try {
    models = await provider.listModels();
  } catch (err) {
    if (!(err instanceof AiProviderError) || err.type !== 'invalid_request') throw err;
  }
  if (models && models.length) {
    if (!models.includes(defaultModel)) throw new AiProviderError('invalid_request');
    return normalized;
  }
  await provider.complete({ prompt: 'ping', maxTokens: 1, temperature: 0, model: defaultModel });
  return normalized;
}
