import crypto from 'node:crypto';
import { decrypt, safeEqual } from '../utils/crypto.js';

export const WP_BRIDGE_REPLAY_WINDOW_SECONDS = 300;

export function canonicalSiteUrl(value) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

export function signSiteRequest(secret, { timestamp, nonce, rawBody }) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest('hex');
}

export async function verifySiteRequest({ prismaClient, siteUrl, timestamp, nonce, signature, rawBody, now = Date.now() }) {
  if (!siteUrl || !/^\d+$/.test(String(timestamp)) || !/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce || ''))) {
    return { valid: false, code: 'MALFORMED_SIGNATURE' };
  }
  const timestampSeconds = Number(timestamp);
  if (Math.abs(Math.floor(now / 1000) - timestampSeconds) > WP_BRIDGE_REPLAY_WINDOW_SECONDS) {
    return { valid: false, code: 'STALE_SIGNATURE' };
  }
  const site = await prismaClient.wPSite.findFirst({
    where: { url: canonicalSiteUrl(siteUrl) },
    select: { id: true, organizationId: true, bridgeSecretEncrypted: true }
  });
  if (!site?.organizationId || !site.bridgeSecretEncrypted) return { valid: false, code: 'SITE_NOT_PROVISIONED' };
  let secret;
  try {
    secret = decrypt(site.bridgeSecretEncrypted, { audit: true, label: `wp-bridge:${site.id}` });
  } catch {
    return { valid: false, code: 'SITE_CREDENTIAL_INVALID' };
  }
  const expected = signSiteRequest(secret, { timestamp, nonce, rawBody });
  const provided = String(signature || '').replace(/^sha256=/, '');
  if (!safeEqual(provided, expected)) return { valid: false, code: 'INVALID_SIGNATURE' };

  const nonceHash = crypto.createHash('sha256').update(String(nonce)).digest('hex');
  try {
    await prismaClient.wPBridgeNonce.create({
      data: { organizationId: site.organizationId, siteId: site.id, nonceHash }
    });
  } catch (error) {
    if (error?.code === 'P2002') return { valid: false, code: 'REPLAYED_SIGNATURE' };
    throw error;
  }
  return { valid: true, site };
}

export function issueSiteSecret() {
  return crypto.randomBytes(32).toString('base64url');
}
