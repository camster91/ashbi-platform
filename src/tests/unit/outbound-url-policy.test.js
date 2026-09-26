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
  ]) {
    assert.equal(isNonPublicAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isNonPublicAddress(address), false, address);
  }
});

test('production: https to a public host passes', async () => {
  const url = await assertSafeOutboundUrl('https://llm.example.com/v1', { isProduction: true, lookup: resolvesTo('93.184.216.34') });
  assert.equal(url.hostname, 'llm.example.com');
});

test('production: hosts resolving to private, loopback or link-local addresses are rejected', async () => {
  await reject(assertSafeOutboundUrl('https://internal.example.com', { isProduction: true, lookup: resolvesTo('10.0.0.5') }));
  await reject(assertSafeOutboundUrl('https://meta.example.com', { isProduction: true, lookup: resolvesTo('169.254.169.254') }));
  await reject(assertSafeOutboundUrl('https://v6.example.com', { isProduction: true, lookup: resolvesTo('fe80::1') }));
  // One bad record among good ones is enough to reject.
  await reject(assertSafeOutboundUrl('https://mixed.example.com', { isProduction: true, lookup: resolvesTo('93.184.216.34', '127.0.0.1') }));
});

test('production: IP literals are checked without DNS', async () => {
  const lookup = async () => { throw new Error('must not resolve literals'); };
  await reject(assertSafeOutboundUrl('https://127.0.0.1', { isProduction: true, lookup }));
  await reject(assertSafeOutboundUrl('https://[::1]/v1', { isProduction: true, lookup }));
  await reject(assertSafeOutboundUrl('https://[::ffff:169.254.169.254]', { isProduction: true, lookup }));
  await assertSafeOutboundUrl('https://8.8.8.8', { isProduction: true, lookup });
});

test('production: unresolvable hosts are rejected', async () => {
  await reject(assertSafeOutboundUrl('https://nowhere.invalid', { isProduction: true, lookup: async () => { throw new Error('ENOTFOUND'); } }));
});

test('http is allowed only for localhost outside production', async () => {
  await assertSafeOutboundUrl('http://localhost:11434', { isProduction: false });
  await assertSafeOutboundUrl('http://127.0.0.1:8080/v1', { isProduction: false });
  await reject(assertSafeOutboundUrl('http://localhost:11434', { isProduction: true }));
  await reject(assertSafeOutboundUrl('http://llm.example.com', { isProduction: false }));
});

test('malformed, credentialed and non-http URLs are rejected', async () => {
  await reject(assertSafeOutboundUrl('not a url', { isProduction: false }));
  await reject(assertSafeOutboundUrl('ftp://llm.example.com', { isProduction: false }));
  await reject(assertSafeOutboundUrl('file:///etc/passwd', { isProduction: false }));
  await reject(assertSafeOutboundUrl('https://user:pass@llm.example.com', { isProduction: false }));
  await reject(assertSafeOutboundUrl('https://llm.example.com/?key=abc', { isProduction: false }));
});
