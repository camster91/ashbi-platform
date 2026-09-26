// SSRF policy for tenant-supplied AI base URLs (#413).
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSafeOutboundUrl, isNonPublicAddress, UnsafeOutboundUrlError } from '../../security/outbound-url-policy.js';

const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const reject = (promise) => assert.rejects(promise, (err) => err instanceof UnsafeOutboundUrlError && err.statusCode === 400);

test('non-public addresses', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.2.10', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', 'not-an-ip',
    // N1: IPv4-translated, local-use NAT64, discard-only, 6to4 of non-public v4
    '::ffff:0:8.8.8.8', '::ffff:0:127.0.0.1', '64:ff9b:1::8.8.8.8', '64:ff9b:1:ab::1', '100::1', '100::ffff:1',
    '2002:7f00:1::', '2002:a9fe:a9fe::1', '2002:0a00:0005::1', '2002:c0a8:0101::',
  ]) {
    assert.equal(isNonPublicAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2002:0808:0808::1', '100:0:0:1::1']) {
    assert.equal(isNonPublicAddress(address), false, address);
  }
});

test('https to a public host passes', async () => {
  const url = await assertSafeOutboundUrl('https://llm.example.com/v1', { allowLocalhost: false, lookup: resolvesTo('93.184.216.34') });
  assert.equal(url.hostname, 'llm.example.com');
});

test('hosts resolving to private, loopback or link-local addresses are rejected', async () => {
  await reject(assertSafeOutboundUrl('https://internal.example.com', { allowLocalhost: false, lookup: resolvesTo('10.0.0.5') }));
  await reject(assertSafeOutboundUrl('https://meta.example.com', { allowLocalhost: false, lookup: resolvesTo('169.254.169.254') }));
  await reject(assertSafeOutboundUrl('https://v6.example.com', { allowLocalhost: false, lookup: resolvesTo('fe80::1') }));
  // One bad record among good ones is enough to reject.
  await reject(assertSafeOutboundUrl('https://mixed.example.com', { allowLocalhost: false, lookup: resolvesTo('93.184.216.34', '127.0.0.1') }));
});

test('IP literals are checked without DNS', async () => {
  const lookup = async () => { throw new Error('must not resolve literals'); };
  await reject(assertSafeOutboundUrl('https://127.0.0.1', { allowLocalhost: false, lookup }));
  await reject(assertSafeOutboundUrl('https://[::1]/v1', { allowLocalhost: false, lookup }));
  await reject(assertSafeOutboundUrl('https://[::ffff:169.254.169.254]', { allowLocalhost: false, lookup }));
  await assertSafeOutboundUrl('https://8.8.8.8', { allowLocalhost: false, lookup });
});

test('unresolvable hosts are rejected', async () => {
  await reject(assertSafeOutboundUrl('https://nowhere.invalid', { allowLocalhost: false, lookup: async () => { throw new Error('ENOTFOUND'); } }));
});

test('http is allowed only for localhost, and only when the exemption applies', async () => {
  await assertSafeOutboundUrl('http://localhost:11434', { allowLocalhost: true });
  await assertSafeOutboundUrl('http://127.0.0.1:8080/v1', { allowLocalhost: true });
  await reject(assertSafeOutboundUrl('http://localhost:11434', { allowLocalhost: false }));
  await reject(assertSafeOutboundUrl('http://llm.example.com', { allowLocalhost: true }));
});

test('the localhost exemption follows NODE_ENV: development and test only', async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => { process.env.NODE_ENV = original; });
  for (const [nodeEnv, allowed] of [['development', true], ['test', true], ['production', false], ['staging', false], [undefined, false]]) {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    const attempt = assertSafeOutboundUrl('http://localhost:11434');
    if (allowed) await attempt;
    else await reject(attempt);
  }
});

test('IP rules apply in every environment, not only production (S1)', async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => { process.env.NODE_ENV = original; });
  for (const nodeEnv of ['development', 'test', 'staging', 'production']) {
    process.env.NODE_ENV = nodeEnv;
    await reject(assertSafeOutboundUrl('https://internal.example.com', { lookup: resolvesTo('10.0.0.5') }));
    await reject(assertSafeOutboundUrl('https://169.254.169.254'));
    await reject(assertSafeOutboundUrl('https://[fd00::1]'));
  }
});

test('malformed, credentialed and non-http URLs are rejected', async () => {
  await reject(assertSafeOutboundUrl('not a url', { allowLocalhost: true }));
  await reject(assertSafeOutboundUrl('ftp://llm.example.com', { allowLocalhost: true }));
  await reject(assertSafeOutboundUrl('file:///etc/passwd', { allowLocalhost: true }));
  await reject(assertSafeOutboundUrl('https://user:pass@llm.example.com', { allowLocalhost: true }));
  await reject(assertSafeOutboundUrl('https://llm.example.com/?key=abc', { allowLocalhost: true }));
});
