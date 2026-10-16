import test from 'node:test';
import assert from 'node:assert/strict';
import { MCP_OAUTH_DEFAULT_SCOPES, MCP_OAUTH_ACTION_SCOPES, MCP_OAUTH_OPTIONAL_SCOPES, hasMcpWriteScope, normalizeMcpScopes } from '../../auth/mcp-oauth-scopes.js';
import { assertMcpActionAuthority } from '../../auth/mcp-action-authority.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';

const scope = 'workspace:resource-links:write';
const actions = ['create_resource_link', 'update_resource_link', 'archive_resource_link', 'restore_resource_link', 'reorder_resource_links'];
function fixture(scopes) {
  const db = seedTwoOrganizations(createFakeToolDb());
  const user = db.tables.user.find(row => row.id === 'admin-a');
  Object.assign(user, { isActive: true, sessionVersion: 1 });
  const key = { id: 'resource-oauth-key', userId: user.id, isActive: true, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), scopes };
  db.apiKey = { findUnique: async () => structuredClone(key) };
  const ctx = { user: structuredClone(user), scopes: [...scopes], oauth: { keyId: key.id, clientId: 'https://chatgpt.com/oauth/client.json', sessionVersion: 1, scopes: [...scopes], expiresAt: Date.now() + 60_000 } };
  return { db, ctx, key, user };
}

test('resource writes are a separate explicit optional scope; defaults remain read-only', () => {
  assert.deepEqual(MCP_OAUTH_DEFAULT_SCOPES, ['workspace:read']);
  assert.equal(hasMcpWriteScope(MCP_OAUTH_DEFAULT_SCOPES), false);
  assert.equal(MCP_OAUTH_OPTIONAL_SCOPES.filter(row => row.scope === scope).length, 1);
  for (const action of actions) assert.equal(MCP_OAUTH_ACTION_SCOPES[action], scope);
  assert.deepEqual(normalizeMcpScopes(['workspace:read']), ['workspace:read']);
  assert.deepEqual(normalizeMcpScopes(['workspace:read', scope]), ['workspace:read', scope]);
  assert.equal(normalizeMcpScopes([scope]), null);
  assert.equal(normalizeMcpScopes(['workspace:read', 'workspace:actions']), null);
});

test('old read grants and other write grants cannot mutate resource links', async () => {
  for (const scopes of [['workspace:read'], ['workspace:read', 'workspace:client-tasks:write'], ['workspace:read', 'workspace:service-reports:publish']]) {
    const f = fixture(scopes);
    for (const action of actions) await assert.rejects(assertMcpActionAuthority(f.db, f.ctx, action), { code: 'NOT_FOUND' });
  }
});

test('resource opt-in is persisted-authority bound and stops after revocation, demotion or scope removal', async () => {
  const f = fixture(['workspace:read', scope]);
  for (const action of actions) await assertMcpActionAuthority(f.db, f.ctx, action);
  f.key.isActive = false;
  await assert.rejects(assertMcpActionAuthority(f.db, f.ctx, actions[0]), { code: 'NOT_FOUND' });
  f.key.isActive = true;
  f.user.role = 'TEAM';
  await assert.rejects(assertMcpActionAuthority(f.db, f.ctx, actions[0]), { code: 'NOT_FOUND' });
  f.user.role = 'ADMIN';
  f.key.scopes = ['workspace:read'];
  await assert.rejects(assertMcpActionAuthority(f.db, f.ctx, actions[0]), { code: 'NOT_FOUND' });
});
