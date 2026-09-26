// Minimal fetch for tenant-supplied endpoints with DNS pinning (#413).
//
// The global fetch resolves the host itself, after any pre-check we ran, so a
// host that resolves to a public address during validation can resolve to
// 127.0.0.1 or 169.254.169.254 a moment later (DNS rebinding). This client
// uses node:http / node:https with a custom `lookup`: the addresses the socket
// is about to connect to are checked by the outbound URL policy inside that
// lookup, so the checked address is the connected address. IP-literal hosts
// (which skip `lookup`) are checked before the request.
//
// Redirects are never followed (node:http does not follow them); the caller
// sees the 3xx status. Response bodies are capped.
//
// Returns a small fetch-like response: { ok, status, type, json(), text() }.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import {
  isLocalhostName,
  isNonPublicAddress,
  localhostAllowedByEnv,
  UnsafeOutboundUrlError,
} from './outbound-url-policy.js';

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * A `lookup` for http.request / net.connect that refuses non-public addresses.
 * @param {{ allowLocalhost: boolean, lookup?: typeof dns.lookup }} options
 */
export function createGuardedLookup({ allowLocalhost, lookup = dns.lookup }) {
  return function guardedLookup(hostname, options, callback) {
    const opts = typeof options === 'function' ? {} : (options ?? {});
    const cb = typeof options === 'function' ? options : callback;
    lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [];
      const exempt = allowLocalhost && isLocalhostName(hostname);
      if (!list.length || (!exempt && list.some((entry) => isNonPublicAddress(entry.address)))) {
        return cb(new UnsafeOutboundUrlError('Base URL must resolve to a public internet address.'));
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

/**
 * @param {{ allowLocalhost?: boolean, lookup?: typeof dns.lookup, maxBytes?: number }} [options]
 * @returns {(url: string, init?: { method?: string, headers?: Record<string, string>, body?: string, signal?: AbortSignal }) => Promise<any>}
 */
export function createSafeFetch({ allowLocalhost = localhostAllowedByEnv(), lookup, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const guardedLookup = createGuardedLookup({ allowLocalhost, lookup });
  return async function safeFetch(url, init = {}) {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new UnsafeOutboundUrlError('Base URL must use https.');
    }
    const exempt = allowLocalhost && isLocalhostName(target.hostname);
    if (target.protocol === 'http:' && !exempt) {
      throw new UnsafeOutboundUrlError('Base URL must use https (plain http is allowed only for localhost in development).');
    }
    const bareHost = target.hostname.replace(/^\[|\]$/g, '');
    if (isIP(bareHost) && !exempt && isNonPublicAddress(bareHost)) {
      throw new UnsafeOutboundUrlError('Base URL must resolve to a public internet address.');
    }

    const client = target.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.request(target, {
        method: init.method ?? 'GET',
        headers: init.headers,
        lookup: guardedLookup,
        signal: init.signal,
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            type: 'basic',
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      });
      request.on('error', reject);
      if (init.body) request.write(init.body);
      request.end();
    });
  };
}
