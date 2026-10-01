import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Keeps the migration playbooks honest: every exception/outcome code an
// importer emits and every CLI flag its script parses must be documented in
// that importer's playbook, and every code must be classified in the shared
// cutover runbook. Codes and flags are found by a deliberately simple static
// scan of the sources, so a new code or flag fails this test until the docs
// catch up.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const COMMON = 'src/services/operator-import-common.js';
const IMPORTERS = {
  slack: {
    doc: 'docs/slack-export-migration.md',
    sources: ['src/services/slack-export-import.service.js', 'scripts/import-slack-export.mjs'],
    clis: ['scripts/import-slack-export.mjs'],
  },
  notion: {
    doc: 'docs/notion-markdown-migration.md',
    sources: ['src/services/notion-markdown-import.service.js', 'scripts/import-notion-markdown.js'],
    clis: ['scripts/import-notion-markdown.js'],
  },
  loom: {
    doc: 'docs/loom-migration.md',
    sources: ['src/services/loom-import.service.js', COMMON, 'scripts/import-loom.mjs'],
    clis: ['scripts/import-loom.mjs'],
  },
  markup: {
    doc: 'docs/markup-migration.md',
    sources: ['src/services/markup-import.service.js', COMMON, 'scripts/import-markup.mjs'],
    clis: ['scripts/import-markup.mjs'],
  },
  clickup: {
    doc: 'docs/clickup-migration.md',
    sources: ['src/services/clickup-import-plan.service.js', 'scripts/import-clickup-tasks.js'],
    clis: ['scripts/import-clickup-tasks.js'],
  },
  bonsai: {
    doc: 'docs/bonsai-migration.md',
    // import-bonsai.js is the disabled legacy importer; it parses no flags.
    sources: ['scripts/import-bonsai-full.js', 'scripts/import-bonsai.js'],
    clis: ['scripts/import-bonsai-full.js', 'scripts/import-bonsai.js'],
  },
};
const RUNBOOK = 'docs/migration-cutover-runbook.md';
const TEMPLATE = 'docs/examples/import-reconciliation-template.md';

