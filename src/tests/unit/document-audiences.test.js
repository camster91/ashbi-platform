import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDocumentAudience, documentAudienceRights } from '../../shared/document-audiences.js';

const actor = (id, role = 'TEAM', organizationId = 'org') => ({ id, role, organizationId, isActive: true });
const node = (id, extra = {}) => ({ id, organizationId: 'org', projectId: 'project', authorId: 'owner', parentId: null, accessMode: 'TEAM', grants: [], ...extra });
const none = { canRead: false, canEdit: false, canManage: false };

test('default shared audiences are staff-only and ownership grants management only inside the workspace', () => {
  const path = [node('root')];
  assert.deepEqual(documentAudienceRights(path, actor('member')), { canRead: true, canEdit: true, canManage: false });
  assert.equal(documentAudienceRights(path, actor('owner')).canManage, true);
  for (const user of [actor('owner', 'CLIENT'), actor('owner', 'BOT'), actor('owner', 'ADMIN', 'foreign'), { ...actor('owner'), isActive: false }]) assert.deepEqual(documentAudienceRights(path, user), none);
});
test('read and edit grants remain distinct and neither confers audience management', () => {
  const path = [node('root', { accessMode: 'RESTRICTED', grants: [{ userId: 'reader', role: 'READ' }, { userId: 'editor', role: 'EDIT' }] })];
  assert.deepEqual(documentAudienceRights(path, actor('reader')), { canRead: true, canEdit: false, canManage: false });
  assert.deepEqual(documentAudienceRights(path, actor('editor')), { canRead: true, canEdit: true, canManage: false });
  assert.deepEqual(documentAudienceRights(path, actor('outsider')), none);
});
test('owning a child or receiving its grant never opens a restricted ancestor', () => {
  const path = [node('child', { authorId: 'child-owner', parentId: 'parent' }), node('parent', { accessMode: 'RESTRICTED' })];
  assert.deepEqual(documentAudienceRights(path, actor('child-owner')), none);
  assert.equal(documentAudienceRights(path, actor('owner')).canRead, true);
  const boundary = composeDocumentAudience(path);
  const promoted = [node('child', { authorId: 'child-owner', audienceBarrier: boundary })];
  assert.deepEqual(documentAudienceRights(promoted, actor('child-owner')), none);
  assert.equal(documentAudienceRights(promoted, actor('owner')).canRead, true);
});
test('promotion preserves effective read/edit distinctions and does not freeze administrator privileges', () => {
  const path = [node('child', { parentId: 'parent' }), node('parent', { accessMode: 'RESTRICTED', grants: [{ userId: 'reader', role: 'READ' }, { userId: 'editor', role: 'EDIT' }] })];
  const audienceBarrier = composeDocumentAudience(path), promoted = [node('child', { audienceBarrier })];
  for (const id of ['owner', 'reader', 'editor', 'outsider']) assert.deepEqual(documentAudienceRights(promoted, actor(id)), documentAudienceRights(path, actor(id)));
  assert.equal(documentAudienceRights(promoted, actor('admin', 'ADMIN')).canRead, true);
  assert.deepEqual(documentAudienceRights(promoted, actor('admin', 'TEAM')), none);
});
test('barriers compose across multiple promotions and constrain an owner beneath a read-only ancestor', () => {
  const parentBarrier = { readUserIds: ['owner', 'reader'], editUserIds: ['owner'] };
  const path = [node('child', { authorId: 'reader', parentId: 'parent' }), node('parent', { audienceBarrier: parentBarrier })];
  assert.deepEqual(documentAudienceRights(path, actor('reader')), { canRead: true, canEdit: false, canManage: false });
  const audienceBarrier = composeDocumentAudience(path);
  assert.deepEqual(documentAudienceRights([node('child', { authorId: 'reader', audienceBarrier })], actor('reader')), { canRead: true, canEdit: false, canManage: false });
});
test('incomplete, cyclic, foreign-project and malformed grant/barrier paths fail closed', () => {
  for (const path of [
    [node('root', { parentId: 'missing' })], [node('root', { parentId: 'root' }), node('root')],
    [node('child', { parentId: 'parent' }), node('parent', { projectId: 'foreign' })],
    [node('root', { accessMode: 'PUBLIC' })], [node('root', { grants: [{ userId: 'member', role: 'ADMIN' }] })],
    [node('root', { audienceBarrier: { readUserIds: 'all', editUserIds: null } })],
  ]) assert.deepEqual(documentAudienceRights(path, actor('member')), none);
});
test('a corrupted editor barrier cannot grant edit without read and composition never mutates input', () => {
  const path = [node('root', { audienceBarrier: { readUserIds: ['reader'], editUserIds: ['outsider'] } })];
  const before = JSON.stringify(path);
  assert.deepEqual(composeDocumentAudience(path), { readUserIds: ['reader'], editUserIds: [] });
  assert.deepEqual(documentAudienceRights(path, actor('outsider')), none);
  assert.equal(JSON.stringify(path), before);
});
