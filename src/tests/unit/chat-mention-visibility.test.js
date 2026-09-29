// A mention notification carries the staff author and the message id, so it
// follows the message's visibility: an internal message never notifies a
// client user, and a client-visible one notifies only that project's client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mayNotifyMention } from '../../auth/project-room-access.js';

const project = { id: 'p1', clientId: 'client-a' };
const staff = { id: 'u-staff', role: 'TEAM' };
const ownClient = { id: 'u-client', role: 'CLIENT', clientId: 'client-a' };
const otherClient = { id: 'u-other', role: 'CLIENT', clientId: 'client-b' };

test('internal messages notify staff only', () => {
  assert.equal(mayNotifyMention(staff, 'INTERNAL', project), true);
  assert.equal(mayNotifyMention(ownClient, 'INTERNAL', project), false);
});

test('client-visible messages notify staff and only this project\'s client users', () => {
  assert.equal(mayNotifyMention(staff, 'CLIENT', project), true);
  assert.equal(mayNotifyMention(ownClient, 'CLIENT', project), true);
  assert.equal(mayNotifyMention(otherClient, 'CLIENT', project), false);
  assert.equal(mayNotifyMention({ ...ownClient, clientId: null }, 'CLIENT', { id: 'p2', clientId: null }), false);
});

test('the chat route filters mention recipients by the message visibility', () => {
  const source = readFileSync(new URL('../../routes/chat.routes.js', import.meta.url), 'utf8');
  assert.match(source, /mayNotifyMention\(user, visibility, project\)/);
});
