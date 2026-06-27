// Pagination / query bounds for list endpoints.
//
// Defaults and hard caps for `take` so a single client cannot request an
// unbounded number of rows. Used by routes that accept a user-supplied
// `?limit=` query param and by routes that fetch lists without an explicit
// cap. The hard cap also acts as a backstop if a handler forgets to pass
// `take` to a Prisma `findMany` call (defense-in-depth — the soft-delete
// extension in src/config/db.js caps at 100 for SOFT_DELETE_MODELS, but
// that's narrower than the model set).

export const DEFAULT_TAKE = 50;
export const MAX_TAKE = 200;

/**
 * Clamp a user-supplied limit value to a safe range.
 *
 * @param {unknown} input - The raw value (typically request.query.limit as a string).
 * @param {object} [opts]
 * @param {number} [opts.defaultTake=DEFAULT_TAKE] - Returned when input is missing/invalid.
 * @param {number} [opts.maxTake=MAX_TAKE] - Hard upper bound.
 * @returns {number} A positive integer in [1, maxTake], or `defaultTake` if input is missing/invalid.
 */
export function clampTake(input, opts = {}) {
  const defaultTake = opts.defaultTake ?? DEFAULT_TAKE;
  const maxTake = opts.maxTake ?? MAX_TAKE;
  const n = typeof input === 'number' ? input : parseInt(input, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultTake;
  return Math.min(n, maxTake);
}