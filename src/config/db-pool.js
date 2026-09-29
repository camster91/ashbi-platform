// pg pool settings for the Prisma driver adapter. The pg default (max 10,
// no connect timeout) was implicit; these make the per-process connection
// budget explicit and tunable. See docs/deployment-and-rollback.md
// "Database connections and timeouts" for sizing and the role-level
// statement/idle-in-transaction timeouts (set on the database role, not here).

export const DEFAULT_DATABASE_POOL_MAX = 10;
export const DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_DATABASE_POOL_CONNECT_TIMEOUT_MS = 5_000;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function databasePoolConfig(env = process.env) {
  return {
    connectionString: env.DATABASE_URL,
    max: boundedInt(env.DATABASE_POOL_MAX, DEFAULT_DATABASE_POOL_MAX, 1, 100),
    idleTimeoutMillis: boundedInt(env.DATABASE_POOL_IDLE_TIMEOUT_MS, DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_MS, 1_000, 600_000),
    connectionTimeoutMillis: boundedInt(
      env.DATABASE_POOL_CONNECT_TIMEOUT_MS,
      DEFAULT_DATABASE_POOL_CONNECT_TIMEOUT_MS,
      500,
      60_000,
    ),
  };
}
