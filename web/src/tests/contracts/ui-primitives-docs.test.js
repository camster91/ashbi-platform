import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Keeps docs/ui-primitives.md in step with the primitive sources.
const webRoot = process.cwd();
const repoRoot = resolve(webRoot, '..');
const doc = readFileSync(resolve(repoRoot, 'docs/ui-primitives.md'), 'utf8');

const uiDir = resolve(webRoot, 'src/components/ui');
const primitiveFiles = [
  ...readdirSync(uiDir).filter((f) => f.endsWith('.jsx')).map((f) => `src/components/ui/${f}`),
  'src/components/Modal.jsx',
  'src/components/ConfirmDialog.jsx',
];

const read = (webRelative) => readFileSync(resolve(webRoot, webRelative), 'utf8');

// PascalCase exports only (components); UPPER_SNAKE constants are skipped.
const isComponentName = (name) => /^[A-Z][a-z]\w*$/.test(name);

function exportedComponents(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s+(?:default\s+)?(?:function|const)\s+(\w+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+default\s+(\w+)\s*;/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && name !== 'default') names.add(name);
    }
  }
  return [...names].filter(isComponentName);
}

const headings = doc.split('\n').filter((line) => line.startsWith('### '));

// Split the doc into `###` sections, each with its `Source:` file.
const sections = doc.split(/^### /m).slice(1).map((body) => {
  const title = body.split('\n')[0];
  const source = body.match(/^Source: `web\/(src\/[^`]+)`/m)?.[1];
  return { title, body, source };
});

const LIST_LINE = /^\*\*(Variants|Sizes|Colors|Padding|Icons):\*\*(.*)$/gm;

describe('docs/ui-primitives.md contract', () => {
  it('has a section for every exported primitive', () => {
    const missing = [];
    for (const file of primitiveFiles) {
      for (const name of exportedComponents(read(file))) {
        if (!headings.some((h) => h.includes(`\`${name}\``))) missing.push(`${name} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('points every section at a real source file', () => {
    expect(sections.length).toBeGreaterThan(10);
    for (const { title, source } of sections) {
      expect(source, `section "${title}" needs a Source: line`).toBeTruthy();
      expect(primitiveFiles, `section "${title}"`).toContain(source);
    }
  });

  it('only documents variant, size and colour names that exist in the source', () => {
    const unknown = [];
    let listed = 0;
    for (const { title, body, source } of sections) {
      if (!source) continue;
      const code = read(source);
      for (const [, kind, values] of body.matchAll(LIST_LINE)) {
        for (const [, value] of values.matchAll(/`([^`]+)`/g)) {
          listed += 1;
          const key = new RegExp(`(^|[\\s{,])${value}:|'${value}'`, 'm');
          if (!key.test(code)) unknown.push(`${title} ${kind}: ${value}`);
        }
      }
    }
    expect(listed).toBeGreaterThan(20);
    expect(unknown).toEqual([]);
  });

  it('maps every client portal .cp-* class to a convergence target', () => {
    const css = read('src/pages/client-portal/portal.css');
    const classes = [...new Set(css.match(/\.cp-[\w-]+/g))];
    expect(classes.length).toBeGreaterThan(0);
    const convergence = doc.slice(doc.indexOf('## Portal convergence'));
    const unmapped = classes.filter((cls) => !convergence.includes(`\`${cls}\``));
    expect(unmapped).toEqual([]);
  });
});
