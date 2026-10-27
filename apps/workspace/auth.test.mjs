import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { authenticate } from './auth.mjs';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const issuer = 'https://identity.cloudflareaccess.com';
const env = { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'workspace-aud' };
const jwt = (overrides = {}) => new SignJWT({ email: 'staff@example.invalid', ...overrides })
  .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience('workspace-aud')
  .setSubject('verified-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
const req = token => new Request('https://workspace.example.invalid/api/me', { headers: token ? {'Cf-Access-Jwt-Assertion':token} : {} });
test('verified Access token yields identity; missing and forged tokens fail closed', async () => {
  assert.equal((await authenticate(req(await jwt()), env, publicKey)).email, 'staff@example.invalid');
  for (const token of [undefined, 'forged', (await jwt()).slice(0,-10)+'AAAAAAAAAA']) {
    await assert.rejects(authenticate(req(token), env, publicKey));
  }
});
test('wrong audience, issuer, expired tokens and missing required claims are rejected', async () => {
  for (const token of [
    await new SignJWT({email:'staff@example.invalid'}).setProtectedHeader({alg:'RS256'}).setSubject('s').setIssuedAt().setIssuer(issuer).setAudience('wrong').setExpirationTime('5m').sign(privateKey),
    await new SignJWT({email:'staff@example.invalid'}).setProtectedHeader({alg:'RS256'}).setSubject('s').setIssuedAt().setIssuer('https://wrong.example').setAudience('workspace-aud').setExpirationTime('5m').sign(privateKey),
    await new SignJWT({email:'staff@example.invalid'}).setProtectedHeader({alg:'RS256'}).setSubject('s').setIssuedAt().setIssuer(issuer).setAudience('workspace-aud').setExpirationTime(1).sign(privateKey),
    await new SignJWT({email:'staff@example.invalid'}).setProtectedHeader({alg:'RS256'}).setSubject('s').setIssuedAt().setIssuer(issuer).setAudience('workspace-aud').sign(privateKey),
  ]) await assert.rejects(authenticate(req(token), env, publicKey));
  await assert.rejects(authenticate(req(await jwt()), {}, publicKey));
});
