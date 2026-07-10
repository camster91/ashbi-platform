// Verify all *Schema references in routes are imported AND defined in schemas.js
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const routesDir = path.join(ROOT, 'src/routes');
const schemasPath = path.join(ROOT, 'src/validators/schemas.js');

const schemasCode = fs.readFileSync(schemasPath, 'utf8');
const exports = new Set();
for (const m of schemasCode.matchAll(/^export const (\w+)\s*=/gm)) exports.add(m[1]);

let badRefs = [];
const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js')).sort();

for (const f of routeFiles) {
  const c = fs.readFileSync(path.join(routesDir, f), 'utf8');
  const imported = new Set();
  for (const m of c.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.{1,2}\/validators\/schemas(?:\.js)?['"]/g)) {
    for (let n of m[1].split(',')) {
      n = n.replace(/\s+as\s+\w+/, '').trim();
      if (n && !n.startsWith('import') && n !== '{' && n !== '}') imported.add(n);
    }
  }
  for (const m of c.matchAll(/\b([a-z][A-Za-z]*Schema)\b/g)) {
    const name = m[1];
    if (!imported.has(name)) badRefs.push([f, name, 'not-imported']);
    else if (!exports.has(name)) badRefs.push([f, name, 'not-defined']);
  }
}

if (badRefs.length === 0) {
  console.log(`OK: ${routeFiles.length} route files, ${exports.size} schemas defined, all references resolve.`);
} else {
  for (const r of badRefs) console.log(r.join(' :: '));
  console.log(`\nTOTAL BAD: ${badRefs.length}`);
  process.exit(1);
}
