// Pure calculation contract shared by record UI previews and server reads.
// Relation resolution belongs to the permission-aware service, never this engine.
const TYPES = new Set(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'URL', 'SELECT', 'MULTI_SELECT', 'RELATION', 'FORMULA', 'ROLLUP']);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const safeKey = key => typeof key === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key) && !RESERVED.has(key);
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalarType = field => ({ URL: 'TEXT', SELECT: 'TEXT' })[field.type] ?? field.type;
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const arities = { add: [2, 8], subtract: [2, 2], multiply: [2, 8], divide: [2, 2], round: [1, 2], equal: [2, 2], greater: [2, 2], less: [2, 2], and: [2, 8], or: [2, 8], not: [1, 1], concat: [2, 8], if: [3, 3], coalesce: [2, 8], daysBetween: [2, 2] };

/** Validate the entire definition graph before it can be persisted.
 * catalog contains field definitions for same-workspace relation collections,
 * supplied by the service after checking access. No global identifier lookup.
 */
export function validateRecordDefinitions(fields, catalog = {}) {
  if (!Array.isArray(fields) || fields.length > 40) fail('Use at most 40 fields.');
  const byKey = new Map();
  const names = new Set();
  for (const field of fields) {
    if (!exact(field, ['key', 'name', 'type', 'archived', 'required', 'options', 'collectionId', 'target', 'expression', 'relationKey', 'targetKey', 'aggregate']) || !safeKey(field.key) || !TYPES.has(field.type) || typeof field.name !== 'string' || !field.name.trim() || field.name.length > 80 || (field.archived !== undefined && typeof field.archived !== 'boolean') || (field.required !== undefined && typeof field.required !== 'boolean')) fail('Invalid record field.');
    if (byKey.has(field.key.toLowerCase()) || names.has(field.name.trim().toLowerCase())) fail('Field keys and names must be unique.');
    byKey.set(field.key.toLowerCase(), field);
    names.add(field.name.trim().toLowerCase());
    const allowed = ['key', 'name', 'type', 'archived', 'required', ...(['SELECT', 'MULTI_SELECT'].includes(field.type) ? ['options'] : field.type === 'RELATION' ? ['collectionId', 'target'] : field.type === 'FORMULA' ? ['expression'] : field.type === 'ROLLUP' ? ['relationKey', 'targetKey', 'aggregate'] : [])];
    if (!exact(field, allowed)) fail(`Unexpected configuration for ${field.name}.`);
    if (['SELECT', 'MULTI_SELECT'].includes(field.type) && (!Array.isArray(field.options) || !field.options.length || field.options.length > 30 || field.options.some(item => typeof item !== 'string' || !item.trim() || item.length > 80) || new Set(field.options).size !== field.options.length)) fail('Select fields need unique choices.');
    if (field.type === 'RELATION') {
      if (field.target !== undefined) {
        if (!['TASK', 'PROJECT', 'CLIENT', 'PERSON'].includes(field.target) || field.collectionId !== undefined) fail('Choose one canonical relation target or a collection.');
      } else if (typeof field.collectionId !== 'string' || !field.collectionId || field.collectionId.length > 80 || !own(catalog, field.collectionId) || !Array.isArray(catalog[field.collectionId])) fail('Related collection is unavailable.');
    }
    if (['FORMULA', 'ROLLUP'].includes(field.type) && field.required) fail('Computed fields cannot be required inputs.');
  }
  const lookup = key => fields.find(field => field.key === key);
  const visiting = new Set();
  const resultTypes = new Map();
  function fieldType(key) {
    const field = lookup(key);
    if (!field || field.archived) fail('Calculation references an unknown or archived field.');
    if (resultTypes.has(key)) return resultTypes.get(key);
    if (visiting.has(key)) fail('Calculation fields cannot form a cycle.');
    visiting.add(key);
    let type = scalarType(field);
    if (field.type === 'FORMULA') {
      let nodes = 0;
      function expressionType(expression, depth = 0) {
        if (++nodes > 100 || depth > 12 || !object(expression)) fail('Formula is too complex or invalid.');
        if (own(expression, 'literal')) {
          if (!exact(expression, ['literal']) || !['string', 'number', 'boolean'].includes(typeof expression.literal) || (typeof expression.literal === 'number' && !Number.isFinite(expression.literal)) || (typeof expression.literal === 'string' && expression.literal.length > 2000)) fail('Invalid formula literal.');
          return ({ string: 'TEXT', number: 'NUMBER', boolean: 'BOOLEAN' })[typeof expression.literal];
        }
        if (own(expression, 'field')) {
          if (!exact(expression, ['field']) || !safeKey(expression.field)) fail('Invalid formula field reference.');
          return fieldType(expression.field);
        }
        if (!exact(expression, ['op', 'args']) || typeof expression.op !== 'string' || !own(arities, expression.op) || !Array.isArray(expression.args)) fail('Unsupported formula operation.');
        const [min, max] = arities[expression.op];
        if (expression.args.length < min || expression.args.length > max) fail('Invalid formula argument count.');
        const args = expression.args.map(arg => expressionType(arg, depth + 1));
        const same = args.every(arg => arg === args[0]);
        const all = expected => args.every(arg => arg === expected);
        switch (expression.op) {
          case 'add': case 'subtract': case 'multiply': case 'divide': case 'round':
            if (!all('NUMBER')) fail('Arithmetic requires number fields.'); return 'NUMBER';
          case 'greater': case 'less':
            if (!same || !['NUMBER', 'DATE'].includes(args[0])) fail('Ordered comparison requires matching numbers or dates.'); return 'BOOLEAN';
          case 'equal':
            if (!same || !['NUMBER', 'TEXT', 'BOOLEAN', 'DATE'].includes(args[0])) fail('Equality requires matching scalar values.'); return 'BOOLEAN';
          case 'and': case 'or': case 'not':
            if (!all('BOOLEAN')) fail('Logical operations require booleans.'); return 'BOOLEAN';
          case 'concat':
            if (!all('TEXT')) fail('Concatenation requires text fields.'); return 'TEXT';
          case 'if':
            if (args[0] !== 'BOOLEAN' || args[1] !== args[2]) fail('If requires a boolean and matching result types.'); return args[1];
          case 'coalesce':
            if (!same) fail('Coalesce requires matching result types.'); return args[0];
          case 'daysBetween':
            if (!all('DATE')) fail('Days between requires date fields.'); return 'NUMBER';
        }
      }
      type = expressionType(field.expression);
      if (!['NUMBER', 'TEXT', 'BOOLEAN', 'DATE'].includes(type)) fail('Formula result must be a scalar.');
    }
    if (field.type === 'ROLLUP') {
      const relation = lookup(field.relationKey);
      if (!relation || relation.archived || relation.type !== 'RELATION' || relation.target || !['COUNT', 'SUM', 'AVERAGE', 'MIN', 'MAX', 'UNIQUE'].includes(field.aggregate)) fail('Rollup requires an active collection relation and supported aggregate.');
      if (field.aggregate === 'COUNT') {
        if (field.targetKey !== undefined) fail('Count does not take a target field.');
        type = 'NUMBER';
      } else {
        const target = catalog[relation.collectionId]?.find(item => item.key === field.targetKey && !item.archived);
        if (!target || !['NUMBER', 'TEXT', 'SELECT', 'BOOLEAN', 'DATE'].includes(target.type)) fail('Rollup target must be an available stored scalar field.');
        if (field.aggregate === 'UNIQUE') type = 'LIST';
        else {
          if (target.type !== 'NUMBER') fail('Numeric rollups require a number field.');
          type = 'NUMBER';
        }
      }
    }
    visiting.delete(key);
    resultTypes.set(key, type);
    return type;
  }
  for (const field of fields.filter(field => !field.archived)) fieldType(field.key);
  return Object.fromEntries(resultTypes);
}

class CalculationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const calculationFail = code => { throw new CalculationError(code); };
const finite = value => { if (!Number.isFinite(value)) calculationFail('NON_FINITE'); return value; };
const boundedText = value => { if (value.length > 2000) calculationFail('TEXT_LIMIT'); return value; };

/** resolvedRelations: { relationKey: { complete: true, items: [{ values }] } }.
 * The caller must supply only authorized, active records and prove the entire
 * selected relation is loaded. Missing/incomplete resolution is an error.
 * Output preserves false/zero/empty text and keeps errors separate from null.
 */
export function calculateRecordFields(fields, values, resolvedRelations = {}, catalog = {}) {
  const resultTypes = validateRecordDefinitions(fields, catalog);
  if (!object(values) || !object(resolvedRelations)) fail('Invalid record calculation inputs.');
  const results = Object.create(null);
  const definitions = new Map(fields.map(field => [field.key, field]));
  const computed = key => {
    if (own(results, key)) {
      if (results[key].error) calculationFail('DEPENDENCY_ERROR');
      return results[key].value;
    }
    const field = definitions.get(key);
    if (!field || field.archived) calculationFail('UNAVAILABLE_FIELD');
    try {
      let value;
      if (field.type === 'FORMULA') value = evaluate(field.expression);
      else if (field.type === 'ROLLUP') value = rollup(field);
      else {
        value = own(values, key) ? values[key] : null;
        if (value !== null) {
          const type = resultTypes[key];
          if ((type === 'NUMBER' && (typeof value !== 'number' || !Number.isFinite(value))) || (type === 'BOOLEAN' && typeof value !== 'boolean') || (type === 'TEXT' && (typeof value !== 'string' || value.length > (field.type === 'URL' ? 2048 : 2000))) || (field.type === 'SELECT' && !field.options.includes(value)) || (type === 'DATE' && !validDate(value))) calculationFail('INVALID_INPUT');
        }
      }
      results[key] = { value, error: null };
      return value;
    } catch (error) {
      if (!(error instanceof CalculationError)) throw error;
      results[key] = { value: null, error: error.code };
      throw error;
    }
  };
  function evaluate(expression) {
    if (own(expression, 'literal')) return expression.literal;
    if (own(expression, 'field')) {
      try { return computed(expression.field); } catch (error) {
        if (error instanceof CalculationError && ['FORMULA', 'ROLLUP'].includes(definitions.get(expression.field)?.type)) calculationFail('DEPENDENCY_ERROR');
        throw error;
      }
    }
    const { op, args } = expression;
    // Conditional/coalesce branches are lazy: an unused division-by-zero
    // does not invalidate a valid selected branch.
    if (op === 'if') {
      const condition = evaluate(args[0]);
      return condition === null ? null : evaluate(args[condition ? 1 : 2]);
    }
    if (op === 'coalesce') {
      for (const arg of args) { const value = evaluate(arg); if (value !== null) return value; }
      return null;
    }
    const inputs = args.map(evaluate);
    if (inputs.includes(null)) return null;
    switch (op) {
      case 'add': return finite(inputs.reduce((a, b) => a + b, 0));
      case 'subtract': return finite(inputs[0] - inputs[1]);
      case 'multiply': return finite(inputs.reduce((a, b) => a * b, 1));
      case 'divide': if (inputs[1] === 0) calculationFail('DIVISION_BY_ZERO'); return finite(inputs[0] / inputs[1]);
      case 'round': {
        const places = inputs[1] ?? 0;
        if (!Number.isInteger(places) || places < 0 || places > 8) calculationFail('ROUND_PRECISION');
        return finite(Math.round(finite(inputs[0] * 10 ** places)) / 10 ** places);
      }
      case 'equal': return inputs[0] === inputs[1];
      case 'greater': return inputs[0] > inputs[1];
      case 'less': return inputs[0] < inputs[1];
      case 'and': return inputs.every(Boolean);
      case 'or': return inputs.some(Boolean);
      case 'not': return !inputs[0];
      case 'concat': return boundedText(inputs.join(''));
      case 'daysBetween': return (Date.parse(inputs[1]) - Date.parse(inputs[0])) / 86400000;
    }
  }
  function rollup(field) {
    const selected = own(values, field.relationKey) ? values[field.relationKey] ?? [] : [];
    if (!Array.isArray(selected) || selected.length > 100 || selected.some(id => typeof id !== 'string' || !id || id.length > 80) || new Set(selected).size !== selected.length) calculationFail('INVALID_RELATION');
    if (selected.length === 0) return field.aggregate === 'UNIQUE' ? [] : ['SUM', 'COUNT'].includes(field.aggregate) ? 0 : null;
    const resolved = own(resolvedRelations, field.relationKey) ? resolvedRelations[field.relationKey] : null;
    if (resolved?.complete !== true || !Array.isArray(resolved.items) || resolved.items.length !== selected.length || resolved.items.some(item => !object(item) || !object(item.values) || !selected.includes(item.id)) || new Set(resolved.items.map(item => item.id)).size !== selected.length) calculationFail('INCOMPLETE_RELATION');
    if (field.aggregate === 'COUNT') return resolved.items.length;
    const relation = definitions.get(field.relationKey);
    const target = catalog[relation.collectionId].find(item => item.key === field.targetKey);
    const inputs = resolved.items.map(item => own(item.values, field.targetKey) ? item.values[field.targetKey] : null).filter(value => value !== null);
    const type = scalarType(target);
    if (inputs.some(value => type === 'NUMBER' ? typeof value !== 'number' || !Number.isFinite(value) : type === 'BOOLEAN' ? typeof value !== 'boolean' : type === 'DATE' ? !validDate(value) : typeof value !== 'string' || value.length > 2000 || (target.type === 'SELECT' && !target.options.includes(value)))) calculationFail('INVALID_RELATED_INPUT');
    if (field.aggregate === 'UNIQUE') return [...new Set(inputs)];
    if (!inputs.length) return field.aggregate === 'SUM' ? 0 : null;
    if (field.aggregate === 'SUM') return finite(inputs.reduce((a, b) => a + b, 0));
    if (field.aggregate === 'AVERAGE') return finite(inputs.reduce((a, b) => a + b, 0) / inputs.length);
    if (field.aggregate === 'MIN') return Math.min(...inputs);
    if (field.aggregate === 'MAX') return Math.max(...inputs);
  }
  for (const field of fields.filter(field => !field.archived && ['FORMULA', 'ROLLUP'].includes(field.type))) {
    try { computed(field.key); } catch (error) { if (!(error instanceof CalculationError)) throw error; }
  }
  return Object.fromEntries(fields.filter(field => !field.archived && ['FORMULA', 'ROLLUP'].includes(field.type)).map(field => [field.key, { ...results[field.key], type: resultTypes[field.key] }]));
}
