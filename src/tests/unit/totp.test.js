import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totp,
  totpStep,
  verifyTotp,
} from '../../auth/totp.js';

// RFC 6238 Appendix B seeds (ASCII) for each HMAC algorithm.
const SEEDS = {
  sha1: Buffer.from('12345678901234567890'),
  sha256: Buffer.from('12345678901234567890123456789012'),
  sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
};

const RFC6238_VECTORS = [
  { time: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { time: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { time: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { time: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { time: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { time: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
];

describe('HOTP (RFC 4226)', () => {
  it('matches the Appendix D test values', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((value, counter) => assert.equal(hotp(SEEDS.sha1, counter), value, `counter ${counter}`));
  });
});

describe('TOTP (RFC 6238)', () => {
  for (const vector of RFC6238_VECTORS) {
    for (const algorithm of ['sha1', 'sha256', 'sha512']) {
      it(`${algorithm} at T=${vector.time}`, () => {
        assert.equal(totp(SEEDS[algorithm], { timeMs: vector.time * 1000, digits: 8, algorithm }), vector[algorithm]);
      });
    }
  }

  it('defaults to SHA-1, 6 digits and 30-second steps', () => {
    assert.equal(totp(SEEDS.sha1, { timeMs: 59_000 }), '287082');
    assert.equal(totpStep(59_000), 1);
    assert.equal(totpStep(60_000), 2);
  });

  it('accepts the previous, current and next step only', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) {
      const code = hotp(secret, step + offset);
      assert.equal(verifyTotp(secret, code, { timeMs: now }), step + offset, `offset ${offset}`);
    }
    for (const offset of [-3, -2, 2, 3]) {
      const code = hotp(secret, step + offset);
      // A far-away code can coincide with an in-window one by chance (1e-6).
      const inWindow = [-1, 0, 1].some((o) => hotp(secret, step + o) === code);
      if (!inWindow) assert.equal(verifyTotp(secret, code, { timeMs: now }), null, `offset ${offset}`);
    }
  });

  it('rejects malformed codes without throwing', () => {
    const secret = generateTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5x']) {
      assert.equal(verifyTotp(secret, bad), null);
    }
    const code = totp(secret);
    assert.notEqual(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`), null, 'a grouped code is accepted');
  });
});

describe('base32 and provisioning', () => {
  it('round-trips RFC 4648 test data', () => {
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.equal(base32Decode('MZXW6YTBOI').toString(), 'foobar');
    assert.equal(base32Decode('mzxw 6ytb oi====').toString(), 'foobar');
    assert.throws(() => base32Decode('not-base32!'), /Invalid base32/);
  });

  it('generates 160-bit secrets', () => {
    const secret = generateTotpSecret();
    assert.equal(base32Decode(secret).length, 20);
    assert.notEqual(secret, generateTotpSecret());
  });

  it('builds an otpauth URI authenticator apps accept', () => {
    const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', accountName: 'ada@example.com', issuer: 'Ashbi Hub' });
    const parsed = new URL(uri);
    assert.equal(parsed.protocol, 'otpauth:');
    assert.ok(uri.startsWith('otpauth://totp/Ashbi%20Hub%3Aada%40example.com?'), uri);
    assert.equal(parsed.searchParams.get('secret'), 'JBSWY3DPEHPK3PXP');
    assert.equal(parsed.searchParams.get('issuer'), 'Ashbi Hub');
    assert.equal(parsed.searchParams.get('digits'), '6');
    assert.equal(parsed.searchParams.get('period'), '30');
    assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
  });
});
