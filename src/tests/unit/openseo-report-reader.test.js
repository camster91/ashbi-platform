import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { createOpenSeoFetch, isOpenSeoCredential, readOpenSeoReports, OPENSEO_MCP_URL } from '../../services/openseo-report-reader.js';

const fixtureAuth = () => ({ username: `qa-${randomUUID()}`, password: randomUUID() });

test('credential origin and ownership shape reject foreign URLs and header injection', () => {
  const credential = { projectId: null, username: 'proxy-user', url: 'https://openseo.ashbi.ca/login' };
  assert.equal(isOpenSeoCredential(credential), true);
  for (const url of ['http://openseo.ashbi.ca', 'https://other.example/mcp', 'https://u:p@openseo.ashbi.ca/mcp', 'https://openseo.ashbi.ca/?token=x', 'https://openseo.ashbi.ca/#secret']) assert.equal(isOpenSeoCredential({ ...credential, url }), false);
  for (const username of ['', 'user:injection', 'user\r\nheader']) assert.equal(isOpenSeoCredential({ ...credential, username }), false);
  assert.equal(isOpenSeoCredential({ ...credential, projectId: 'project' }), false);
});

test('production fetch is fixed HTTPS, redirect rejecting and socket-DNS guarded', async () => {
  let requests = 0;
  const fetch = createOpenSeoFetch({ ...fixtureAuth(), signal: AbortSignal.timeout(1000), request: () => { requests++; throw new Error('Must not request'); } });
  await assert.rejects(fetch('http://127.0.0.1/mcp'));
  await assert.rejects(fetch('https://openseo.ashbi.ca/other'));
  assert.equal(requests, 0);
  const rebinding = createOpenSeoFetch({ ...fixtureAuth(), signal: AbortSignal.timeout(1000), lookup: (_host, _opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) });
  await assert.rejects(rebinding(OPENSEO_MCP_URL), /public internet/);
});

test('transport refuses redirects and oversized responses without retry or forwarding to another origin', async () => {
  for (const oversized of [false, true]) {
    let requests = 0;
    const auth = { ...fixtureAuth(), password: ` ${randomUUID()} ` };
    const request = (_url, options, callback) => {
      requests++;
      assert.equal(options.headers.authorization, `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`);
      const req = new EventEmitter();
      req.write = () => {};
      req.destroy = error => { if (error) queueMicrotask(() => req.emit('error', error)); };
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = oversized ? 200 : 302; res.headers = oversized ? { 'content-type': 'application/json' } : { location: 'https://foreign.example/mcp' }; res.resume = () => {};
        callback(res);
        if (oversized) res.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
      });
      return req;
    };
    const fetch = createOpenSeoFetch({ ...auth, signal: AbortSignal.timeout(1000), request });
    await assert.rejects(fetch(OPENSEO_MCP_URL, { method: 'POST' }), oversized ? /response limit/ : /redirect refused/);
    assert.equal(requests, 1);
  }
});

test('malformed provider status or headers reject safely inside response callbacks', async () => {
  for (const status of [101, 700, 200]) {
    const request = (_url, _options, callback) => {
      const req = new EventEmitter(); req.write = () => {}; req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = status; res.headers = { 'x-invalid': 'bad\r\nheader' }; res.resume = () => {};
        callback(res); res.emit('end');
      });
      return req;
    };
    const fetch = createOpenSeoFetch({ ...fixtureAuth(), signal: AbortSignal.timeout(1000), request });
    await assert.rejects(fetch(OPENSEO_MCP_URL), /Invalid provider response/);
  }
});

async function fixture(t, options = {}) {
  const calls = [];
  const auth = fixtureAuth();
  const server = http.createServer(async (req, res) => {
    if (options.denied) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="offline-fixture"' }).end('Synthetic private authentication detail'); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    assert.equal(req.headers.authorization, `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`);
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'offline-saved-report-fixture', version: '1' } };
    else {
      assert.equal(message.method, 'tools/call');
      calls.push(message.params);
      if (options.hang) return;
      if (message.params.name === 'list_reports') result = { content: [], structuredContent: { reports: options.empty ? [] : [{ id: 'report-a', summary: 'TRUNCATED PREVIEW' }], totalCount: options.empty ? 0 : 21 } };
      else if (message.params.name === 'get_report') result = { content: [], structuredContent: { report: { id: 'report-a', projectId: options.foreign ? 'other-project' : 'project-a', title: 'Saved report', summary: options.html ? '<script>bad</script>' : 'Full stored summary', updatedAt: options.badTime ? 'not-a-timestamp' : '2026-01-01T00:00:00Z' } } };
      else assert.fail('Unexpected provider tool');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const fetchFactory = options => createOpenSeoFetch({ ...options, request: (_url, init, callback) => http.request(`http://127.0.0.1:${server.address().port}/mcp`, { ...init, lookup: undefined }, callback) });
  return { calls, read: () => readOpenSeoReports({ projectId: 'project-a', ...auth, fetchFactory }) };
}

test('real StreamableHTTP SDK reads one page then full summaries without research or HTML', async t => {
  const mock = await fixture(t);
  const result = await mock.read();
  assert.equal(result.partial, true);
  assert.equal(result.providerTotalCount, 21);
  assert.equal(result.reports[0].summary, 'Full stored summary');
  assert.deepEqual(mock.calls, [{ name: 'list_reports', arguments: { projectId: 'project-a', limit: 20, offset: 0 } }, { name: 'get_report', arguments: { projectId: 'project-a', reportId: 'report-a', includeHtml: false } }]);
});

test('an empty provider page remains partial; invalid or foreign detail fails closed', async t => {
  const empty = await fixture(t, { empty: true });
  assert.deepEqual(await empty.read(), { reports: [], partial: true, providerTotalCount: 0, outcome: 'EMPTY' });
  assert.equal(empty.calls.length, 1);
  for (const options of [{ foreign: true }, { html: true }, { badTime: true }]) {
    const mock = await fixture(t, options);
    await assert.rejects(mock.read(), /Invalid provider (report|edit time)/);
  }
});



test('real protocol fixture refuses proxy authentication without fallback or research', async t => {
  const mock = await fixture(t, { denied: true });
  await assert.rejects(mock.read());
  assert.equal(mock.calls.length, 0);
});

test('real protocol fixture stalled report call is aborted by the production 20-second deadline', { timeout: 40000 }, async t => {
  const mock = await fixture(t, { hang: true });
  await assert.rejects(mock.read(), /timeout|aborted/i);
  assert.deepEqual(mock.calls, [{ name: 'list_reports', arguments: { projectId: 'project-a', limit: 20, offset: 0 } }]);
});
