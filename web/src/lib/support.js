/**
 * Support/incident guidance for fatal error screens.
 *
 * Configure at build time:
 *   VITE_SUPPORT_URL   – http(s) link to a help desk or status/incident page
 *   VITE_SUPPORT_EMAIL – support mailbox
 * Neither is required; without them the fallback text points people to their
 * administrator instead of inventing a contact address.
 */
export const SUPPORT_FALLBACK_TEXT =
  'Contact your Ashbi Hub administrator or your usual Ashbi contact, and include the error reference.';

const EMAIL_PATTERN = /^[^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+$/;

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function getSupportContact(env = import.meta.env) {
  return {
    url: safeHttpUrl(env?.VITE_SUPPORT_URL),
    email: safeEmail(env?.VITE_SUPPORT_EMAIL),
    fallbackText: SUPPORT_FALLBACK_TEXT,
  };
}

/**
 * Short, non-identifying reference support can match against monitoring
 * (e.g. the Sentry tag set in main.jsx). Contains only time + randomness:
 * never user data, messages, or stack traces.
 */
export function createErrorReference(now = Date.now()) {
  let random = '';
  try {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }
  return `ERR-${now.toString(36).toUpperCase()}-${random.toUpperCase()}`;
}
