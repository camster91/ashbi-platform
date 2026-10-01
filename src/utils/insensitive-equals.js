// @ts-check
// Case-insensitive *exact* match for Prisma string filters on PostgreSQL.
//
// Prisma compiles `{ equals: value, mode: 'insensitive' }` to `column ILIKE $1`
// and does not escape the value, so LIKE metacharacters in it act as
// wildcards: `j_hn@example.com` would match `john@example.com` and `%@x.com`
// every address at x.com. These helpers escape `\`, `%` and `_` (backslash is
// PostgreSQL's default LIKE escape character), turning the ILIKE into a plain
// case-insensitive comparison.

/**
 * Escape LIKE/ILIKE metacharacters so the value only matches itself.
 * @param {string} value
 */
export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * A Prisma string filter matching `value` exactly, ignoring case.
 * @param {string} value
 * @returns {{ equals: string, mode: 'insensitive' }}
 */
export function insensitiveEquals(value) {
  return { equals: escapeLikePattern(value), mode: 'insensitive' };
}
