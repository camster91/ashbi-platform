// Outbound URL policy for tenant-supplied endpoints (#413 BYOK base URLs).
//
// A workspace admin chooses the AI provider base URL, and the server then
// sends requests there carrying the workspace key and tenant data. Without a
// policy that is a server-side request forgery (SSRF) primitive: a base URL of
// http://169.254.169.254/ or http://10.0.0.5/ would make the API server call
// cloud metadata or internal services.
//
// Rules (applied in every environment):
//   - https only; plain http only for localhost, and only when NODE_ENV is
//     `development` or `test` (local model servers);
//   - no userinfo (user:pass@host), query string or fragment;
//   - every address the host resolves to (dns.lookup, all families) must be
//     publicly routable: loopback, private, link-local, carrier-grade NAT,
//     unique-local, multicast, documentation, discard and unspecified ranges
//     are rejected, including IPv4-mapped/-translated, 6to4 and NAT64 forms.
//     The localhost exemption above is the only exception.
//
// DNS can change after validation (rebinding), so BYOK requests are sent
// through src/security/safe-fetch.js, which runs the same address check inside
// the socket's own DNS lookup, immediately before connecting.

import dns from 'node:dns';
import { isIP } from 'node:net';

export class UnsafeOutboundUrlError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'UnsafeOutboundUrlError';
    this.code = 'UNSAFE_OUTBOUND_URL';
    this.statusCode = 400;
    this.expose = true;
  }
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Whether a URL hostname is one of the explicit localhost names. */
export function isLocalhostName(hostname) {
  return LOCALHOST_NAMES.has(String(hostname).toLowerCase());
}

/** The localhost exemption applies only in development and test. */
export function localhostAllowedByEnv() {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

function ipv4ToInt(address) {
  return address.split('.').reduce((acc, part) => (acc * 256) + Number(part), 0);
}

const BLOCKED_IPV4_CIDRS = [
  ['0.0.0.0', 8], // "this" network / unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function isBlockedIpv4(address) {
  const value = ipv4ToInt(address);
  return BLOCKED_IPV4_CIDRS.some(({ base, mask }) => ((value & mask) >>> 0) === ((base & mask) >>> 0));
}

/** Expand an IPv6 address to eight 16-bit numbers (handles embedded IPv4). */
function ipv6Words(address) {
  let text = address.split('%')[0].toLowerCase();
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    text = text.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const fill = text.includes('::') ? Array(8 - headParts.length - tailParts.length).fill('0') : [];
  return [...headParts, ...fill, ...tailParts].map((part) => parseInt(part || '0', 16));
}

function wordsToIpv4(high, low) {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isBlockedIpv6(address) {
  const w = ipv6Words(address);
  if (w.length !== 8 || w.some((n) => Number.isNaN(n))) return true;
  if (w.every((n) => n === 0)) return true; // ::
  if (w.slice(0, 7).every((n) => n === 0) && w[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (w.slice(0, 5).every((n) => n === 0) && (w[5] === 0xffff || w[5] === 0)) return isBlockedIpv4(wordsToIpv4(w[6], w[7]));
  // IPv4-translated ::ffff:0:a.b.c.d (::ffff:0:0/96, RFC 2765): never public
  if (w.slice(0, 4).every((n) => n === 0) && w[4] === 0xffff && w[5] === 0) return true;
  // NAT64 well-known prefix 64:ff9b::/96
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((n) => n === 0)) return isBlockedIpv4(wordsToIpv4(w[6], w[7]));
  // Local-use NAT64 64:ff9b:1::/48 (RFC 8215)
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return true;
  // 6to4 2002::/16 carries an IPv4 address in bits 16-47
  if (w[0] === 0x2002) return isBlockedIpv4(wordsToIpv4(w[1], w[2]));
  // Discard-only 100::/64 (RFC 6666)
  if (w[0] === 0x100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true;
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((w[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}

/**
 * Whether an IP literal is not publicly routable.
 * @param {string} address
 */
export function isNonPublicAddress(address) {
  const version = isIP(address.split('%')[0]);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

/**
 * Parse and check a tenant-supplied base URL. Throws UnsafeOutboundUrlError
 * (400, safe to show) or resolves to the parsed URL.
 *
 * @param {string} raw
 * @param {{ allowLocalhost?: boolean, lookup?: (host: string, options: { all: true, verbatim?: boolean }) => Promise<Array<{ address: string }>> }} [options]
 */
export async function assertSafeOutboundUrl(raw, { allowLocalhost = localhostAllowedByEnv(), lookup = dns.promises.lookup } = {}) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new UnsafeOutboundUrlError('Base URL must be a valid absolute URL.');
  }
  if (url.username || url.password) throw new UnsafeOutboundUrlError('Base URL must not contain credentials.');
  if (url.search || url.hash) throw new UnsafeOutboundUrlError('Base URL must not contain a query string or fragment.');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeOutboundUrlError('Base URL must use https.');

  const host = url.hostname.toLowerCase();
  if (allowLocalhost && isLocalhostName(host)) return url;
  if (url.protocol === 'http:') {
    throw new UnsafeOutboundUrlError('Base URL must use https (plain http is allowed only for localhost in development).');
  }

  const bareHost = host.replace(/^\[|\]$/g, '');
  let addresses;
  if (isIP(bareHost)) {
    addresses = [bareHost];
  } else {
    try {
      addresses = (await lookup(bareHost, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw new UnsafeOutboundUrlError('Base URL host could not be resolved.');
    }
  }
  if (!addresses.length) throw new UnsafeOutboundUrlError('Base URL host could not be resolved.');
  if (addresses.some(isNonPublicAddress)) {
    throw new UnsafeOutboundUrlError('Base URL must resolve to a public internet address.');
  }
  return url;
}
