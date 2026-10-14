import test from 'node:test';
import assert from 'node:assert/strict';
import { recordValuePatch, validateRecordDefinitionUpdate, validateRecordForm, recordFormSubmission } from '../../shared/record-inputs.js';

const fields = [
  { key: 'name', name: 'Name', type: 'TEXT', required: true },
  { key: 'hours', name: 'Hours', type: 'NUMBER', required: true },
  { key: 'approved', name: 'Approved', type: 'BOOLEAN', required: true },
  { key: 'kind', name: 'Kind', type: 'SELECT', options: ['Design', 'Development'] },
  { key: 'tags', name: 'Tags', type: 'MULTI_SELECT', options: ['Priority', 'Retainer'] },
  { key: 'url', name: 'Link', type: 'URL' }, { key: 'due', name: 'Due', type: 'DATE' },
  { key: 'projects', name: 'Projects', type: 'RELATION', collectionId: 'projects' },
  { key: 'old', name: 'Old', type: 'TEXT', archived: true },
  { key: 'total', name: 'Total', type: 'FORMULA', expression: { op: 'multiply', args: [{ field: 'hours' }, { literal: 50 }] } },
];
const catalog = { projects: [] };
const base = { name: 'Ashbi', hours: 0, approved: false, old: 'Historical' };
const form = { name: 'Brief', definitionRevision: 3, fields: [
  { key: 'name', required: true, label: 'Company' }, { key: 'hours', required: true, defaultValue: 0 },
  { key: 'approved', required: true, defaultValue: false }, { key: 'kind', required: false, defaultValue: 'Design' },
] };

test('value patch retains archived data and falsy required values without mutating inputs', () => {
  assert.deepEqual(recordValuePatch(fields, base, { name: 'Freelance' }, catalog), { ...base, name: 'Freelance' });
  assert.equal(base.name, 'Ashbi');
  for (const patch of [{ total: 100 }, { old: 'Overwrite' }, { unknown: 'x' }]) assert.throws(() => recordValuePatch(fields, base, patch, catalog), { statusCode: 400 });
});

test('typed values reject invalid dates, credentials in URLs, choices and relation duplicates', () => {
  for (const patch of [{ due: '2025-02-29' }, { url: 'javascript:alert(1)' }, { url: 'https://user:secret@example.com' }, { hours: '0' }, { approved: 0 }, { kind: 'Unknown' }, { tags: ['Priority', 'Priority'] }, { projects: ['p1', 'p1'] }]) {
    assert.throws(() => recordValuePatch(fields, base, patch, catalog), { statusCode: 400 });
  }
  const values = recordValuePatch(fields, base, { due: '2024-02-29', url: 'https://ashbi.ca', projects: ['p1'], tags: ['Priority'] }, catalog);
  assert.equal(values.due, '2024-02-29');
});

test('required input cannot be cleared; untouched active invalid values also fail', () => {
  for (const patch of [{ name: ' ' }, { hours: null }, { approved: null }]) assert.throws(() => recordValuePatch(fields, base, patch, catalog), { statusCode: 400 });
  assert.throws(() => recordValuePatch(fields, { ...base, kind: 'Unknown' }, {}, catalog), { statusCode: 400 });
  assert.throws(() => recordValuePatch(fields, {}, {}, catalog), { statusCode: 400 });
});

test('definition updates allow archival and added choices, reject historical reinterpretation', () => {
  validateRecordDefinitionUpdate(fields, fields.map(field => field.key === 'kind' ? { ...field, options: [...field.options, 'Writing'] } : field), catalog);
  validateRecordDefinitionUpdate(fields, fields.map(field => field.key === 'kind' ? { ...field, archived: true } : field), catalog);
  for (const next of [fields.filter(field => field.key !== 'kind'), fields.map(field => field.key === 'kind' ? { ...field, options: ['Design'] } : field), fields.map(field => field.key === 'hours' ? { ...field, type: 'TEXT' } : field), fields.map(field => field.key === 'projects' ? { ...field, collectionId: 'other' } : field)]) {
    assert.throws(() => validateRecordDefinitionUpdate(fields, next, { ...catalog, other: [] }), { statusCode: 400 });
  }
});

test('form defaults fill absent values, preserve explicit false/zero and reject required null', () => {
  assert.deepEqual(recordFormSubmission(form, fields, 3, { name: 'Ashbi' }, catalog), { name: 'Ashbi', hours: 0, approved: false, kind: 'Design' });
  const values = recordFormSubmission(form, fields, 3, { name: 'Ashbi', hours: 0, approved: false, kind: null }, catalog);
  assert.equal(values.kind, null);
  assert.throws(() => recordFormSubmission(form, fields, 3, { name: 'Ashbi', hours: null }, catalog), { statusCode: 400 });
});

test('stale forms cannot submit against new or invalid schema revisions', () => {
  for (const revision of [2, 4, -1, NaN, '3']) assert.throws(() => recordFormSubmission(form, fields, revision, { name: 'Ashbi' }, catalog), { statusCode: 400 });
});

test('forms cannot hide collection-required fields, make them optional or submit computed/archived fields', () => {
  for (const changed of [
    { ...form, fields: form.fields.slice(1) }, { ...form, fields: form.fields.map(item => ({ ...item, required: false })) },
    ...['total', 'old', 'missing'].map(key => ({ ...form, fields: [...form.fields, { key, required: false }] })),
    { ...form, fields: [...form.fields, form.fields[0]] },
  ]) assert.throws(() => validateRecordForm(changed, fields, 3, catalog), { statusCode: 400 });
  for (const submitted of [{ name: 'Ashbi', total: 100 }, { name: 'Ashbi', projects: ['foreign'] }, { name: 'Ashbi', old: 'Overwrite' }]) {
    assert.throws(() => recordFormSubmission(form, fields, 3, submitted, catalog), { statusCode: 400 });
  }
});

test('defaults use collection types and no caller configuration can trigger external operations', () => {
  for (const changed of [
    { ...form, webhook: 'https://example.com' }, { ...form, fields: form.fields.map(item => item.key === 'kind' ? { ...item, defaultValue: 'Unknown' } : item) },
    { ...form, fields: form.fields.map(item => item.key === 'name' ? { ...item, sendEmail: true } : item) },
  ]) assert.throws(() => validateRecordForm(changed, fields, 3, catalog), { statusCode: 400 });
  const original = JSON.stringify({ form, fields });
  recordFormSubmission(form, fields, 3, { name: 'Ashbi' }, catalog);
  assert.equal(JSON.stringify({ form, fields }), original);
});

test('unsafe own property keys are rejected and inherited values are never accepted as submissions', () => {
  assert.throws(() => recordValuePatch(fields, base, JSON.parse('{"__proto__":"x"}'), catalog), { statusCode: 400 });
  const submitted = Object.create({ name: 'Inherited client name' });
  assert.throws(() => recordFormSubmission(form, fields, 3, submitted, catalog), { statusCode: 400 });
});
