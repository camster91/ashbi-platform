import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTaskViewRows, validateTaskViewGrouping } from '../../shared/task-view-groups.js';
import { projectTaskViewsSchema } from '../../validators/schemas.js';

test('grouping preserves zero, false, missing values and every task', () => {
  const fields = [{ key: 'flag', type: 'BOOLEAN' }, { key: 'estimate', type: 'NUMBER' }];
  const rows = [{ id: 'a', fieldValues: { flag: false, estimate: 0 } }, { id: 'b', fieldValues: { flag: true, estimate: 10 } }, { id: 'c', fieldValues: {} }];
  const flags = groupTaskViewRows(rows, { by: 'FIELD', fieldKey: 'flag' }, fields);
  assert.deepEqual(flags.map(group => group.label), ['No', 'Yes', 'Unspecified']);
  assert.equal(flags[0].tasks[0].id, 'a');
  assert.equal(groupTaskViewRows(rows, { by: 'FIELD', fieldKey: 'estimate' }, fields)[0].label, '0');
  assert.equal(flags.flatMap(group => group.tasks).length, 3);
});
test('multi-select groups include each selected choice once and retain empty records', () => {
  const groups = groupTaskViewRows([{ id: 'a', fieldValues: { tags: ['Design', 'Build', 'Design'] } }, { id: 'b', fieldValues: { tags: [] } }], { by: 'FIELD', fieldKey: 'tags' }, [{ key: 'tags', type: 'MULTI_SELECT' }]);
  assert.deepEqual(groups.map(group => group.label), ['Build', 'Design', 'Unspecified']);
  assert.ok(groups.every(group => group.tasks.length === 1));
});
test('gallery/group metadata accepts relations and rejects incomplete criteria or archived grouping', () => {
  const base = { key: 'gallery', name: 'Gallery', layout: 'GALLERY', sort: 'TITLE', filters: {} };
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [{ ...base, grouping: { by: 'STATUS' } }] }).success, true);
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [{ ...base, grouping: { by: 'FIELD' } }] }).success, false);
  assert.doesNotThrow(() => validateTaskViewGrouping([{ key: 'client', type: 'RELATION' }], { by: 'FIELD', fieldKey: 'client' }));
  assert.throws(() => validateTaskViewGrouping([{ key: 'flag', type: 'BOOLEAN', archived: true }], { by: 'FIELD', fieldKey: 'flag' }), { statusCode: 400 });
});

test('relation groups retain distinct canonical identities with equal names and never render unknown ids', () => {
  const fields = [{ key: 'client', type: 'RELATION', target: 'CLIENT' }];
  const rows = [{ id: 'one', fieldValues: { client: 'c1' }, fieldRelations: { client: { id: 'c1', name: 'Same name' } } }, { id: 'two', fieldValues: { client: 'c2' }, fieldRelations: { client: { id: 'c2', name: 'Same name' } } }, { id: 'three', fieldValues: { client: 'foreign-secret-id' }, fieldRelations: { client: null } }, { id: 'four', fieldValues: {} }];
  const groups = groupTaskViewRows(rows, { by: 'FIELD', fieldKey: 'client' }, fields);
  assert.equal(groups.length, 4);
  assert.equal(groups.filter(group => group.label === 'Same name').length, 2);
  assert.ok(groups.some(group => group.label === 'Unavailable related record'));
  assert.ok(groups.every(group => !group.label.includes('foreign-secret-id')));
  assert.equal(groups.flatMap(group => group.tasks).length, 4);
});
