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
test('gallery/group metadata rejects incomplete criteria and archived or relational grouping', () => {
  const base = { key: 'gallery', name: 'Gallery', layout: 'GALLERY', sort: 'TITLE', filters: {} };
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [{ ...base, grouping: { by: 'STATUS' } }] }).success, true);
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [{ ...base, grouping: { by: 'FIELD' } }] }).success, false);
  assert.throws(() => validateTaskViewGrouping([{ key: 'client', type: 'RELATION' }], { by: 'FIELD', fieldKey: 'client' }), { statusCode: 400 });
  assert.throws(() => validateTaskViewGrouping([{ key: 'flag', type: 'BOOLEAN', archived: true }], { by: 'FIELD', fieldKey: 'flag' }), { statusCode: 400 });
});
