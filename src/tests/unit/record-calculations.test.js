import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecordFields, validateRecordDefinitions } from '../../shared/record-calculations.js';

const field = (key, type = 'NUMBER', extra = {}) => ({ key, name: key, type, ...extra });
const ref = key => ({ field: key });
const literal = value => ({ literal: value });
const op = (name, ...args) => ({ op: name, args });
const formula = (key, expression) => field(key, 'FORMULA', { expression });
const relation = field('projects', 'RELATION', { collectionId: 'project_records' });
const catalog = { project_records: [field('hours'), field('kind', 'SELECT', { options: ['Design', 'Development'] })] };
const rollup = (key, aggregate, targetKey = 'hours') => field(key, 'ROLLUP', { relationKey: 'projects', aggregate, ...(aggregate === 'COUNT' ? {} : { targetKey }) });
const resolved = { projects: { complete: true, items: [{ id: 'p1', values: { hours: 0, kind: 'Design' } }, { id: 'p2', values: { hours: 6, kind: 'Design' } }, { id: 'p3', values: { hours: null, kind: 'Development' } }] } };

test('a rate/quantity formula and dependent balance use numeric fields without coercion', () => {
  const fields = [field('rate'), field('hours'), field('paid'), formula('total', op('multiply', ref('rate'), ref('hours'))), formula('balance', op('subtract', ref('total'), ref('paid')))];
  assert.deepEqual(calculateRecordFields(fields, { rate: 50, hours: 8, paid: 100 }), {
    total: { value: 400, error: null, type: 'NUMBER' }, balance: { value: 300, error: null, type: 'NUMBER' },
  });
  assert.equal(calculateRecordFields(fields, { rate: '50', hours: 8, paid: 100 }).total.error, 'INVALID_INPUT');
  assert.equal(calculateRecordFields(fields, { rate: 0, hours: 8, paid: 0 }).total.value, 0);
});

test('if and coalesce are lazy and preserve false, zero, and empty text', () => {
  const fields = [field('approved', 'BOOLEAN'), formula('chosen', op('if', ref('approved'), op('divide', literal(1), literal(0)), literal(0))),
    formula('zero', op('coalesce', ref('chosen'), literal(99))), field('brief', 'TEXT'), formula('text', op('coalesce', ref('brief'), literal('Fallback'))),
    formula('flag', op('coalesce', ref('approved'), literal(true)))];
  const result = calculateRecordFields(fields, { approved: false, brief: '' });
  assert.equal(result.chosen.value, 0);
  assert.equal(result.zero.value, 0);
  assert.equal(result.text.value, '');
  assert.equal(result.flag.value, false);
  assert.equal(calculateRecordFields(fields, { approved: true }).chosen.error, 'DIVISION_BY_ZERO');
});

test('missing inputs yield null, while calculation failures have explicit errors', () => {
  const fields = [field('hours'), formula('missing', op('add', ref('hours'), literal(2))), formula('broken', op('divide', literal(1), literal(0))), formula('overflow', op('multiply', literal(Number.MAX_VALUE), literal(2)))];
  const result = calculateRecordFields(fields, {});
  assert.deepEqual(result.missing, { value: null, error: null, type: 'NUMBER' });
  assert.equal(result.broken.error, 'DIVISION_BY_ZERO');
  assert.equal(result.overflow.error, 'NON_FINITE');
});

test('dependency errors do not depend on definition ordering or prior evaluation', () => {
  const a = formula('a', op('divide', literal(1), literal(0)));
  const b = formula('b', op('add', ref('a'), literal(2)));
  for (const fields of [[a, b], [b, a]]) {
    const result = calculateRecordFields(fields, {});
    assert.equal(result.a.error, 'DIVISION_BY_ZERO');
    assert.equal(result.b.error, 'DEPENDENCY_ERROR');
  }
});

test('formulas calculate real date differences and reject impossible calendar inputs', () => {
  const fields = [field('start', 'DATE'), field('end', 'DATE'), formula('days', op('daysBetween', ref('start'), ref('end'))), formula('later', op('greater', ref('end'), ref('start')))];
  const result = calculateRecordFields(fields, { start: '2024-02-28', end: '2024-03-01' });
  assert.equal(result.days.value, 2);
  assert.equal(result.later.value, true);
  assert.equal(calculateRecordFields(fields, { start: '2025-02-29', end: '2025-03-01' }).days.error, 'INVALID_INPUT');
});

