// Helper for live-API tests — they hit a real running server (e.g.,
// hub.ashbi.ca) and are meant for local development. In CI they have no API
// to talk to and fail with network errors. Detection: process.env.CI, or
// API_BASE pointing at the production domain. Force-run by setting
// ASHBI_RUN_LIVE_API_TESTS=1.
export function shouldSkipLiveApiTests() {
  if (process.env.ASHBI_RUN_LIVE_API_TESTS === '1') return false;
  if (process.env.CI) return true;
  // Local dev: still allow if user explicitly set API_BASE to a non-prod host.
  const apiBase = process.env.API_BASE || '';
  if (apiBase && !/hub\.ashbi\.ca/i.test(apiBase)) return false;
  return true;
}
