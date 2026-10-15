// Mutating fixture suites must never run against a development/customer DB.
export function assertDisposableDatabase(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { /* fail closed below */ }
  const database = url?.pathname.slice(1);
  if (env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url?.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url?.hostname)
    || !/^(?:testdb|test_[a-z0-9_]+|[a-z0-9_]+_test)$/.test(database ?? '')) {
    throw new Error('Fixture suite requires NODE_ENV=test and a loopback disposable test database');
  }
}
