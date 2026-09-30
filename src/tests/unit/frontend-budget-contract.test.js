import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUDGETS, PUBLIC_ROUTES, validateFrontendBudgets } from '../../../scripts/check-frontend-budgets.mjs';

function fixture({ entryBytes = 10, routeBytes = 10 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-budget-'));
  fs.mkdirSync(path.join(root, '.vite'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'entry.js'), Buffer.alloc(entryBytes));
  fs.writeFileSync(path.join(root, 'assets', 'entry.css'), Buffer.alloc(10));
  const manifest = {
    'index.html': {
      file: 'assets/entry.js', isEntry: true, css: ['assets/entry.css'],
      dynamicImports: PUBLIC_ROUTES.map((route) => `src/pages/${route}.jsx`),
    },
  };
  for (const route of PUBLIC_ROUTES) {
    const file = `assets/${route}.js`;
    fs.writeFileSync(path.join(root, file), Buffer.alloc(routeBytes));
    manifest[`src/pages/${route}.jsx`] = { file, isDynamicEntry: true };
  }
  fs.writeFileSync(path.join(root, '.vite', 'manifest.json'), JSON.stringify(manifest));
  return root;
}

test('valid production manifest passes every frontend budget', () => {
  const root = fixture();
  try { assert.deepEqual(validateFrontendBudgets(root), []); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('oversized entry and missing public route fail closed', () => {
  const root = fixture({ entryBytes: BUDGETS.entryJs + 1 });
  try {
    const manifestPath = path.join(root, '.vite', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest['index.html'].dynamicImports = manifest['index.html'].dynamicImports.filter((key) => !key.endsWith('/Login.jsx'));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const failures = validateFrontendBudgets(root);
    assert.ok(failures.some((failure) => failure.includes('entry JavaScript')));
    assert.ok(failures.some((failure) => failure.includes('Login is not an independent')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker bundles outside the manifest have their own budget', () => {
  const root = fixture();
  try {
    const worker = path.join(root, 'assets', 'pdf-render.worker-AbC123.js');
    fs.writeFileSync(worker, Buffer.alloc(BUDGETS.workerJs));
    assert.deepEqual(validateFrontendBudgets(root), [], 'a worker at the budget passes');
    fs.writeFileSync(worker, Buffer.alloc(BUDGETS.workerJs + 1));
    const failures = validateFrontendBudgets(root);
    assert.ok(failures.some((failure) => failure.includes('worker assets/pdf-render.worker-AbC123.js')), failures.join('; '));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a worker statically imported by the entry fails the initial-graph rule', () => {
  const root = fixture();
  try {
    const file = 'assets/pdf-render.worker-AbC123.js';
    fs.writeFileSync(path.join(root, file), Buffer.alloc(10));
    const manifestPath = path.join(root, '.vite', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest['src/pdf-render.worker.js'] = { file };
    manifest['index.html'].imports = ['src/pdf-render.worker.js'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const failures = validateFrontendBudgets(root);
    assert.ok(failures.some((failure) => failure.includes(`worker ${file} is in the initial JavaScript graph`)), failures.join('; '));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
