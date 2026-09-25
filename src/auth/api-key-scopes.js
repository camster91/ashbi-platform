// API key scopes and lifetime policy (#416). See docs/privileged-actions.md.
//
// The catalogue is closed and mirrors what the AI bridge
// (src/routes/ai-bridge.routes.js) actually exposes to API keys:
//   - ai_bridge:read     OpenAI-compatible chat over the organization's
//                        projects, tasks, clients, threads and retainers
//                        (POST /api/ai-bridge/v1/chat/completions).
//   - ai_bridge:actions  prepare and confirm allowlisted workflow writes
//                        (POST /api/ai-bridge/v1/actions/prepare,
//                         POST /api/ai-bridge/v1/actions/:actionId/confirm).
// GET /api/ai-bridge/capabilities needs only a valid key (any scope).

export const API_KEY_SCOPE_DESCRIPTIONS = Object.freeze({
  'ai_bridge:read': 'Ask the AI bridge about this workspace (read-only chat).',
  'ai_bridge:actions': 'Prepare and confirm workflow actions (tasks, calendar events, Slack messages).',
});

export const API_KEY_SCOPES = Object.freeze(/** @type {[string, ...string[]]} */ (Object.keys(API_KEY_SCOPE_DESCRIPTIONS)));

// Proposals for owner approval (docs/privileged-actions.md).
export const API_KEY_DEFAULT_EXPIRY_DAYS = 90;
export const API_KEY_MAX_EXPIRY_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the expiry for a new key: `expiresInDays` (default 90) or an
 * absolute `expiresAt`. Returns { expiresAt } or { error }.
 * @param {{ expiresInDays?: number, expiresAt?: string }} input
 */
export function resolveApiKeyExpiry({ expiresInDays, expiresAt } = {}, { nowMs = Date.now() } = {}) {
  const max = nowMs + API_KEY_MAX_EXPIRY_DAYS * DAY_MS;
  if (expiresAt) {
    const at = new Date(expiresAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= nowMs) return { error: 'Expiry must be in the future' };
    if (at.getTime() > max) return { error: `API keys can last at most ${API_KEY_MAX_EXPIRY_DAYS} days` };
    return { expiresAt: at };
  }
  const days = expiresInDays ?? API_KEY_DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > API_KEY_MAX_EXPIRY_DAYS) {
    return { error: `API keys can last at most ${API_KEY_MAX_EXPIRY_DAYS} days` };
  }
  return { expiresAt: new Date(nowMs + days * DAY_MS) };
}

/** Audit metadata form of a scope list: sorted and joined with "+" (no spaces). */
export function scopesForAudit(scopes) {
  return [...new Set(scopes || [])].filter((scope) => API_KEY_SCOPES.includes(scope)).sort().join('+');
}

/**
 * preHandler factory: after `fastify.authenticateWithApiKey`, reject a key
 * that was not granted `scope` with 403 INSUFFICIENT_SCOPE.
 * @param {string} scope
 */
export function requireApiKeyScope(scope) {
  if (!API_KEY_SCOPES.includes(scope)) throw new Error(`Unknown API key scope: ${scope}`);
  const guard = async function requireApiKeyScopeGuard(request, reply) {
    const granted = Array.isArray(request.apiKeyScopes) ? request.apiKeyScopes : [];
    if (!granted.includes(scope)) {
      return reply.status(403).send({
        error: { message: `This API key is missing the ${scope} scope`, type: 'insufficient_scope' },
        code: 'INSUFFICIENT_SCOPE',
        requiredScope: scope,
      });
    }
    return undefined;
  };
  // Read by the API access matrix (src/tests/unit/api-access-matrix.test.js).
  guard.apiKeyScope = scope;
  return guard;
}