test('text and boolean operations are typed, bounded, and deterministic', () => {
  const fields = [field('name', 'TEXT'), formula('label', op('concat', literal('Client: '), ref('name'))), formula('logic', op('and', literal(true), op('not', literal(false)))), formula('either', op('or', literal(false), literal(true))), formula('same', op('equal', literal('a'), literal('a')))];
  const result = calculateRecordFields(fields, { name: 'Ashbi' });
  assert.equal(result.label.value, 'Client: Ashbi');
  assert.equal(result.logic.value, true);
  assert.equal(result.either.value, true);
  assert.equal(result.same.value, true);
  assert.equal(calculateRecordFields(fields, { name: 'x'.repeat(2000) }).label.error, 'TEXT_LIMIT');
});

test('rounding bounds precision and detects overflow', () => {
  assert.equal(calculateRecordFields([formula('rounded', op('round', literal(10.126), literal(2)))], {}).rounded.value, 10.13);
  for (const places of [-1, 9, 1.5]) assert.equal(calculateRecordFields([formula('rounded', op('round', literal(1), literal(places)))], {}).rounded.error, 'ROUND_PRECISION');
  assert.equal(calculateRecordFields([formula('rounded', op('round', literal(Number.MAX_VALUE), literal(8)))], {}).rounded.error, 'NON_FINITE');
});

test('definition validation rejects unknown fields, dependency cycles, and archived references', () => {
  for (const fields of [
    [formula('a', ref('unknown'))], [formula('a', ref('a'))], [formula('a', ref('b')), formula('b', ref('a'))],
    [field('old', 'NUMBER', { archived: true }), formula('a', ref('old'))],
  ]) assert.throws(() => validateRecordDefinitions(fields), { statusCode: 400 });
  // Forward references are valid; storage ordering does not alter the result.
  assert.equal(calculateRecordFields([formula('a', ref('b')), formula('b', literal(9))], {}).a.value, 9);
});

test('definition validation rejects unsafe names, extra properties and type coercion', () => {
  for (const fields of [
    [field('constructor')], [field('prototype')], [field('__proto__')], [field('a'), field('A')], [field('a'), field('b', 'NUMBER', { name: ' A ' })],
    [formula('a', { literal: 'x', op: 'concat' })], [formula('a', { field: 'x', member: 'password' })],
    [formula('a', op('eval', literal('process.env')))], [formula('a', op('add', literal('10'), literal(1)))],
    [formula('a', op('if', literal(1), literal('yes'), literal('no')))], [formula('a', op('coalesce', literal(1), literal('fallback')))],
    [formula('a', op('concat', literal('hours'), literal(4)))], [field('a', 'NUMBER', { expression: literal(1) })],
    [field('a', 'SELECT', { options: ['x', 'x'] })], [{ ...formula('a', literal(1)), required: true }],
  ]) assert.throws(() => validateRecordDefinitions(fields), { statusCode: 400 });
});

test('formula size, depth, arity, literal size and finite-number limits are enforced', () => {
  let nested = literal(1);
  for (let i = 0; i < 15; i++) nested = op('add', literal(1), nested);
  const wide = op('add', ...Array.from({ length: 8 }, () => op('add', ...Array.from({ length: 8 }, () => op('add', literal(1), literal(2))))));
  for (const expression of [nested, wide, op('divide', literal(1)), op('round', literal(1), literal(2), literal(3)), literal('x'.repeat(2001)), literal(Infinity), literal(null)]) {
    assert.throws(() => validateRecordDefinitions([formula('a', expression)]), { statusCode: 400 });
  }
});

test('complete relation rollups include zero, skip null, and feed local formulas', () => {
  const fields = [relation, rollup('count', 'COUNT'), rollup('sum', 'SUM'), rollup('average', 'AVERAGE'), rollup('minimum', 'MIN'), rollup('maximum', 'MAX'), rollup('kinds', 'UNIQUE', 'kind'), formula('capacity', op('subtract', literal(40), ref('sum')))];
  const result = calculateRecordFields(fields, { projects: ['p1', 'p2', 'p3'] }, resolved, catalog);
  assert.equal(result.count.value, 3);
  assert.equal(result.sum.value, 6);
  assert.equal(result.average.value, 3);
  assert.equal(result.minimum.value, 0);
  assert.equal(result.maximum.value, 6);
  assert.deepEqual(result.kinds.value, ['Design', 'Development']);
  assert.equal(result.capacity.value, 34);
});

