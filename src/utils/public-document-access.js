import crypto from 'crypto';

const DEFAULT_ACCESS_DAYS = 30;

export function createPublicAccessWindow(preferredExpiry) {
  const now = new Date();
  const fallback = new Date(now.getTime() + DEFAULT_ACCESS_DAYS * 24 * 60 * 60 * 1000);
  const requested = preferredExpiry ? new Date(preferredExpiry) : null;

  return {
    token: crypto.randomBytes(32).toString('base64url'),
    expiresAt: requested && requested > now ? requested : fallback,
    revokedAt: null,
  };
}

export function publicAccessFailure(document, now = new Date()) {
  if (!document) return { statusCode: 404, error: 'Document not found' };
  if (document.publicAccessRevokedAt) return { statusCode: 410, error: 'This link has been revoked' };
  if (!document.publicAccessExpiresAt || new Date(document.publicAccessExpiresAt) <= now) {
    return { statusCode: 410, error: 'This link has expired' };
  }
  return null;
}
