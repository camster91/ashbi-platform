// Web page review capture (docs/media-review.md "Web page review"): the SSRF
// policy for the entered URL, the egress proxy that is the browser's only
// route out (real local sockets), the in-browser request filter, and the
// capture flow with an injected fake browser.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';

const {
  CAPTURE_MAX_DEVICE_HEIGHT,
  WebCaptureError,
  assertCapturableUrl,
  browserArgs,
  browserEnv,
  captureWebPage,
  isAllowedBrowserRequest,
  startEgressProxy,
} = await import('../../services/web-capture.service.js');

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

/** A dns.promises.lookup stand-in: host -> addresses. */
function fakeLookup(table) {
  return async (host) => {
    const entry = table[host];
    if (!entry) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return entry.map((address) => ({ address, family: net.isIP(address) }));
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof WebCaptureError && err.code === code);
}

describe('capture URL policy', () => {
  const lookup = fakeLookup({
    'example.com': [PUBLIC_V4, PUBLIC_V6],
    'localhost': ['127.0.0.1'],
    'intranet.corp': ['10.1.2.3'],
    'metadata.cloud': ['169.254.169.254'],
    'cgnat.isp': ['100.64.0.1'],
    'ula.site': ['fd12:3456::1'],
    'linklocal.site': ['fe80::1'],
    'mapped.site': ['::ffff:127.0.0.1'],
    'mapped-metadata.site': ['::ffff:a9fe:a9fe'],
    'nat64.site': ['64:ff9b::a00:1'],
    'mixed.site': [PUBLIC_V4, '192.168.1.10'],
  });

  it('accepts public http(s) pages and drops the fragment', async () => {
    assert.equal((await assertCapturableUrl('https://example.com/pricing?plan=pro#top', { lookup })).href, 'https://example.com/pricing?plan=pro');
    assert.equal((await assertCapturableUrl('http://example.com:8080/', { lookup })).href, 'http://example.com:8080/');
    assert.equal((await assertCapturableUrl(`https://[${PUBLIC_V6}]/`, { lookup })).hostname, `[${PUBLIC_V6}]`);
  });

  it('refuses other schemes, credentials and unusual ports', async () => {
    for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'ws://example.com/', 'gopher://example.com/', 'not a url', '']) {
      await rejectsWith(assertCapturableUrl(url, { lookup }), 'WEB_CAPTURE_URL_REJECTED');
    }
    await rejectsWith(assertCapturableUrl('https://user:pass@example.com/', { lookup }), 'WEB_CAPTURE_URL_REJECTED');
    await rejectsWith(assertCapturableUrl('http://example.com:22/', { lookup }), 'WEB_CAPTURE_URL_REJECTED');
    await rejectsWith(assertCapturableUrl('http://example.com:6379/', { lookup }), 'WEB_CAPTURE_URL_REJECTED');
  });

  it('refuses private, loopback, link-local, metadata, CGNAT and unique-local addresses, in every form', async () => {
    for (const url of [
      'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0.0.0.0/',
      'http://10.0.0.1/', 'http://172.16.5.4/', 'http://192.168.0.1/', 'http://169.254.169.254/latest/meta-data',
      'http://100.64.1.1/', 'http://[::1]/', 'http://[::]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::ffff:10.0.0.1]/', 'http://[64:ff9b::a9fe:a9fe]/',
      'http://[2002:7f00:1::]/', 'http://localhost/', 'http://intranet.corp/', 'http://metadata.cloud/', 'http://cgnat.isp/',
      'http://ula.site/', 'http://linklocal.site/', 'http://mapped.site/', 'http://mapped-metadata.site/', 'http://nat64.site/',
      // One private address among public ones is enough to refuse.
      'http://mixed.site/',
      // Unresolvable.
      'http://nowhere.invalid/',
    ]) {
      await rejectsWith(assertCapturableUrl(url, { lookup }), 'WEB_CAPTURE_URL_REJECTED');
    }
  });

  it('answers unresolvable and private hosts with the same message, so internal names cannot be mapped', async () => {
    const messageFor = async (url) => {
      try {
        await assertCapturableUrl(url, { lookup });
      } catch (error) {
        return error.message;
      }
      return null;
    };
    const unresolvable = await messageFor('http://nowhere.invalid/');
    assert.ok(unresolvable);
    assert.equal(await messageFor('http://intranet.corp/'), unresolvable);
    assert.equal(await messageFor('http://10.0.0.1/'), unresolvable);
  });

  it('filters what the page itself requests', () => {
    assert.equal(isAllowedBrowserRequest('https://cdn.example.com/app.js'), true);
    assert.equal(isAllowedBrowserRequest(`http://${PUBLIC_V4}/img.png`), true);
    assert.equal(isAllowedBrowserRequest('data:image/png;base64,AAAA'), true);
    for (const url of [
      'http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:8080/', 'http://[::1]/', 'http://[::ffff:10.0.0.1]/',
      'http://192.168.1.1/', 'file:///etc/passwd', 'ftp://example.com/', 'chrome://settings', 'https://example.com:6379/',
      'https://user:pw@example.com/', 'not a url',
    ]) {
      assert.equal(isAllowedBrowserRequest(url), false, url);
    }
  });

  it('launches the browser with no direct network, no local DNS and no application secrets', () => {
    const args = browserArgs('http://127.0.0.1:4321');
    assert.ok(args.includes('--proxy-server=http://127.0.0.1:4321'));
    assert.ok(args.includes('--proxy-bypass-list=<-loopback>'));
    assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'));
    assert.ok(args.includes('--disable-quic'));
    assert.ok(args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
    const envOut = browserEnv({ PATH: '/usr/bin', JWT_SECRET: 's', DATABASE_URL: 'postgres://x', CREDENTIALS_KEY: 'k' });
    assert.deepEqual(Object.keys(envOut).sort(), ['HOME', 'PATH', 'TZ']);
  });
});