const CODE_LITERAL = /'([A-Z][A-Z0-9_]{2,})'/g;
// 1. `code: <expr>` / `this.code = <expr>` (not `code ===`): every
//    upper-case literal in the expression, which covers ternaries.
// 2. Finding helpers called with a literal first argument.
// 3. `new SomethingError('CODE', ...)`.
const CODE_SITES = [
  /\bcode(?:\s*:|\s*=(?!=))\s*([^,;}\n]*)/g,
  /\b(?:blocking|conflict|channelFinding|warning|unsupported)\(\s*('[A-Z][A-Z0-9_]*')/g,
  /\bnew\s+\w*Error\(\s*('[A-Z][A-Z0-9_]*')/g,
];
const FLAG_SITES = [
  /\b(?:option|readOption)\(\s*'(--[a-z][a-z0-9-]*)'/g,
  /\bargv\.(?:includes|indexOf)\(\s*'(--[a-z][a-z0-9-]*)'/g,
];

function scanCodes(source) {
  const codes = new Set();
  for (const site of CODE_SITES) {
    for (const match of source.matchAll(site)) {
      for (const literal of match[1].matchAll(CODE_LITERAL)) codes.add(literal[1]);
    }
  }
  return codes;
}

function scanFlags(source) {
  const flags = new Set();
  for (const site of FLAG_SITES) for (const match of source.matchAll(site)) flags.add(match[1]);
  return flags;
}

const codesOf = (importer) => new Set(importer.sources.flatMap((path) => [...scanCodes(read(path))]));
const flagsOf = (importer) => new Set(importer.clis.flatMap((path) => [...scanFlags(read(path))]));
const documentsCode = (doc, code) => doc.includes(`\`${code}\``);
const documentsFlag = (doc, flag) => new RegExp(`${flag}(?![a-z0-9-])`).test(doc);

test('the scanner finds codes in helpers, ternaries and error constructors but not comparisons', () => {
  const codes = scanCodes(`
    errors.push({ row: 2, code: !id ? 'MISSING_ID' : !title ? 'MISSING_TITLE' : 'DUPLICATE_ID' });
    report.warnings.push({ code: 'UNKNOWN_COLUMN', column });
    this.code = 'IMPORT_BLOCKED';
    blocking('SOURCE_CHANGED', 'changed');
    channelFinding('INVALID_CHANNEL', null, name, 'bad');
    throw new OperatorImportError('MISSING_COLUMNS', 'missing');
    if (error.code === 'ENOENT') return;
    if (warning.code !== 'ATTRIBUTED_TO_OPERATOR') return;
  `);
  assert.deepEqual([...codes].sort(), [
    'DUPLICATE_ID', 'IMPORT_BLOCKED', 'INVALID_CHANNEL', 'MISSING_COLUMNS', 'MISSING_ID', 'MISSING_TITLE', 'SOURCE_CHANGED', 'UNKNOWN_COLUMN',
  ]);
  assert.deepEqual([...scanFlags("const a = option('--input'); const b = readOption('--csv-dir', x); process.argv.includes('--confirm');")].sort(), ['--confirm', '--csv-dir', '--input']);
});

test('every importer script and import service is covered by a playbook', () => {
  const scripts = readdirSync(join(root, 'scripts')).filter((name) => /^import-.*\.(?:js|mjs)$/.test(name)).map((name) => `scripts/${name}`);
  const services = readdirSync(join(root, 'src/services')).filter((name) => /import/.test(name) && name.endsWith('.js')).map((name) => `src/services/${name}`);
  const covered = new Set(Object.values(IMPORTERS).flatMap((importer) => [...importer.sources, ...importer.clis]));
  for (const path of [...scripts, ...services]) assert.ok(covered.has(path), `${path} has no playbook in this test`);
});

test('the scan finds codes and flags where the importers are known to have them', () => {
  for (const [name, importer] of Object.entries(IMPORTERS)) {
    assert.ok(flagsOf(importer).size > 0, `${name}: no CLI flags found; is the scanner still matching the script?`);
    assert.ok(codesOf(importer).size > 0, `${name}: no codes found; is the scanner still matching the service?`);
  }
  // Bonsai's blocking findings are free-text messages in stats.errors; only
  // its non-blocking warnings carry codes, and they are documented like the
  // others.
  assert.deepEqual([...codesOf(IMPORTERS.bonsai)].sort(), ['CLIENT_DOMAIN_TAKEN', 'EXPENSE_NO_CLIENT']);
  assert.ok(codesOf(IMPORTERS.clickup).has('PARENT_CYCLE'));
  assert.ok(codesOf(IMPORTERS.slack).has('LIVE_MAPPING_CONFLICT'));
  assert.ok(codesOf(IMPORTERS.markup).has('INVALID_POSITION'));
  assert.ok(codesOf(IMPORTERS.clickup).has('PARENT_UNRESOLVED'));
});

for (const [name, importer] of Object.entries(IMPORTERS)) {
  test(`${name} playbook documents every emitted code and every parsed CLI flag`, () => {
    const doc = read(importer.doc);
    const missingCodes = [...codesOf(importer)].filter((code) => !documentsCode(doc, code));
    assert.deepEqual(missingCodes, [], `${importer.doc} does not mention these codes (in backticks)`);
    const missingFlags = [...flagsOf(importer)].filter((flag) => !documentsFlag(doc, flag));
    assert.deepEqual(missingFlags, [], `${importer.doc} does not mention these flags`);
  });
}

test('the cutover runbook classifies every code and links every playbook and the template', () => {
  const runbook = read(RUNBOOK);
  const allCodes = new Set(Object.values(IMPORTERS).flatMap((importer) => [...codesOf(importer)]));
  const unclassified = [...allCodes].filter((code) => !documentsCode(runbook, code));
  assert.deepEqual(unclassified, [], `${RUNBOOK} taxonomy does not mention these codes`);
  for (const importer of Object.values(IMPORTERS)) {
    assert.ok(runbook.includes(`(${importer.doc.replace('docs/', '')})`), `${RUNBOOK} does not link ${importer.doc}`);
  }
  assert.ok(runbook.includes('(examples/import-reconciliation-template.md)'));
  for (const heading of ['## Pre-cutover checklist', '## Customer readiness checklist', '## Freeze window', '## Order of imports', '## Verification', '## Go/no-go criteria', '## Rollback per system', '## Normalised exception taxonomy', '## Communication', '## Post-cutover observation']) {
    assert.ok(runbook.includes(heading), `${RUNBOOK} lacks ${heading}`);
  }
});

test('the reconciliation template carries counts, exceptions by code, reviewer and decision', () => {
  const template = read(TEMPLATE);
  for (const text of ['Source count', 'Unchanged', 'Skipped', '## Exceptions by code', 'Reviewer', '## Decision']) {
    assert.ok(template.includes(text), `${TEMPLATE} lacks ${text}`);
  }
});
