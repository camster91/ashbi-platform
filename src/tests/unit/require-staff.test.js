import test from 'node:test';
import assert from 'node:assert/strict';
import { requireStaff } from '../../middleware/require-staff.js';

test('staff guard permits ADMIN and TEAM with an organization without writing a reply', async () => {
  for (const role of ['ADMIN', 'TEAM']) {
    const user = Object.freeze({ role, organizationId: 'organization-1' });
    const reply = { code() { assert.fail('Authorized staff should continue without a reply'); } };
    assert.equal(await requireStaff({ user }, reply), undefined);
  }
});

test('staff guard rejects missing or nonstaff identities with the existing response contract', async () => {
  for (const user of [
    undefined, null, {},
    { organizationId: 'organization-1' },
    { role: 'CLIENT', organizationId: 'organization-1' },
    { role: 'OWNER', organizationId: 'organization-1' },
    { role: 'admin', organizationId: 'organization-1' },
    ...['ADMIN', 'TEAM'].flatMap(role => [undefined, null, ''].map(organizationId => ({ role, organizationId }))),
  ]) {
    let status;
    let payload;
    const sent = Symbol('sent reply');
    const reply = {
      code(value) { status = value; return this; },
      send(value) { payload = value; return sent; },
    };
    assert.equal(await requireStaff({ user }, reply), sent);
    assert.equal(status, 403);
    assert.deepEqual(payload, { error: 'Staff access required', code: 'ROLE_DENIED' });
  }
});
