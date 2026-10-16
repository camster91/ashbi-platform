import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_ENTITIES, omitArgs, paginateEntity } from '../../services/workspace-export.service.js';

test('agent transcript export preserves archived history while scoping canonical active clients and excluding internal intent tokens', async () => {
  const conversations = EXPORT_ENTITIES.find(entity => entity.name === 'client_agent_conversations');
  const runs = EXPORT_ENTITIES.find(entity => entity.name === 'client_agent_runs');
  assert.deepEqual(conversations.where('org-a'), { organizationId: 'org-a', client: { organizationId: 'org-a', deletedAt: null } });
  assert.deepEqual(runs.where('org-a'), { organizationId: 'org-a', conversation: { organizationId: 'org-a', client: { organizationId: 'org-a', deletedAt: null } } });
  assert.deepEqual(omitArgs(runs), { idempotencyKey: true, inputHash: true, claimToken: true });
  const archivedAt = new Date('2026-10-15T00:00:00.000Z');
  const contextSnapshot = { version: 1, snapshot: { client: { id: 'client-a', name: 'Historical client', domain: null }, projects: [], truncated: false } };
  const expected = [{ id: 'run-a', prompt: 'Stored question', response: 'Stored answer', archivedAt,
    contextObservedAt: archivedAt, contextSnapshot }];
  const db = { clientAgentRun: { findMany: async args => {
    assert.deepEqual(args.where, runs.where('org-a'));
    assert.deepEqual(args.omit, omitArgs(runs));
    assert.equal(args.take, 500);
    return expected;
  } } };
  const actual = [];
  for await (const row of paginateEntity(db, runs, 'org-a')) actual.push(row);
  assert.deepEqual(actual, expected);
});
