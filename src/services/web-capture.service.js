// Web page review capture (docs/media-review.md "Web page review"): a staff
// member enters a URL and the server renders it in a headless browser and
// takes a full-page PNG screenshot, which becomes a review session.
//
// Rendering an arbitrary URL on the server is a server-side request forgery
// (SSRF) primitive, so every network request the browser makes is confined
// to the public internet by three independent layers:
//
//   1. The entered URL is checked up front: http or https only, no
//      credentials, an allowed port, and every address its host resolves to
//      must be publicly routable (src/security/outbound-url-policy.js:
//      loopback, private, link-local and cloud metadata, carrier-grade NAT,
//      unique-local, multicast, documentation and reserved ranges, IPv4 and
//      IPv6, including IPv4-mapped/-compatible, NAT64 and 6to4 forms).
//   2. The browser has no direct network access: it is launched with an
//      in-process egress proxy as its only route out (`--proxy-server`, with
//      the implicit loopback bypass removed by `<-loopback>`), local DNS is
//      disabled (`--host-resolver-rules` maps every name to NOTFOUND), QUIC
//      is off and WebRTC may not use non-proxied UDP. The proxy resolves
//      each host itself, refuses the request unless every address is public
//      and the port is allowed, and connects to the address it checked, so a
//      redirect, a sub-resource, an iframe or a DNS rebind to a private
//      address never leaves the machine. Plain-http WebSocket upgrades are
//      refused.
//   3. A request interceptor in the browser aborts any request that is not
//      http(s), uses a disallowed port or names a non-public IP literal, and
//      caps the number of requests; the main frame must stay on http(s)
//      (no file:, data: or other navigation).
//
// Each capture uses a fresh browser context (no cookies, storage, service
// workers, downloads or credentials) that is thrown away afterwards, runs
// under an overall deadline, clamps the page height and refuses a PNG over
// the upload limit. The browser is started through an injectable launcher so
// unit tests never need one.

import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { isIP } from 'node:net';
import env from '../config/env.js';
import { isNonPublicAddress } from '../security/outbound-url-policy.js';
import { MAX_UPLOAD_SIZE, validateUploadBuffer } from '../security/file-upload-policy.js';

export const CAPTURE_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }),
  mobile: Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }),
});
export const CAPTURE_TIMEOUT_MS = 20_000;
// Chromium cannot rasterize a screenshot taller than about 16k device
// pixels; the page is clamped below that (and so is the PNG's memory).
export const CAPTURE_MAX_DEVICE_HEIGHT = 16_000;
export const CAPTURE_ALLOWED_PORTS = Object.freeze([80, 443, 8080, 8443]);
export const CAPTURE_MAX_REQUESTS = 400;
export const CAPTURE_MAX_TRANSFER_BYTES = 100 * 1024 * 1024;
export const CAPTURE_MAX_CONCURRENT = 2;

