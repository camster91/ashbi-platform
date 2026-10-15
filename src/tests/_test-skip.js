// Live-API tests need a running server and remain opt-in. Mock/database
// integration suites run against the isolated CI services without this skip.

export function shouldSkipLiveApiTests() {
  if (process.env.ASHBI_RUN_LIVE_API_TESTS === '1') return false;
  if (process.env.CI) return true;
  // Local dev: still allow if user explicitly set API_BASE to a non-prod host.
  const apiBase = process.env.API_BASE || '';
  if (apiBase && !/hub\.ashbi\.ca/i.test(apiBase)) return false;
  return true;
}
