#!/usr/bin/env node
// Generate docs/data-dictionary.md from prisma/schema.prisma.
//
// The output is derived only from the schema text, so it is deterministic and
// needs no generated Prisma client or database. Run with `--check` to exit 1
// when the committed dictionary no longer matches the schema (#412).
//
//   npm run docs:data-dictionary     # rewrite docs/data-dictionary.md
//   npm run check:data-dictionary    # fail if it is stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'prisma', 'schema.prisma');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'data-dictionary.md');

const SCALAR_TYPES = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
]);

/**
 * Remove a trailing `//` comment that is not inside a string literal.
 *
 * @param {string} line
 * @returns {{ code: string, comment: string }}
 */
function splitComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && inString) { i += 1; continue; }
    if (ch === '"') inString = !inString;
    if (!inString && ch === '/' && line[i + 1] === '/') {
      return { code: line.slice(0, i).trimEnd(), comment: line.slice(i).replace(/^\/{2,}\s?/, '').trim() };
    }
  }
  return { code: line.trimEnd(), comment: '' };
}

/**
 * Read the balanced-parenthesis argument of an attribute such as
 * `@default(...)` starting at the index of its opening parenthesis.
 *
 * @param {string} text
 * @param {number} open
 * @returns {string}
 */
function readParenArgument(text, open) {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && inString) { i += 1; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced parentheses in: ${text}`);
}

/**
 * @param {string} attributes
 * @param {string} name attribute name without `@`, e.g. `default`
 * @returns {string | null} argument text, `''` for a bare attribute, or null
 */
function attributeArgument(attributes, name) {
  const pattern = new RegExp(`(^|\\s)@${name}(?![\\w.])`);
  const match = pattern.exec(attributes);
  if (!match) return null;
  const after = match.index + match[0].length;
  if (attributes[after] !== '(') return '';
  return readParenArgument(attributes, after);
}

/**
 * Parse the schema text into models and enums.
 *
 * @param {string} source
 */
export function parseSchema(source) {
  const lines = source.split(/\r?\n/);
  const models = [];
  const enums = [];
  let block = null;
  let pendingDoc = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!block) {
      if (trimmed.startsWith('///')) {
        pendingDoc.push(trimmed.replace(/^\/{3}\s?/, ''));
        continue;
      }
      const header = /^(model|enum)\s+(\w+)\s*\{$/.exec(trimmed);
      if (header) {
        block = {
          kind: header[1],
          name: header[2],
          doc: pendingDoc.join(' ').trim(),
          fields: [],
          values: [],
          blockAttributes: [],
        };
        pendingDoc = [];
      } else if (/^(view|type)\s+\w+\s*\{$/.test(trimmed)) {
        // Fail loudly rather than silently leave these out of the dictionary.
        throw new Error(`Unsupported Prisma block (add support to the data dictionary): ${trimmed}`);
      } else if (trimmed && !trimmed.startsWith('//')) {
        pendingDoc = [];
      }
      continue;
    }

    if (trimmed === '}') {
      (block.kind === 'model' ? models : enums).push(block);
      block = null;
      pendingDoc = [];
      continue;
    }
    if (trimmed.startsWith('///')) {
      pendingDoc.push(trimmed.replace(/^\/{3}\s?/, ''));
      continue;
    }
    if (!trimmed || trimmed.startsWith('//')) continue;

    const { code, comment } = splitComment(trimmed);
    const doc = pendingDoc.join(' ').trim();
    pendingDoc = [];

    if (code.startsWith('@@')) {
      block.blockAttributes.push(code);
      continue;
    }

    if (block.kind === 'enum') {
      const value = /^(\w+)/.exec(code);
      if (value) block.values.push({ name: value[1], doc, comment });
      continue;
    }

    const field = /^(\w+)\s+(\w+(?:\("[^"]*"\))?)(\[\])?(\?)?\s*(.*)$/.exec(code);
    if (!field) throw new Error(`Unrecognized field in model ${block.name}: ${rawLine}`);
    const [, name, type, list, optional, attributes] = field;
    block.fields.push({
      name,
      type,
      isList: Boolean(list),
      isOptional: Boolean(optional),
      attributes,
      isId: attributeArgument(attributes, 'id') !== null,
      isUnique: attributeArgument(attributes, 'unique') !== null,
      isUpdatedAt: attributeArgument(attributes, 'updatedAt') !== null,
      defaultValue: attributeArgument(attributes, 'default'),
      relation: attributeArgument(attributes, 'relation'),
      dbName: attributeArgument(attributes, 'map'),
      doc,
      comment,
    });
  }
  if (block) throw new Error(`Unterminated ${block.kind} ${block.name}`);
  return { models, enums };
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function code(value) {
  return value ? `\`${String(value).replace(/`/g, "'")}\`` : '';
}

