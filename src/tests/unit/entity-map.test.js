/**
 * Tests for src/utils/entity-map.js — the single source of truth for
 * trashable entity types used by routes/trash.routes.js and
 * services/trash.service.js. Prevents regressions where the two
 * consumers drift apart (the bug Phase 6 surfaced).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ENTITY_MAP, { TRASHABLE_ENTITIES } from '../../utils/entity-map.js';

describe('entity-map Utility', () => {
  test('ENTITY_MAP is frozen (no accidental mutation)', () => {
    assert.equal(Object.isFrozen(ENTITY_MAP), true);
  });

  test('TRASHABLE_ENTITIES is frozen and uppercase mirror', () => {
    assert.equal(Object.isFrozen(TRASHABLE_ENTITIES), true);
    const expected = ['client', 'project', 'invoice', 'proposal', 'contract',
                      'expense', 'task', 'estimate', 'note', 'retainerPlan'];
    assert.deepEqual(
      TRASHABLE_ENTITIES,
      expected.map((m) => m.toUpperCase())
    );
  });

  test('every expected trashable entity is present', () => {
    assert.equal(ENTITY_MAP.CLIENT, 'client');
    assert.equal(ENTITY_MAP.PROJECT, 'project');
    assert.equal(ENTITY_MAP.INVOICE, 'invoice');
    assert.equal(ENTITY_MAP.PROPOSAL, 'proposal');
    assert.equal(ENTITY_MAP.CONTRACT, 'contract');
    assert.equal(ENTITY_MAP.EXPENSE, 'expense');
    assert.equal(ENTITY_MAP.TASK, 'task');
    assert.equal(ENTITY_MAP.ESTIMATE, 'estimate');
    assert.equal(ENTITY_MAP.NOTE, 'note');
    assert.equal(ENTITY_MAP.RETAINER_PLAN, 'retainerPlan');
  });

  test('no stray keys (whitelist locked)', () => {
    assert.equal(Object.keys(ENTITY_MAP).length, 10);
  });

  test('model names are valid JS identifiers on Prisma client shape', () => {
    for (const [entityName, modelName] of Object.entries(ENTITY_MAP)) {
      assert.ok(typeof entityName === 'string' && entityName.length > 0, `empty entity name`);
      assert.ok(typeof modelName === 'string' && modelName.length > 0, `empty model for ${entityName}`);
      // Prisma model delegates are accessed by lowercase camelCase name on client.
      assert.ok(modelName === modelName.toLowerCase() || modelName === 'retainerPlan',
        `${entityName} -> ${modelName} should be lowercase or 'retainerPlan'`);
    }
  });
});
