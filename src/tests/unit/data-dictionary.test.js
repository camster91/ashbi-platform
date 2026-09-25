import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  generateDataDictionary,
  parseSchema,
  renderDataDictionary,
} from '../../../scripts/generate-data-dictionary.mjs';

const DOC_URL = new URL('../../../docs/data-dictionary.md', import.meta.url);

test('schema parser reads tables, tenancy, soft delete, defaults, relations and doc comments', () => {
  const schema = parseSchema([
    '/// A tenant-owned widget.',
    'model Widget {',
    '  id             String    @id @default(cuid())',
    '  /// Owning organization.',
    '  organizationId String',
    '  organization   Organization @relation("Widgets", fields: [organizationId], references: [id], onDelete: Cascade)',
    '  label          String    @default("a // b") // shown to clients',
    '  tags           String[]  @default([])',
    '  embedding      Unsupported("vector(768)")?',
    '  deletedAt      DateTime?',
    '',
    '  @@index([organizationId])',
    '  @@map("widgets")',
    '}',
    'model Organization {',
    '  id String @id',
    '}',
    'enum Colour {',
    '  RED // warm',
    '  BLUE',
    '}',
  ].join('\n'));

  const widget = schema.models.find((model) => model.name === 'Widget');
  assert.equal(widget.doc, 'A tenant-owned widget.');
  const byName = Object.fromEntries(widget.fields.map((field) => [field.name, field]));
  assert.equal(byName.organizationId.doc, 'Owning organization.');
  assert.equal(byName.label.defaultValue, '"a // b"');
  assert.equal(byName.label.comment, 'shown to clients');
  assert.equal(byName.tags.isList, true);
  assert.equal(byName.embedding.type, 'Unsupported("vector(768)")');
  assert.equal(byName.embedding.isOptional, true);
  assert.deepEqual(schema.enums[0].values.map((value) => value.name), ['RED', 'BLUE']);

  const markdown = renderDataDictionary(schema);
  assert.match(markdown, /\| \[Widget\]\(#model-widget\) \| `widgets` \| yes \| yes \| 7 \|/);
  assert.match(markdown, /→ Organization, via \(organizationId\) → \(id\), onDelete Cascade, "Widgets"/);
  assert.match(markdown, /### Enum Colour/);
});

test('docs/data-dictionary.md matches prisma/schema.prisma', () => {
  const expected = generateDataDictionary();
  assert.equal(expected, generateDataDictionary(), 'generator output must be deterministic');
  assert.equal(
    fs.readFileSync(DOC_URL, 'utf8'),
    expected,
    'docs/data-dictionary.md is stale; run npm run docs:data-dictionary',
  );
});
