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

/**
 * Contact.email as stored: trimmed and lowercased, so the portal's
 * request-access and principal checks match it in any case.
 * @param {string} email
 */
export function normalizeContactEmail(email) {
  return String(email).trim().toLowerCase();
}
