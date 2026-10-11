#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCES = new Set(['notion', 'fluentboards', 'bonsai']);
const COVERAGE = {
  notion: { '.md': 'markdown-import-candidate', '.csv': 'database-mapping-required' },
  fluentboards: { '.json': 'board-mapping-required', '.csv': 'board-or-timesheet-mapping-required' },
  bonsai: { '.csv': 'finance-import-candidate' },
};

/** Read-only file inventory. A candidate format does not prove import fidelity. */
export async function inventoryMigrationSource({ source, inputDir }) {
  if (!SOURCES.has(source)) throw new Error('Source must be notion, fluentboards or bonsai');
  const root = path.resolve(inputDir);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Input must be a real directory, not a symlink');
  const files = [];
  const findings = [];
  let visited = 0;
  async function walk(directory, depth = 0) {
    if (depth > 64) throw new Error('Export exceeds the 64-level inventory limit');
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      if (++visited > 10000) throw new Error('Export exceeds the 10000-entry inventory limit; split into batches');
      const filename = path.join(directory, name);
      const relativePath = path.relative(root, filename).split(path.sep).join('/');
      const stat = await lstat(filename);
      if (stat.isSymbolicLink()) {
        findings.push({ code: 'SYMLINK_REFUSED', path: relativePath });
      } else if (stat.isDirectory()) {
        await walk(filename, depth + 1);
      } else if (stat.isFile()) {
        const digest = createHash('sha256');
        let bytes = 0;
        for await (const chunk of createReadStream(filename)) { digest.update(chunk); bytes += chunk.length; }
        const after = await lstat(filename);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || bytes !== stat.size) throw new Error('Source changed during inventory; freeze the export and retry');
        const extension = path.extname(name).toLowerCase();
        const coverage = COVERAGE[source][extension] ?? 'preservation-or-mapping-required';
        files.push({ path: relativePath, bytes, sha256: digest.digest('hex'), extension, coverage });
        if (coverage !== 'markdown-import-candidate' && coverage !== 'finance-import-candidate') findings.push({ code: 'MAPPING_REQUIRED', path: relativePath });
      } else {
        findings.push({ code: 'SPECIAL_FILE_REFUSED', path: relativePath });
      }
    }
  }
  await walk(root);
  if (!files.length) findings.push({ code: 'EMPTY_EXPORT' });
  const manifestSha256 = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return {
    version: 1, mode: 'inventory-only', source, generatedAt: new Date().toISOString(),
    fileCount: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0),
    manifestSha256, files, findings,
    migrationReady: false,
    nextStep: 'Review identity, workspace, permissions, entity mappings and fidelity in staging. This tool never imports data.',
  };
}

export async function runInventory(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--source': 'source', '--input-dir': 'inputDir', '--summary-file': 'summaryFile' }[argv[i]];
    if (!key || options[key] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: --source notion|fluentboards|bonsai --input-dir DIRECTORY --summary-file NEW_REPORT.json');
    options[key] = argv[i + 1];
  }
  if (!options.source || !options.inputDir || !options.summaryFile) throw new Error('Source, input directory and new report path are required');
  const input = path.resolve(options.inputDir);
  const output = path.resolve(options.summaryFile);
  const relative = path.relative(input, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Report must be outside the source directory');
  const report = await inventoryMigrationSource(options);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runInventory(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify({ source: report.source, fileCount: report.fileCount, bytes: report.bytes, manifestSha256: report.manifestSha256, migrationReady: false }));
  }).catch(() => {
    // Avoid leaking filenames or source content into shared CI/terminal logs.
    console.error('Inventory failed: check source/options, freeze the export, and use a new report path outside the source.');
    process.exitCode = 1;
  });
}
