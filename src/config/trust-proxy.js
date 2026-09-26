// Which reverse proxies Fastify trusts for the client address (#417 security
// review, docs/deployment-and-rollback.md "Client IP behind a proxy").
//
// Behind Traefik every request arrives from the proxy's address, so without
// this `request.ip` is the proxy and every per-IP rate limit (login, MFA,
// re-authentication, intake, share links) becomes one bucket shared by every
// visitor. TRUST_PROXY accepts:
//
// - unset, empty, `false` or `0`: trust nothing (the previous behaviour);
// - a hop count `1`–`5`: trust that many proxies in front of the API. `1` is
//   the Traefik deployment: the client address is the X-Forwarded-For entry
//   Traefik appended. Fastify itself refuses bare hop counts (it cannot tell
//   whether the peer really is a proxy), so this is expressed as a trust
//   function, and is only safe when the API port is reachable exclusively
//   through the proxy;
// - a comma-separated list of proxy addresses/CIDRs or proxy-addr keywords
//   (`loopback`, `linklocal`, `uniquelocal`), e.g. `172.16.0.0/12`: the
//   stricter option, trusting only peers on the proxy's network.
//
// Anything else (notably `true`, which would let any client choose its own
// address) is ignored and nothing is trusted.

import { isIP } from 'node:net';

export const MAX_TRUST_PROXY_HOPS = 5;
const PROXY_KEYWORD = /^(loopback|linklocal|uniquelocal)$/i;

/**
 * A real IPv4/IPv6 address with an optional in-range CIDR prefix. Anything
 * Fastify's proxy-addr compiler would reject (e.g. `999.999.999.999`,
 * `10.0.0.0/99`) must be ignored here, not crash server construction.
 */
function isProxyAddress(entry) {
  const [address, prefix, extra] = entry.split('/');
  if (extra !== undefined) return false;
  const family = isIP(address);
  if (!family) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/** Fastify trust function for `hops` proxies in front of the API. */
export function trustHops(hops) {
  const trust = (_address, index) => index < hops;
  return Object.assign(trust, { hops });
}

/**
 * @param {string | undefined} value
 * @returns {{ trustProxy: false | string | ((address: string, index: number) => boolean), invalid: boolean }}
 */
export function parseTrustProxy(value) {
  const text = String(value ?? '').trim();
  if (text === '' || text.toLowerCase() === 'false' || text === '0') return { trustProxy: false, invalid: false };
  if (/^\d+$/.test(text)) {
    const hops = Number.parseInt(text, 10);
    if (hops >= 1 && hops <= MAX_TRUST_PROXY_HOPS) return { trustProxy: trustHops(hops), invalid: false };
    return { trustProxy: false, invalid: true };
  }
  const entries = text.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length && entries.every((entry) => PROXY_KEYWORD.test(entry) || isProxyAddress(entry))) {
    return { trustProxy: entries.join(','), invalid: false };
  }
  return { trustProxy: false, invalid: true };
}
