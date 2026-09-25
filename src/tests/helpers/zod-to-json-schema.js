/**
 * Minimal Zod v3 -> JSON Schema (2020-12, as used by OpenAPI 3.1) converter
 * for the request validators in src/validators/schemas.js (#412).
 *
 * The installed zod (3.25) ships `zod/v4` with `toJSONSchema`, but it only
 * accepts v4 schemas and throws on the v3 schemas this codebase builds, so the
 * OpenAPI generator uses this converter instead of a new dependency.
 *
 * It describes the *input* a client must send:
 * - effects (refine, superRefine, transform, preprocess) use their inner
 *   schema, so cross-field rules are not expressed;
 * - `.default()` makes a property optional and records the default value;
 * - coerced primitives are described as their target type.
 *
 * Any Zod type or check it does not know throws, so a new validator shape
 * fails `npm run check:openapi` loudly instead of producing a vague schema.
 */

/**
 * @param {any} value
 * @returns {boolean}
 */
function isJsonValue(value) {
  if (value === null) return true;
  if (['string', 'number', 'boolean'].includes(typeof value)) return Number.isFinite(value) || typeof value !== 'number';
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/**
 * @param {any} schema
 * @returns {string}
 */
function typeNameOf(schema) {
  const typeName = schema?._def?.typeName;
  if (typeof typeName !== 'string') throw new Error('zodToJsonSchema: value is not a Zod v3 schema');
  return typeName;
}

/**
 * Whether an object property may be omitted by the client.
 *
 * @param {any} schema
 * @returns {boolean}
 */
function isOptionalInput(schema) {
  switch (typeNameOf(schema)) {
    case 'ZodOptional':
    case 'ZodDefault':
      return true;
    case 'ZodNullable':
      return isOptionalInput(schema._def.innerType);
    case 'ZodEffects':
      // preprocess can turn `undefined` into a value; let Zod decide.
      return schema._def.effect?.type === 'preprocess'
        ? schema.safeParse(undefined).success
        : isOptionalInput(schema._def.schema);
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    default:
      return false;
  }
}

/**
 * Add a pattern; a second one goes into `allOf` so both still apply.
 *
 * @param {Record<string, any>} out
 * @param {string} pattern
 */
function addPattern(out, pattern) {
  if (out.pattern === undefined) out.pattern = pattern;
  else (out.allOf ??= []).push({ pattern });
}

/**
 * @param {any} schema
 * @param {Record<string, any>} out
 */
function applyStringChecks(schema, out) {
  for (const check of schema._def.checks ?? []) {
    switch (check.kind) {
      case 'min': out.minLength = check.value; break;
      case 'max': out.maxLength = check.value; break;
      case 'length': out.minLength = check.value; out.maxLength = check.value; break;
      case 'email': out.format = 'email'; break;
      case 'url': out.format = 'uri'; break;
      case 'uuid': out.format = 'uuid'; break;
      case 'datetime': out.format = 'date-time'; break;
      case 'date': out.format = 'date'; break;
      case 'time': out.format = 'time'; break;
      case 'regex':
        // JSON Schema patterns carry no flags; refuse rather than mis-describe.
        if (check.regex.flags.replace('u', '')) {
          throw new Error(`zodToJsonSchema: unsupported regex flags "${check.regex.flags}"`);
        }
        addPattern(out, check.regex.source);
        break;
      case 'startsWith': addPattern(out, `^${check.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`); break;
      // Normalisations applied before validation; nothing to express.
      case 'trim':
      case 'toLowerCase':
      case 'toUpperCase':
        break;
      default:
        throw new Error(`zodToJsonSchema: unsupported string check "${check.kind}"`);
    }
  }
}

/**
 * @param {any} schema
 * @param {Record<string, any>} out
 */
function applyNumberChecks(schema, out) {
  for (const check of schema._def.checks ?? []) {
    switch (check.kind) {
      case 'int': out.type = 'integer'; break;
      case 'min':
        if (check.inclusive) out.minimum = check.value;
        else out.exclusiveMinimum = check.value;
        break;
      case 'max':
        if (check.inclusive) out.maximum = check.value;
        else out.exclusiveMaximum = check.value;
        break;
      case 'multipleOf': out.multipleOf = check.value; break;
      case 'finite': break;
      default:
        throw new Error(`zodToJsonSchema: unsupported number check "${check.kind}"`);
    }
  }
}

/**
 * @param {any} value
 * @returns {string}
 */
function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * Convert a Zod v3 schema to a JSON Schema object.
 *
 * @param {any} schema
 * @returns {Record<string, any>}
 */
export function zodToJsonSchema(schema) {
  const def = schema._def;
  /** @type {Record<string, any>} */
  let out;
  switch (typeNameOf(schema)) {
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      const properties = {};
      const required = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptionalInput(value)) required.push(key);
      }
      out = { type: 'object', properties };
      if (required.length) out.required = required;
      const catchall = def.catchall && typeNameOf(def.catchall) !== 'ZodNever' ? def.catchall : null;
      if (catchall) out.additionalProperties = zodToJsonSchema(catchall);
      else if (def.unknownKeys === 'strict') out.additionalProperties = false;
      break;
    }
    case 'ZodString':
      out = { type: 'string' };
      applyStringChecks(schema, out);
      break;
    case 'ZodNumber':
      out = { type: 'number' };
      applyNumberChecks(schema, out);
      break;
    case 'ZodBigInt':
      out = { type: 'integer' };
      break;
    case 'ZodBoolean':
      out = { type: 'boolean' };
      break;
    case 'ZodDate':
      out = { type: 'string', format: 'date-time' };
      break;
    case 'ZodNull':
      out = { type: 'null' };
      break;
    case 'ZodEnum':
      out = { type: 'string', enum: [...def.values] };
      break;
    case 'ZodNativeEnum': {
      const object = def.values;
      // Numeric TS enums map both ways; keep only the real values.
      const values = Object.keys(object)
        .filter((key) => typeof object[object[key]] !== 'number')
        .map((key) => object[key]);
      const types = [...new Set(values.map(jsonTypeOf))];
      out = { enum: values };
      if (types.length === 1) out.type = types[0];
      break;
    }
    case 'ZodLiteral': {
      const { value } = def;
      if (!isJsonValue(value)) throw new Error('zodToJsonSchema: unsupported literal value');
      out = { type: jsonTypeOf(value), const: value };
      break;
    }
    case 'ZodArray':
      out = { type: 'array', items: zodToJsonSchema(def.type) };
      if (def.exactLength) {
        out.minItems = def.exactLength.value;
        out.maxItems = def.exactLength.value;
      }
      if (def.minLength) out.minItems = def.minLength.value;
      if (def.maxLength) out.maxItems = def.maxLength.value;
      break;
    case 'ZodRecord':
      out = { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) };
      if (def.keyType && typeNameOf(def.keyType) !== 'ZodString') {
        out.propertyNames = zodToJsonSchema(def.keyType);
      }
      break;
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = def.options instanceof Map ? [...def.options.values()] : [...def.options];
      out = { anyOf: options.map(zodToJsonSchema) };
      break;
    }
    case 'ZodIntersection':
      out = { allOf: [zodToJsonSchema(def.left), zodToJsonSchema(def.right)] };
      break;
    case 'ZodOptional':
      out = { ...zodToJsonSchema(def.innerType) };
      break;
    case 'ZodNullable':
      out = { anyOf: [zodToJsonSchema(def.innerType), { type: 'null' }] };
      break;
    case 'ZodDefault': {
      const value = def.defaultValue();
      out = { ...zodToJsonSchema(def.innerType) };
      if (isJsonValue(value)) out.default = value;
      break;
    }
    case 'ZodEffects':
      out = { ...zodToJsonSchema(def.schema) };
      break;
    case 'ZodPipeline':
      out = { ...zodToJsonSchema(def.in) };
      break;
    case 'ZodBranded':
      out = { ...zodToJsonSchema(def.type) };
      break;
    case 'ZodCatch':
      out = { ...zodToJsonSchema(def.innerType) };
      break;
    case 'ZodReadonly':
      out = { ...zodToJsonSchema(def.innerType) };
      break;
    case 'ZodAny':
    case 'ZodUnknown':
      out = {};
      break;
    default:
      throw new Error(`zodToJsonSchema: unsupported Zod type ${typeNameOf(schema)}`);
  }
  if (typeof schema.description === 'string' && schema.description) out.description = schema.description;
  return out;
}
