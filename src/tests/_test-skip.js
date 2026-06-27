// Helpers for tests that can't run cleanly in CI.
//
// Two flavors:
//
// 1. Live-API tests — they hit a real running server (e.g., hub.ashbi.ca) and
//    are meant for local development. In CI they have no API to talk to and
//    fail with network errors. Detection: process.env.CI, or API_BASE pointing
//    at the production domain. Force-run by setting
//    ASHBI_RUN_LIVE_API_TESTS=1.
//
// 2. Heavy-import tests — they import route files that transitively load
//    ai/client.js, jobs/queue.js, etc. (which need API keys / Redis at
//    module-eval time). These hang in CI because the side-effects never
//    resolve. Detection: process.env.CI. Force-run by setting
//    ASHBI_RUN_HEAVY_TESTS=1 (then locally with API keys in env).

export function shouldSkipLiveApiTests() {
  if (process.env.ASHBI_RUN_LIVE_API_TESTS === '1') return false;
  if (process.env.CI) return true;
  // Local dev: still allow if user explicitly set API_BASE to a non-prod host.
  const apiBase = process.env.API_BASE || '';
  if (apiBase && !/hub\.ashbi\.ca/i.test(apiBase)) return false;
  return true;
}

export function shouldSkipHeavyTests() {
  if (process.env.ASHBI_RUN_HEAVY_TESTS === '1') return false;
  return !!process.env.CI;
}