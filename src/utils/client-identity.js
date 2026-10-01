// @ts-check
// How client domains and contact emails are stored, for every writer (the
// client routes, inbox/lead conversion, onboarding, invitations, importers).

/**
 * Client.domain as stored: trimmed and lowercased, with '' or whitespace-only
 * stored as NULL (domains are unique per organization, and NULL never
 * conflicts). `undefined` stays `undefined` (field not sent on update).
 * @param {unknown} domain
 * @returns {string | null | undefined}
 */
export function normalizeClientDomain(domain) {
  if (domain === undefined) return undefined;
  if (domain === null) return null;
  const value = String(domain).trim().toLowerCase();
  return value === '' ? null : value;
}

/** Consumer mailbox providers: their domain identifies no client. */
export const FREE_EMAIL_PROVIDERS = Object.freeze([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
]);

/**
 * Whether `domain` is a consumer mailbox provider (any case).
 * @param {unknown} domain
 */
export function isFreeEmailDomain(domain) {
  return FREE_EMAIL_PROVIDERS.includes(String(domain ?? '').trim().toLowerCase());
}

/**
 * The client domain an email address implies: its normalized domain, or null
 * for a consumer mailbox provider (gmail.com is nobody's company domain) or
 * an address without one.
 * @param {unknown} email
 * @returns {string | null}
 */
export function clientDomainFromEmail(email) {
  const domain = normalizeClientDomain(String(email ?? '').split('@')[1] ?? null) ?? null;
  return domain && !isFreeEmailDomain(domain) ? domain : null;
}

/**
 * Contact.email as stored: trimmed and lowercased, so the portal's
 * request-access and principal checks match it in any case.
 * @param {string} email
 */
export function normalizeContactEmail(email) {
  return String(email).trim().toLowerCase();
}