describe('capture egress proxy', () => {
  let origin;
  let originPort;
  const originHits = [];
  let echo;
  let echoPort;

  before(async () => {
    origin = http.createServer((req, res) => {
      originHits.push(`${req.method} ${req.url} host=${req.headers.host}`);
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://10.0.0.1/secret' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello from origin');
    });
    await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
    originPort = origin.address().port;
    echo = net.createServer((socket) => socket.pipe(socket));
    await new Promise((resolve) => echo.listen(0, '127.0.0.1', resolve));
    echoPort = echo.address().port;
  });
  after(async () => {
    await new Promise((resolve) => origin.close(resolve));
    await new Promise((resolve) => echo.close(resolve));
  });

  /** Send a raw request to the proxy and collect the reply until close or `until`. */
  function raw(proxyUrl, text, { until, write } = {}) {
    const { port } = new URL(proxyUrl);
    return new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString('latin1');
        if (write && data.includes('200 Connection Established') && !socket.wrote) {
          socket.wrote = true;
          socket.write(write);
        }
        if (until && data.includes(until)) socket.end();
      });
      socket.on('close', () => resolve(data));
      socket.on('error', () => resolve(data));
      socket.write(text);
      setTimeout(() => socket.destroy(), 2000);
    });
  }

  it('tunnels only to public addresses on allowed ports, connecting to the address it checked', async () => {
    const connects = [];
    const proxy = await startEgressProxy({
      lookup: fakeLookup({ 'public.test': [PUBLIC_V4], 'private.test': ['10.0.0.8'], 'metadata.test': ['169.254.169.254'] }),
      // The upstream is a local echo server standing in for PUBLIC_V4:443.
      connect: (options) => {
        connects.push(options);
        return net.connect({ host: '127.0.0.1', port: echoPort });
      },
    });
    try {
      const ok = await raw(proxy.url, 'CONNECT public.test:443 HTTP/1.1\r\nHost: public.test:443\r\n\r\n', { write: 'ping', until: 'ping' });
      assert.match(ok, /^HTTP\/1\.1 200 Connection Established/);
      assert.ok(ok.endsWith('ping'));
      assert.deepEqual(connects, [{ host: PUBLIC_V4, port: 443 }]);

      for (const target of ['private.test:443', 'metadata.test:443', '127.0.0.1:443', '[::1]:443', '[::ffff:127.0.0.1]:443', '169.254.169.254:443', 'public.test:22', 'nowhere.test:443', 'garbage']) {
        const refused = await raw(proxy.url, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
        assert.match(refused, /^HTTP\/1\.1 403 Forbidden/, target);
      }
      assert.equal(connects.length, 1);
      assert.ok(proxy.blocked.includes('private.test:443'));
    } finally {
      await proxy.close();
    }
  });

  it('forwards plain http only to checked hosts, re-checking every request (redirects and rebinding)', async () => {
    let rebinding = 0;
    const lookup = async (host) => {
      if (host === 'site.test') return [{ address: '127.0.0.1', family: 4 }];
      if (host === 'rebind.test') {
        rebinding += 1;
        return [{ address: rebinding === 1 ? '127.0.0.1' : '10.0.0.1', family: 4 }];
      }
      throw new Error('ENOTFOUND');
    };
    // For this test only, the local origin stands in for a public address.
    const proxy = await startEgressProxy({ lookup, isAllowedAddress: (address) => address === '127.0.0.1', allowedPorts: [originPort] });
    try {
      const ok = await raw(proxy.url, `GET http://site.test:${originPort}/page HTTP/1.1\r\nHost: site.test:${originPort}\r\nProxy-Connection: keep-alive\r\nConnection: close\r\n\r\n`, { until: 'hello from origin' });
      assert.match(ok, /^HTTP\/1\.1 200/);
      assert.ok(originHits.includes(`GET /page host=site.test:${originPort}`));

      // A redirect is returned to the browser, never followed by the proxy;
      // the browser's next request (to 10.0.0.1) is checked like any other.
      const redirect = await raw(proxy.url, `GET http://site.test:${originPort}/redirect HTTP/1.1\r\nHost: site.test\r\nConnection: close\r\n\r\n`, { until: '\r\n\r\n' });
      assert.match(redirect, /^HTTP\/1\.1 302/);
      const followed = await raw(proxy.url, `GET http://10.0.0.1:${originPort}/secret HTTP/1.1\r\nHost: 10.0.0.1\r\nConnection: close\r\n\r\n`);
      assert.match(followed, /^HTTP\/1\.1 403/);
      assert.equal(originHits.filter((hit) => hit.includes('/secret')).length, 0);

      // DNS rebinding: the second resolution is private and refused.
      const first = await raw(proxy.url, `GET http://rebind.test:${originPort}/a HTTP/1.1\r\nHost: rebind.test\r\nConnection: close\r\n\r\n`, { until: 'hello from origin' });
      assert.match(first, /^HTTP\/1\.1 200/);
      const second = await raw(proxy.url, `GET http://rebind.test:${originPort}/b HTTP/1.1\r\nHost: rebind.test\r\nConnection: close\r\n\r\n`);
      assert.match(second, /^HTTP\/1\.1 403/);
      assert.equal(originHits.some((hit) => hit.startsWith('GET /b ')), false);

      // Disallowed port, non-http absolute URL, WebSocket upgrade.
      assert.match(await raw(proxy.url, 'GET http://site.test:9/ HTTP/1.1\r\nHost: site.test\r\n\r\n'), /^HTTP\/1\.1 403/);
      assert.match(await raw(proxy.url, 'GET ftp://site.test/ HTTP/1.1\r\nHost: site.test\r\n\r\n'), /^HTTP\/1\.1 (403|400)/);
      const upgraded = await raw(proxy.url, `GET http://site.test:${originPort}/ws HTTP/1.1\r\nHost: site.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
      assert.equal(upgraded, '');
    } finally {
      await proxy.close();
    }
  });
});

describe('captureWebPage', () => {
  const lookup = fakeLookup({ 'example.com': [PUBLIC_V4], 'internal.test': ['10.0.0.9'] });

  /** A fake Playwright browser whose page behaves as `page` says. */
  function fakeBrowser(page = {}) {
    const calls = { launch: null, context: null, routes: [], goto: null, screenshot: null, closed: false };
    const launcher = async (options) => {
      calls.launch = options;
      return {
        newContext: async (options) => {
          calls.context = options;
          return {
            route: async (_pattern, handler) => { calls.routes.push(handler); },
            newPage: async () => ({
              goto: page.goto ?? (async (url, options) => { calls.goto = { url, options }; return { status: () => page.status ?? 200 }; }),
              url: () => page.finalUrl ?? 'https://example.com/',
              waitForLoadState: async () => {},
              evaluate: async () => page.height ?? 2000,
              screenshot: async (options) => { calls.screenshot = options; return page.png ?? PNG; },
              title: async () => page.title ?? '  Example   Domain ',
            }),
          };
        },
        close: async () => { calls.closed = true; },
      };
    };
    return { launcher, calls };
  }

  it('renders through the egress proxy in a fresh context and returns a PNG', async () => {
    const { launcher, calls } = fakeBrowser();
    const result = await captureWebPage({ url: 'https://example.com/#x', viewport: 'desktop' }, { launcher, lookup });
    assert.deepEqual([result.url, result.viewport, result.width, result.height, result.truncated, result.pageTitle], ['https://example.com/', 'desktop', 1440, 2000, false, 'Example Domain']);
    assert.ok(result.png.equals(PNG));
    // The untrusted page runs in Chromium's OS sandbox (playwright-core
    // would otherwise launch with --no-sandbox).
    assert.equal(calls.launch.chromiumSandbox, true);
    assert.ok(!calls.launch.args.includes('--no-sandbox'));
    assert.match(calls.launch.args.find((arg) => arg.startsWith('--proxy-server=')), /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(calls.launch.env.JWT_SECRET, undefined);
    assert.deepEqual(
      [calls.context.acceptDownloads, calls.context.serviceWorkers, calls.context.ignoreHTTPSErrors, calls.context.storageState, calls.context.httpCredentials],
      [false, 'block', false, undefined, undefined],
    );
    assert.deepEqual(calls.context.viewport, { width: 1440, height: 900 });
    assert.deepEqual(calls.screenshot.clip, { x: 0, y: 0, width: 1440, height: 2000 });
    assert.equal(calls.closed, true);

    // The in-browser filter aborts private requests and lets public ones through.
    const [handler] = calls.routes;
    const decide = async (url) => {
      let outcome;
      await handler({ request: () => ({ url: () => url }), abort: async () => { outcome = 'abort'; }, continue: async () => { outcome = 'continue'; } });
      return outcome;
    };
    assert.equal(await decide('https://cdn.example.com/a.css'), 'continue');
    assert.equal(await decide('http://169.254.169.254/latest/meta-data'), 'abort');
    assert.equal(await decide('file:///etc/passwd'), 'abort');
  });

  it('clamps the page height and says so', async () => {
    const desktop = fakeBrowser({ height: 90_000 });
    const tall = await captureWebPage({ url: 'https://example.com/', viewport: 'desktop' }, { launcher: desktop.launcher, lookup });
    assert.deepEqual([tall.height, tall.truncated, desktop.calls.screenshot.clip.height], [CAPTURE_MAX_DEVICE_HEIGHT, true, CAPTURE_MAX_DEVICE_HEIGHT]);
    const mobile = fakeBrowser({ height: 90_000 });
    const phone = await captureWebPage({ url: 'https://example.com/', viewport: 'mobile' }, { launcher: mobile.launcher, lookup });
    assert.deepEqual([phone.width, phone.height, mobile.calls.screenshot.clip.height], [780, CAPTURE_MAX_DEVICE_HEIGHT, CAPTURE_MAX_DEVICE_HEIGHT / 2]);
    assert.deepEqual([mobile.calls.context.isMobile, mobile.calls.context.viewport.width], [true, 390]);
  });

  it('never starts a browser for a refused URL', async () => {
    const { launcher, calls } = fakeBrowser();
    await rejectsWith(captureWebPage({ url: 'http://internal.test/' }, { launcher, lookup }), 'WEB_CAPTURE_URL_REJECTED');
    await rejectsWith(captureWebPage({ url: 'http://169.254.169.254/' }, { launcher, lookup }), 'WEB_CAPTURE_URL_REJECTED');
    assert.equal(calls.launch, null);
  });

  it('fails on error pages, navigation away from the web, bad images and oversize screenshots', async () => {
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher: fakeBrowser({ status: 404 }).launcher, lookup }), 'WEB_CAPTURE_FAILED');
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher: fakeBrowser({ finalUrl: 'data:text/html,x' }).launcher, lookup }), 'WEB_CAPTURE_FAILED');
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher: fakeBrowser({ png: Buffer.from('not a png') }).launcher, lookup }), 'WEB_CAPTURE_FAILED');
    const huge = Buffer.alloc(50 * 1024 * 1024 + 1);
    PNG.copy(huge);
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher: fakeBrowser({ png: huge }).launcher, lookup }), 'WEB_CAPTURE_TOO_LARGE');
  });

  it('times out, closing the browser, and limits concurrent captures', async () => {
    const hanging = fakeBrowser({ goto: () => new Promise(() => {}) });
    const started = Date.now();
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher: hanging.launcher, lookup, timeoutMs: 100 }), 'WEB_CAPTURE_TIMEOUT');
    assert.ok(Date.now() - started < 2000);
    assert.equal(hanging.calls.closed, true);

    let release;
    const slow = fakeBrowser({ goto: () => new Promise((resolve) => { release = () => resolve({ status: () => 200 }); }) });
    const first = captureWebPage({ url: 'https://example.com/' }, { launcher: slow.launcher, lookup, maxConcurrent: 1 });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher: fakeBrowser().launcher, lookup, maxConcurrent: 1 }), 'WEB_CAPTURE_BUSY');
    release();
    await first;
  });

  it('reports a missing browser as unavailable', async () => {
    const launcher = async () => { throw new WebCaptureError('WEB_CAPTURE_UNAVAILABLE', 'no browser', 503); };
    await rejectsWith(captureWebPage({ url: 'https://example.com/' }, { launcher, lookup }), 'WEB_CAPTURE_UNAVAILABLE');
  });
});
