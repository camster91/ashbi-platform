import { z } from 'zod';

// Only explicitly declared preprocessing inputs may replace an otherwise
// unrepresentable transform. No generic transform is silently erased.
const preprocessingInputs = new WeakMap();
export function preprocessInput(normalize, output, input = output) {
  const schema = z.preprocess(normalize, output);
  preprocessingInputs.set(schema.in, input);
  preprocessingInputs.set(schema, input);
  return schema;
}

/** Describe request input; runtime Zod remains the cross-field authority. */
export function toInputJsonSchema(schema) {
  if (!schema?._zod) throw new Error('Expected a Zod 4 schema');
  const result = z.toJSONSchema(schema, {
    io: 'input', target: 'draft-2020-12', cycles: 'throw', reused: 'inline',
    override: ({ zodSchema, jsonSchema }) => {
      const input = preprocessingInputs.get(zodSchema) || preprocessingInputs.get(zodSchema._zod.def.in);
      if (!input && zodSchema._zod.def.type === 'pipe' && zodSchema._zod.def.in._zod.def.type === 'transform') {
        throw new Error('Undeclared preprocessing input cannot be represented in JSON Schema');
      }
      if (input) {
        for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
        Object.assign(jsonSchema, toInputJsonSchema(input));
      }
      // JSON Schema carries no RegExp flags. Native conversion drops them;
      // retain the previous fail-closed contract for explicit regex checks.
      for (const check of zodSchema._zod.def.checks || []) {
        const def = check._zod.def;
        if (def.format === 'regex' && def.pattern.flags.replace('u', '')) {
          throw new Error(`Unsupported regex flags "${def.pattern.flags}"`);
        }
      }
    },
    unrepresentable: ({ zodSchema }) => {
      const input = preprocessingInputs.get(zodSchema) || preprocessingInputs.get(zodSchema._zod.def.in);
      return input ? toInputJsonSchema(input) : 'throw';
    },
  });
  delete result.$schema;
  return result;
}