function tableName(model) {
  const map = model.blockAttributes.find((attr) => attr.startsWith('@@map('));
  if (!map) return model.name;
  return /"([^"]+)"/.exec(map)[1];
}

function describeRelation(field, modelNames) {
  if (!modelNames.has(field.type)) return '';
  const parts = [`→ ${field.type}`];
  const args = field.relation ?? '';
  const fields = /fields:\s*\[([^\]]*)\]/.exec(args);
  const references = /references:\s*\[([^\]]*)\]/.exec(args);
  const onDelete = /onDelete:\s*(\w+)/.exec(args);
  const relationName = /^\s*"([^"]+)"/.exec(args) ?? /name:\s*"([^"]+)"/.exec(args);
  if (fields && references) parts.push(`via (${fields[1].trim()}) → (${references[1].trim()})`);
  if (onDelete) parts.push(`onDelete ${onDelete[1]}`);
  if (relationName) parts.push(`"${relationName[1]}"`);
  return parts.join(', ');
}

function fieldModifiers(field) {
  const modifiers = [];
  if (field.isId) modifiers.push('id');
  if (field.isUnique) modifiers.push('unique');
  if (field.isList) modifiers.push('list');
  modifiers.push(field.isOptional ? 'optional' : 'required');
  if (field.isUpdatedAt) modifiers.push('updatedAt');
  return modifiers.join(', ');
}

/**
 * Render the dictionary markdown for a parsed schema.
 *
 * @param {{ models: any[], enums: any[] }} schema
 * @returns {string}
 */
export function renderDataDictionary(schema) {
  const modelNames = new Set(schema.models.map((model) => model.name));
  const enumNames = new Set(schema.enums.map((item) => item.name));
  const models = [...schema.models].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const enums = [...schema.enums].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const out = [];

  const isTenant = (model) => model.fields.some((field) => field.name === 'organizationId');
  const isSoftDelete = (model) => model.fields.some((field) => field.name === 'deletedAt');

  out.push('# Data dictionary');
  out.push('');
  out.push('<!-- GENERATED FILE: do not edit by hand. -->');
  out.push('<!-- Source: prisma/schema.prisma. Regenerate with `npm run docs:data-dictionary`; -->');
  out.push('<!-- CI runs `npm run check:data-dictionary` and fails when this file is stale. -->');
  out.push('');
  out.push('Every Prisma model and enum in `prisma/schema.prisma`, as asked for in #412.');
  out.push('');
  out.push('- **Tenant-scoped** means the model has an `organizationId` column. Whether');
  out.push('  request-scoped queries are filtered by it is decided by');
  out.push('  `src/utils/prisma-tenant-proxy.js`, not by this column alone; models without');
  out.push('  the column may still be tenant-owned through a parent relation.');
  out.push('- **Soft-deletable** means the model has a `deletedAt` column. The policy for');
  out.push('  which reads hide soft-deleted rows is in [soft-delete-policy.md](soft-delete-policy.md).');
  out.push('- **Notes** combine `///` doc comments and trailing `//` comments from the schema.');
  out.push('');
  out.push(`${models.length} models, ${enums.length} enums, `
    + `${models.filter(isTenant).length} tenant-scoped, ${models.filter(isSoftDelete).length} soft-deletable.`);
  out.push('');

  out.push('## Model index');
  out.push('');
  out.push('| Model | Table | Tenant-scoped | Soft-deletable | Fields |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const model of models) {
    const anchor = `model-${model.name.toLowerCase()}`;
    out.push(`| [${model.name}](#${anchor}) | ${code(tableName(model))} | ${isTenant(model) ? 'yes' : 'no'} | `
      + `${isSoftDelete(model) ? 'yes' : 'no'} | ${model.fields.length} |`);
  }
  out.push('');

  out.push('## Models');
  out.push('');
  for (const model of models) {
    out.push(`### Model ${model.name}`);
    out.push('');
    if (model.doc) {
      out.push(escapeCell(model.doc));
      out.push('');
    }
    out.push(`- Table: ${code(tableName(model))}`);
    out.push(`- Tenant-scoped: ${isTenant(model) ? 'yes (`organizationId`)' : 'no'}`);
    out.push(`- Soft-deletable: ${isSoftDelete(model) ? 'yes (`deletedAt`)' : 'no'}`);
    const extraAttributes = model.blockAttributes.filter((attr) => !attr.startsWith('@@map('));
    if (extraAttributes.length) {
      out.push('- Constraints and indexes:');
      for (const attr of extraAttributes) out.push(`  - ${code(attr)}`);
    }
    out.push('');
    out.push('| Field | Type | Modifiers | Default | Relation | Notes |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const field of model.fields) {
      let type = field.type;
      if (enumNames.has(type)) type = `${type} (enum)`;
      else if (!SCALAR_TYPES.has(type) && !modelNames.has(type) && !type.startsWith('Unsupported(')) {
        throw new Error(`Unknown type ${type} on ${model.name}.${field.name}`);
      }
      const notes = [field.doc, field.comment].filter(Boolean).join(' ');
      out.push(`| ${code(field.name)} | ${escapeCell(type + (field.isList ? '[]' : ''))} | ${fieldModifiers(field)} | `
        + `${field.defaultValue !== null ? escapeCell(code(field.defaultValue || '(bare)')) : ''} | `
        + `${escapeCell(describeRelation(field, modelNames))} | ${escapeCell(notes)} |`);
    }
    out.push('');
  }

  out.push('## Enums');
  out.push('');
  if (enums.length === 0) {
    out.push('The schema declares no Prisma enums. Status-like columns are `String`');
    out.push('fields whose allowed values are listed in the field notes above.');
    out.push('');
  }
  for (const item of enums) {
    out.push(`### Enum ${item.name}`);
    out.push('');
    if (item.doc) {
      out.push(escapeCell(item.doc));
      out.push('');
    }
    out.push('| Value | Notes |');
    out.push('| --- | --- |');
    for (const value of item.values) {
      out.push(`| ${code(value.name)} | ${escapeCell([value.doc, value.comment].filter(Boolean).join(' '))} |`);
    }
    out.push('');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

export function generateDataDictionary(schemaPath = SCHEMA_PATH) {
  return renderDataDictionary(parseSchema(fs.readFileSync(schemaPath, 'utf8')));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const expected = generateDataDictionary();
  if (process.argv.includes('--check')) {
    const actual = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
    if (actual !== expected) {
      console.error('docs/data-dictionary.md is out of date with prisma/schema.prisma.');
      console.error('Run `npm run docs:data-dictionary` and commit the result.');
      process.exitCode = 1;
    } else {
      console.log('Data dictionary: up to date');
    }
  } else {
    fs.writeFileSync(OUTPUT_PATH, expected);
    console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  }
}
