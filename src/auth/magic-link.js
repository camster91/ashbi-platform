// Client-portal magic links (POST /api/client-portal/request-access).
//
// The emailed link carries a JWT signed with the session key, so it must never
// pass as a session: it is typed `client_magic_link` (session verifiers accept
// only `session` / `client_session`), and it is single-use: redeeming it
// records its `jti`, and a second redemption of the same link is refused.

export const MAGIC_LINK_TOKEN_TYPE = 'client_magic_link';

/**
 * Record a magic link's jti as redeemed. Resolves false when the link was
 * already redeemed. Rows past the link's own expiry are pruned
 * opportunistically (an expired link fails signature verification anyway).
 * @param {any} prisma
 * @param {{ jti?: unknown, exp?: unknown }} payload verified magic-link claims
 * @param {{ now?: Date }} [options]
 */
export async function redeemMagicLink(prisma, payload, { now = new Date() } = {}) {
  const jti = payload?.jti;
  if (typeof jti !== 'string' || !jti || jti.length > 128) return false;
  const expiresAt = Number.isInteger(payload?.exp)
    ? new Date(/** @type {number} */ (payload.exp) * 1000)
    : new Date(now.getTime() + 60 * 60 * 1000);
  try {
    await prisma.clientPortalLinkRedemption.create({ data: { jti, expiresAt, redeemedAt: now } });
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'P2002') return false;
    throw err;
  }
  await prisma.clientPortalLinkRedemption.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {});
  return true;
}
