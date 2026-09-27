// Upper bounds for outbound HTTP calls. Node's fetch has no default timeout,
// so a hung provider would otherwise hold a request handler or a worker slot
// (and its concurrency) indefinitely. Pass `signal: outboundSignal('...')`.

export const OUTBOUND_TIMEOUT_MS = Object.freeze({
  // Fire-and-forget notifications (Slack/Discord/Telegram/OpenClaw/Hermes,
  // user-configured workflow webhooks).
  webhook: 10_000,
  // Transactional provider APIs (Gmail, Mailgun, GitHub, Slack OAuth).
  api: 15_000,
  // OAuth token exchanges and refreshes.
  oauth: 10_000,
  // Model listings and other quick metadata probes.
  probe: 5_000,
  // Embedding generation for one text chunk.
  embedding: 30_000,
  // Non-streaming LLM chat completions (long generations on large models).
  aiChat: 120_000,
});

/** An AbortSignal that fires after the budget for `kind`. */
export function outboundSignal(kind) {
  const ms = OUTBOUND_TIMEOUT_MS[kind];
  if (!ms) throw new Error(`Unknown outbound timeout kind: ${kind}`);
  return AbortSignal.timeout(ms);
}