test('empty relations differ from unresolved/incomplete relations', () => {
  const fields = [relation, rollup('count', 'COUNT'), rollup('sum', 'SUM'), rollup('average', 'AVERAGE'), rollup('kinds', 'UNIQUE', 'kind')];
  const empty = calculateRecordFields(fields, {}, {}, catalog);
  assert.equal(empty.count.value, 0);
  assert.equal(empty.sum.value, 0);
  assert.equal(empty.average.value, null);
  assert.deepEqual(empty.kinds.value, []);
  assert.equal(calculateRecordFields(fields, { projects: null }, {}, catalog).sum.value, 0);
  for (const resolution of [{}, { projects: { ...resolved.projects, complete: false } }, { projects: { ...resolved.projects, complete: 'true' } }, { projects: { complete: true, items: resolved.projects.items.slice(0, 2) } }]) {
    assert.equal(calculateRecordFields(fields, { projects: ['p1', 'p2', 'p3'] }, resolution, catalog).sum.error, 'INCOMPLETE_RELATION');
  }
});

test('relation roster mismatches, duplicate identifiers and oversized selections fail', () => {
  const fields = [relation, rollup('sum', 'SUM')];
  for (const items of [[resolved.projects.items[0], resolved.projects.items[0], resolved.projects.items[2]], [...resolved.projects.items.slice(0, 2), { id: 'foreign', values: { hours: 100 } }]]) {
    assert.equal(calculateRecordFields(fields, { projects: ['p1', 'p2', 'p3'] }, { projects: { complete: true, items } }, catalog).sum.error, 'INCOMPLETE_RELATION');
  }
  for (const projects of [['p1', 'p1'], 'p1', Array.from({ length: 101 }, (_, i) => `p${i}`)]) {
    assert.equal(calculateRecordFields(fields, { projects }, {}, catalog).sum.error, 'INVALID_RELATION');
  }
});

test('bad related values never silently become numeric zero or a valid total', () => {
  const fields = [relation, rollup('sum', 'SUM'), rollup('average', 'AVERAGE')];
  for (const hours of ['6', false, Infinity, {}]) {
    const inputs = { projects: { complete: true, items: [{ id: 'p1', values: { hours } }] } };
    assert.equal(calculateRecordFields(fields, { projects: ['p1'] }, inputs, catalog).sum.error, 'INVALID_RELATED_INPUT');
  }
  const nullInput = { projects: { complete: true, items: [{ id: 'p1', values: { hours: null } }] } };
  const result = calculateRecordFields(fields, { projects: ['p1'] }, nullInput, catalog);
  assert.equal(result.sum.value, 0);
  assert.equal(result.average.value, null);
});

test('rollups require accessible collections and stored targets; recursive remote calculations are rejected', () => {
  for (const [fields, targets] of [
    [[relation], {}], [[relation, rollup('sum', 'SUM', 'unknown')], catalog],
    [[relation, rollup('sum', 'SUM', 'kind')], catalog],
    [[relation, rollup('sum', 'SUM')], { project_records: [formula('hours', literal(1))] }],
    [[relation, rollup('sum', 'SUM')], { project_records: [field('hours', 'NUMBER', { archived: true })] }],
    [[relation, { ...rollup('count', 'COUNT'), targetKey: 'hours' }], catalog],
  ]) assert.throws(() => validateRecordDefinitions(fields, targets), { statusCode: 400 });
});

test('calculations do not mutate source fields, values, relation data or catalogs', () => {
  const fields = [relation, rollup('sum', 'SUM')];
  const values = { projects: ['p1', 'p2', 'p3'], sum: 9999 };
  const before = JSON.stringify({ fields, values, resolved, catalog });
  const result = calculateRecordFields(fields, values, resolved, catalog);
  assert.equal(result.sum.value, 6); // Stored spoofed computed value is ignored.
  assert.equal(JSON.stringify({ fields, values, resolved, catalog }), before);
  assert.deepEqual(calculateRecordFields([field('old', 'FORMULA', { archived: true, expression: literal(1) })], {}), {});
});
