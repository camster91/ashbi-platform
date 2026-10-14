import { validateRecordDefinitions } from './record-calculations.js';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const editable = field => !field.archived && !['FORMULA', 'ROLLUP'].includes(field.type);

export function validateRecordValue(field, value) {
  if (!editable(field)) fail('Computed or archived fields cannot be submitted.');
  if (value === null) return;
  let valid = false;
  switch (field.type) {
    case 'TEXT': valid = typeof value === 'string' && value.length <= 2000; break;
    case 'NUMBER': valid = typeof value === 'number' && Number.isFinite(value); break;
    case 'BOOLEAN': valid = typeof value === 'boolean'; break;
    case 'DATE': valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; break;
    case 'URL':
      if (typeof value === 'string' && value.length <= 2048) {
        try { const url = new URL(value); valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Invalid URL. */ }
      }
      break;
    case 'SELECT': valid = typeof value === 'string' && field.options.includes(value); break;
    case 'MULTI_SELECT': valid = Array.isArray(value) && value.length <= 30 && value.every(item => typeof item === 'string' && field.options.includes(item)) && new Set(value).size === value.length; break;
    case 'RELATION': valid = Array.isArray(value) && value.length <= 100 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 80) && new Set(value).size === value.length; break;
  }
  if (!valid) fail(`Invalid value for ${field.name}.`);
}

const empty = value => value === null || value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);

/** Preserves historical archived values on edits; rejects client-supplied computed
 * values. Relation ids are shape-checked here and authorized by the service.
 */
export function recordValuePatch(fields, existing, patch, catalog = {}) {
  validateRecordDefinitions(fields, catalog);
  if (!object(existing) || !object(patch) || Object.keys(patch).length > 40) fail('Invalid record values.');
  const result = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    const field = fields.find(item => item.key === key);
    if (!field) fail('Unknown record field.');
    validateRecordValue(field, value);
    result[key] = value;
  }
  for (const field of fields.filter(item => editable(item) && item.required)) {
    if (!own(result, field.key) || empty(result[field.key])) fail(`${field.name} is required.`);
  }
  // Even untouched active values must match the current schema. Required false
  // and zero are present; archived historical fields are deliberately retained.
  for (const field of fields.filter(editable)) {
    if (own(result, field.key)) validateRecordValue(field, result[field.key]);
  }
  return result;
}

/** Definitions cannot silently reinterpret historical values. Formula/rollup
 * expressions may change with a schema revision; stored input types may not.
 */
export function validateRecordDefinitionUpdate(previous, next, catalog = {}) {
  validateRecordDefinitions(next, catalog);
  for (const old of previous) {
    const current = next.find(field => field.key === old.key);
    if (!current) fail('Archive fields instead of deleting them.');
    if (current.type !== old.type || current.collectionId !== old.collectionId || current.target !== old.target) fail('Existing field types and relation targets cannot change.');
    if ((old.options ?? []).some(option => !current.options?.includes(option))) fail('Existing choices must be retained.');
  }
}

/** Staff-only reusable form configuration. A form is tied to an exact schema
 * revision; a schema change must be reviewed before further submissions.
 * No public token, webhook, email or external side effect is implied.
 */
export function validateRecordForm(form, fields, schemaRevision, catalog = {}) {
  validateRecordDefinitions(fields, catalog);
  if (!object(form) || Object.keys(form).some(key => !['name', 'description', 'definitionRevision', 'fields'].includes(key)) || typeof form.name !== 'string' || !form.name.trim() || form.name.length > 80 || (form.description !== undefined && (typeof form.description !== 'string' || form.description.length > 2000)) || !Number.isInteger(form.definitionRevision) || form.definitionRevision < 0 || !Number.isInteger(schemaRevision) || schemaRevision < 0 || form.definitionRevision !== schemaRevision) fail('Review the form against the current collection fields.');
  if (!Array.isArray(form.fields) || !form.fields.length || form.fields.length > 40 || new Set(form.fields.map(item => item?.key)).size !== form.fields.length) fail('Choose unique form fields.');
  for (const item of form.fields) {
    if (!object(item) || Object.keys(item).some(key => !['key', 'label', 'help', 'required', 'defaultValue'].includes(key)) || typeof item.key !== 'string' || (item.label !== undefined && (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80)) || (item.help !== undefined && (typeof item.help !== 'string' || item.help.length > 500)) || typeof item.required !== 'boolean') fail('Invalid form field.');
    const field = fields.find(field => field.key === item.key);
    if (!field || !editable(field)) fail('Form fields must be active editable collection fields.');
    if (field.required && !item.required) fail('Collection required fields must remain required in the form.');
    if (own(item, 'defaultValue')) validateRecordValue(field, item.defaultValue);
  }
  for (const field of fields.filter(item => editable(item) && item.required)) {
    if (!form.fields.some(item => item.key === field.key)) fail('Form must include every required collection field.');
  }
  return form;
}

export function recordFormSubmission(form, fields, schemaRevision, submitted, catalog = {}) {
  validateRecordForm(form, fields, schemaRevision, catalog);
  if (!object(submitted) || Object.keys(submitted).some(key => !form.fields.some(item => item.key === key))) fail('Only configured form fields can be submitted.');
  const values = {};
  for (const item of form.fields) {
    const value = own(submitted, item.key) ? submitted[item.key] : own(item, 'defaultValue') ? item.defaultValue : null;
    if (item.required && empty(value)) fail(`${item.label || fields.find(field => field.key === item.key).name} is required.`);
    values[item.key] = value;
  }
  return recordValuePatch(fields, {}, values, catalog);
}
