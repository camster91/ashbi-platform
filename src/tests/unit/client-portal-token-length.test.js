import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { clientPortalTokenRedeemSchema } from '../../validators/schemas.js';

test('magic-link tokens for contacts with ordinary names and emails pass validation', async () => {
  const app = Fastify();
  await app.register(jwt, { secret: 'unit-test-secret' });
  await app.ready();
  const token = app.jwt.sign({
    id: 'cmugckzq9000ysx7dgh43uxwh',
    email: 'alexandra.montgomery-whitfield@northwind-consulting.example.com',
    name: 'Alexandra Montgomery-Whitfield',
    contactId: 'cmugckure000osx7d2posnb8e',
    clientId: 'cmugckur5000nsx7dl8eqbr9t',
    organizationId: 'cmugc76on0000oi7dp2v85ini',
    role: 'CLIENT',
    sessionVersion: 0,
  }, { expiresIn: '1h' });
  await app.close();

  assert.ok(token.length > 500, `fixture token should exceed the old limit (${token.length})`);
  assert.equal(clientPortalTokenRedeemSchema.safeParse({ token }).success, true);
});

test('token redemption still rejects empty and unbounded input', () => {
  assert.equal(clientPortalTokenRedeemSchema.safeParse({ token: '' }).success, false);
  assert.equal(clientPortalTokenRedeemSchema.safeParse({ token: 'x'.repeat(4097) }).success, false);
});
