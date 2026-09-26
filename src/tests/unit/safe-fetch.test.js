// DNS-pinned transport for BYOK providers: redirects are never followed and
// the address the socket connects to is the address that was checked (#413
// security review B1, S2). Uses a real local HTTP server.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

const { createSafeFetch, createGuardedLookup } = await import('../../security/safe-fetch.js');
const { createByokProvider } = await import('../../ai/governance.js');
const { AiProviderError } = await import('../../ai/errors.js');
const { UnsafeOutboundUrlError } = await import('../../security/outbound-url-policy.js');

let server;
let port;
const hits = [];

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/v1/chat/completions') {
      // A malicious provider redirects the POST (with its body and the
      // Authorization header) to cloud metadata.
      res.writeHead(307, { Location: `http://127.0.0.1:${port}/metadata` });
      return res.end();
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'model-a' }] }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ choices: [{ message: { content: 'reached the redirect target' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

const resolvesTo = (address) => (_host, _options, callback) => callback(null, [{ address, family: 4 }]);

test('a 307 from the provider is not followed', async () => {
  hits.length = 0;
  const provider = createByokProvider({ baseUrl: `http://localhost:${port}`, apiKey: 'sk-redirect-test-1234', model: 'model-a', allowLocalhost: true });
  await assert.rejects(provider.chat({ prompt: 'secret prompt' }), (err) => err instanceof AiProviderError && err.type === 'upstream' && err.upstreamStatus === 307);
  assert.deepEqual(hits, ['POST /v1/chat/completions'], 'the redirect target was never requested');
});

test('the transport reaches an allowed host (control)', async () => {
  hits.length = 0;
  const provider = createByokProvider({ baseUrl: `http://localhost:${port}`, apiKey: 'sk-redirect-test-1234', model: 'model-a', allowLocalhost: true });
  assert.deepEqual(await provider.listModels(), ['model-a']);
  assert.deepEqual(hits, ['GET /v1/models']);
});

test('DNS rebinding: the socket lookup is checked, not only the pre-check', async () => {
  hits.length = 0;
  const provider = createByokProvider({
    baseUrl: `https://rebind.example.com:${port}`,
    apiKey: 'sk-rebind-test-1234',
    model: 'model-a',
    allowLocalhost: false,
    // Validation-time answer: a public address...
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    // ...connect-time answer: loopback.
    socketLookup: resolvesTo('127.0.0.1'),
  });
  await assert.rejects(provider.listModels(), AiProviderError);
  assert.deepEqual(hits, [], 'nothing reached the loopback server');
});

test('safe fetch refuses non-public addresses from DNS and IP literals', async () => {
  const safeFetch = createSafeFetch({ allowLocalhost: false, lookup: resolvesTo('169.254.169.254') });
  await assert.rejects(safeFetch(`https://meta.example.com:${port}/`), UnsafeOutboundUrlError);
  const literal = createSafeFetch({ allowLocalhost: false });
  await assert.rejects(literal(`https://127.0.0.1:${port}/`), UnsafeOutboundUrlError);
  await assert.rejects(literal(`http://localhost:${port}/`), UnsafeOutboundUrlError, 'http outside the localhost exemption');
  assert.equal(hits.includes('GET /'), false);
});

test('the guarded lookup answers both single and all-address callers', async () => {
  const lookup = createGuardedLookup({ allowLocalhost: false, lookup: (_h, _o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]) });
  const single = await new Promise((resolve, reject) => lookup('x.example.com', {}, (err, address, family) => (err ? reject(err) : resolve([address, family]))));
  assert.deepEqual(single, ['93.184.216.34', 4]);
  const all = await new Promise((resolve, reject) => lookup('x.example.com', { all: true }, (err, list) => (err ? reject(err) : resolve(list))));
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
});
