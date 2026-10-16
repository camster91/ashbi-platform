import assert from 'node:assert/strict';
import test from 'node:test';
import retainerRoutes from '../../routes/retainer.routes.js';
import { createRetainerSchema, updateRetainerSchema } from '../../validators/schemas.js';
import { buildInvoiceApp } from '../helpers/fake-invoice-db.js';
import { buildRetainerCreatePayload, buildRetainerUpdatePayload } from '../../../web/src/lib/form-payloads.js';
const clientId = 'cm00000000000000000000001';
async function fixture(t, role = 'ADMIN') {
  const writes = [];
  const db = { retainerPlan: {
    upsert: async (query) => { writes.push(query); return { id: 'plan', ...query.create }; },
    update: async (query) => { writes.push(query); return { id: 'plan', ...query.data }; },
  } };
  const app = await buildInvoiceApp(t, retainerRoutes, db, { prefix: '/api/retainers', user: { id: 'user', organizationId: 'org', role } });
  return { writes, save: (payload, create = false) => app.inject({ method: create ? 'POST' : 'PUT', url: create ? '/api/retainers/' : `/api/retainers/${clientId}`, payload }) };
}
test('retainer note schemas and actual UI payloads distinguish omitted preserve and explicit clear', () => {
  assert.equal(createRetainerSchema.parse({ clientId, hoursPerMonth: 20, serviceDescription: '  Agreed work\nTwo revisions  ' }).serviceDescription, 'Agreed work\nTwo revisions');
  for (const value of ['', '   ', null]) assert.equal(updateRetainerSchema.parse({ serviceDescription: value }).serviceDescription, null);
  assert.equal(Object.hasOwn(updateRetainerSchema.parse({ hoursPerMonth: 20 }), 'serviceDescription'), false);
  assert.equal(Object.hasOwn(buildRetainerUpdatePayload({ hoursPerMonth: 20 }), 'serviceDescription'), false);
  assert.equal(Object.hasOwn(buildRetainerCreatePayload({ clientId, hoursPerMonth: 20 }), 'serviceDescription'), false);
  assert.equal(buildRetainerUpdatePayload({ serviceDescription: '' }).serviceDescription, null);
  assert.equal(buildRetainerCreatePayload({ serviceDescription: ' agreed ' }).serviceDescription, 'agreed');
  for (const value of ['x'.repeat(4001), '<script>bad</script>', 'bad\u0000text']) assert.equal(updateRetainerSchema.safeParse({ serviceDescription: value }).success, false);
});
test('retainer create/upsert and update persist supplied notes while omission leaves existing notes alone', async t => {
  const f = await fixture(t);
  assert.equal((await f.save({ clientId, hoursPerMonth: 20, serviceDescription: 'Included scope' }, true)).statusCode, 200);
  assert.equal(f.writes[0].create.serviceDescription, 'Included scope'); assert.equal(f.writes[0].update.serviceDescription, 'Included scope');
  await f.save({ clientId, hoursPerMonth: 20 }, true);
  assert.equal(Object.hasOwn(f.writes[1].update, 'serviceDescription'), false);
  assert.equal((await f.save({ serviceDescription: '' })).statusCode, 200);
  assert.deepEqual(f.writes[2].data, { serviceDescription: null });
  await f.save({ serviceDescription: ' New scope ' }); assert.deepEqual(f.writes[3].data, { serviceDescription: 'New scope' });
  await f.save({ hoursPerMonth: 30 }); assert.deepEqual(f.writes[4].data, { hoursPerMonth: 30 });
});
for (const role of ['TEAM', 'CLIENT', 'BOT']) test(`retainer notes retain existing ADMIN-only mutation permissions for ${role}`, async t => {
  const f = await fixture(t, role);
  assert.equal((await f.save({ serviceDescription: 'Unauthorized' })).statusCode, 403);
  assert.equal((await f.save({ clientId, hoursPerMonth: 20, serviceDescription: 'Unauthorized' }, true)).statusCode, 403);
  assert.deepEqual(f.writes, []);
});
test('retainer invalid notes fail validation before database mutation', async t => {
  const f = await fixture(t); assert.equal((await f.save({ serviceDescription: '<b>bad</b>' })).statusCode, 400); assert.deepEqual(f.writes, []);
});