export class WebCaptureError extends Error {
  /**
   * @param {string} code
   * @param {string} message safe to show to the staff member
   * @param {number} statusCode
   */
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'WebCaptureError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const rejected = (message) => new WebCaptureError('WEB_CAPTURE_URL_REJECTED', message, 422);

/** The effective port of an http(s) URL. */
function portOf(url) {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * Resolve a host to every address and require all of them to be public.
 * @param {string} host hostname or IP literal (IPv6 without brackets)
 * @param {{ lookup?: Function, isAllowedAddress?: (address: string) => boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function resolvePublicAddresses(host, { lookup = dns.promises.lookup, isAllowedAddress = (address) => !isNonPublicAddress(address) } = {}) {
  const bare = String(host).replace(/^\[|\]$/g, '');
  let addresses;
  if (isIP(bare)) {
    addresses = [bare];
  } else {
    try {
      addresses = (await lookup(bare, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw rejected('The address could not be resolved.');
    }
  }
  if (!addresses.length) throw rejected('The address could not be resolved.');
  if (!addresses.every((address) => isAllowedAddress(address))) {
    throw rejected('Only public web pages can be captured; this address is private, local or reserved.');
  }
  return addresses;
}

/**
 * Parse and check a URL entered for capture. Resolves to the normalized URL
 * (fragment removed) or throws WebCaptureError (422).
 * @param {string} raw
 * @param {{ lookup?: Function, isAllowedAddress?: (address: string) => boolean }} [options]
 */
export async function assertCapturableUrl(raw, options = {}) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw rejected('Enter a full web address starting with http:// or https://.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw rejected('Only http and https pages can be captured.');
  if (url.username || url.password) throw rejected('The address must not contain a user name or password.');
  if (!CAPTURE_ALLOWED_PORTS.includes(portOf(url))) throw rejected(`Only ports ${CAPTURE_ALLOWED_PORTS.join(', ')} can be captured.`);
  if (!url.hostname) throw rejected('The address has no host.');
  await resolvePublicAddresses(url.hostname, options);
  url.hash = '';
  if (url.href.length > 2048) throw rejected('The address is too long.');
  return url;
}

/** Parse the target of a CONNECT request ("host:port", IPv6 in brackets). */
function parseConnectTarget(target) {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(String(target || ''));
  if (!match) return null;
  return { host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]) };
}

/**
 * The browser's only route to the network: a local HTTP proxy that resolves
 * every host itself, refuses non-public addresses and disallowed ports, and
 * connects to the address it checked (so DNS cannot change in between).
 *
 * @param {{
 *   lookup?: Function,
 *   isAllowedAddress?: (address: string) => boolean,
 *   connect?: (options: { host: string, port: number }) => import('node:net').Socket,
 *   allowedPorts?: readonly number[],
 *   maxTransferBytes?: number,
 * }} [options]
 */
export async function startEgressProxy({
  lookup,
  isAllowedAddress,
  connect = (options) => net.connect(options),
  allowedPorts = CAPTURE_ALLOWED_PORTS,
  maxTransferBytes = CAPTURE_MAX_TRANSFER_BYTES,
} = {}) {
  const blocked = [];
  let transferred = 0;
  const sockets = new Set();
  const policy = { lookup, isAllowedAddress };

  const check = async (host, port) => {
    if (!allowedPorts.includes(port)) throw rejected('Port not allowed');
    const [address] = await resolvePublicAddresses(host, policy);
    return address;
  };
  const count = (chunk, destroy) => {
    transferred += chunk.length;
    if (transferred > maxTransferBytes) destroy();
  };
  const track = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  };

  const server = http.createServer(async (req, res) => {
    // Plain http, absolute-form request line: "GET http://host/path".
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      blocked.push(`${target.protocol}//${target.host}`);
      res.writeHead(403).end();
      return;
    }
    let address;
    try {
      address = await check(target.hostname, portOf(target));
    } catch {
      blocked.push(target.host);
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = http.request({
      host: address,
      port: portOf(target),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      // `host` is the checked IP literal, so no second DNS lookup happens.
      headers: { ...headers, host: target.host },
    }, (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.on('data', (chunk) => count(chunk, () => { response.destroy(); res.destroy(); }));
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });

  server.on('connection', track);

  // https (and wss) through CONNECT tunnels.
  server.on('connect', async (req, clientSocket, head) => {
    track(clientSocket);
    const target = parseConnectTarget(req.url);
    let address;
    try {
      if (!target) throw rejected('Bad target');
      address = await check(target.host, target.port);
    } catch {
      blocked.push(String(req.url));
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstream = connect({ host: address, port: target.port });
    track(upstream);
    upstream.on('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.on('data', (chunk) => count(chunk, () => { upstream.destroy(); clientSocket.destroy(); }));
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  // Plain-http WebSocket upgrades are refused.
  server.on('upgrade', (req, socket) => {
    blocked.push(`upgrade ${req.url}`);
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}`,
    blocked,
    get transferred() { return transferred; },
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve(undefined));
    }),
  };
}

/** Chromium flags: no direct network, no local DNS, no UDP side channels. */
export function browserArgs(proxyUrl) {
  return [
    `--proxy-server=${proxyUrl}`,
    // Chromium bypasses the proxy for localhost by default; remove that.
    '--proxy-bypass-list=<-loopback>',
    // Every name the browser would resolve itself fails; the proxy resolves.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

/**
 * Whether a request the page makes may leave the browser (layer 3; the
 * proxy re-checks every host it is asked for).
 * @param {string} rawUrl
 * @param {(address: string) => boolean} [isAllowedAddress]
 */
export function isAllowedBrowserRequest(rawUrl, isAllowedAddress = (address) => !isNonPublicAddress(address)) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true; // in-page, no network
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (!CAPTURE_ALLOWED_PORTS.includes(portOf(url))) return false;
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) && !isAllowedAddress(bare)) return false;
  return true;
}

/** The browser's environment: only what Chromium needs to start. */
export function browserEnv(source = process.env) {
  const out = { HOME: os.tmpdir(), TZ: 'UTC' };
  for (const key of ['PATH', 'LANG', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE']) {
    if (source[key]) out[key] = source[key];
  }
  return out;
}

async function defaultLauncher(options) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new WebCaptureError('WEB_CAPTURE_UNAVAILABLE', 'Web page capture is not available on this server (no browser runtime).', 503);
  }
  try {
    return await chromium.launch(options);
  } catch {
    throw new WebCaptureError('WEB_CAPTURE_UNAVAILABLE', 'Web page capture is not available on this server (the browser could not start).', 503);
  }
}

let activeCaptures = 0;

/** @param {number} ms */
function deadline(ms) {
  const end = Date.now() + ms;
  return () => Math.max(1, end - Date.now());
}

/**
 * Capture a full-page PNG of a public web page.
 *
 * @param {{ url: string, viewport?: 'desktop' | 'mobile' }} input
 * @param {{
 *   launcher?: (options: object) => Promise<any>,
 *   executablePath?: string,
 *   lookup?: Function,
 *   isAllowedAddress?: (address: string) => boolean,
 *   timeoutMs?: number,
 *   maxConcurrent?: number,
 * }} [options]
 * @returns {Promise<{ png: Buffer, url: string, finalUrl: string, viewport: string, width: number, height: number, truncated: boolean, pageTitle: string }>}
 */
export async function captureWebPage(input, {
  launcher = defaultLauncher,
  executablePath = env.webReviewChromiumPath,
  lookup,
  isAllowedAddress,
  timeoutMs = CAPTURE_TIMEOUT_MS,
  maxConcurrent = CAPTURE_MAX_CONCURRENT,
} = {}) {
  const viewportName = input.viewport === 'mobile' ? 'mobile' : 'desktop';
  const preset = CAPTURE_VIEWPORTS[viewportName];
  const url = await assertCapturableUrl(input.url, { lookup, isAllowedAddress });

  if (activeCaptures >= maxConcurrent) {
    throw new WebCaptureError('WEB_CAPTURE_BUSY', 'Another page capture is in progress. Try again in a moment.', 429);
  }
  activeCaptures += 1;
  const remaining = deadline(timeoutMs);
  let proxy;
  let browser;
  let timer;
  try {
    proxy = await startEgressProxy({ lookup, isAllowedAddress });
    const work = (async () => {
      browser = await launcher({
        headless: true,
        executablePath,
        args: browserArgs(proxy.url),
        timeout: remaining(),
        // No application secrets are handed to the browser process.
        env: browserEnv(),
      });
      const context = await browser.newContext({
        viewport: { width: preset.width, height: preset.height },
        deviceScaleFactor: preset.deviceScaleFactor,
        isMobile: preset.isMobile,
        hasTouch: preset.hasTouch,
        acceptDownloads: false,
        serviceWorkers: 'block',
        javaScriptEnabled: true,
        ignoreHTTPSErrors: false,
        permissions: [],
      });
      let requests = 0;
      await context.route('**/*', (route) => {
        requests += 1;
        if (requests > CAPTURE_MAX_REQUESTS || !isAllowedBrowserRequest(route.request().url(), isAllowedAddress)) return route.abort('blockedbyclient');
        return route.continue();
      });
      const page = await context.newPage();
      const response = await page.goto(url.href, { waitUntil: 'load', timeout: remaining() });
      const finalUrl = page.url();
      if (!/^https?:/i.test(finalUrl)) throw new WebCaptureError('WEB_CAPTURE_FAILED', 'The page navigated away from the web.', 502);
      if (!response) throw new WebCaptureError('WEB_CAPTURE_FAILED', 'The page did not respond.', 502);
      if (response.status() >= 400) throw new WebCaptureError('WEB_CAPTURE_FAILED', `The page answered HTTP ${response.status()}.`, 502);
      await page.waitForLoadState('networkidle', { timeout: Math.min(3000, remaining()) }).catch(() => {});
      // Evaluated in the page (a string, so no browser globals in this module).
      const fullHeight = await page.evaluate('Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, document.body ? document.body.scrollHeight : 0, window.innerHeight || 0)');
      const maxCssHeight = Math.floor(CAPTURE_MAX_DEVICE_HEIGHT / preset.deviceScaleFactor);
      const height = Math.max(1, Math.min(Number(fullHeight) || preset.height, maxCssHeight));
      const png = await page.screenshot({
        type: 'png',
        fullPage: true,
        clip: { x: 0, y: 0, width: preset.width, height },
        animations: 'disabled',
        timeout: remaining(),
      });
      const pageTitle = String(await page.title().catch(() => '') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { png: Buffer.from(png), finalUrl, height, truncated: Number(fullHeight) > maxCssHeight, pageTitle };
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new WebCaptureError('WEB_CAPTURE_TIMEOUT', `The page did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`, 504)), timeoutMs);
    });
    work.catch(() => {}); // settled by the race below; avoid an unhandled rejection after a timeout
    let result;
    try {
      result = await Promise.race([work, timeout]);
    } catch (err) {
      if (err instanceof WebCaptureError) throw err;
      if (/timeout/i.test(String(err?.name)) || /Timeout/.test(String(err?.message))) {
        throw new WebCaptureError('WEB_CAPTURE_TIMEOUT', `The page did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`, 504);
      }
      throw new WebCaptureError('WEB_CAPTURE_FAILED', 'The page could not be loaded.', 502);
    }
    if (result.png.length > MAX_UPLOAD_SIZE) throw new WebCaptureError('WEB_CAPTURE_TOO_LARGE', 'The screenshot is larger than the 50 MB file limit.', 422);
    if (!validateUploadBuffer(result.png, { ext: '.png' }).valid) throw new WebCaptureError('WEB_CAPTURE_FAILED', 'The browser did not produce a PNG image.', 502);
    return {
      png: result.png,
      url: url.href,
      finalUrl: result.finalUrl,
      viewport: viewportName,
      width: preset.width * preset.deviceScaleFactor,
      height: result.height * preset.deviceScaleFactor,
      truncated: result.truncated,
      pageTitle: result.pageTitle,
    };
  } finally {
    clearTimeout(timer);
    activeCaptures -= 1;
    await browser?.close().catch(() => {});
    await proxy?.close();
  }
}
