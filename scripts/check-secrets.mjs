#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const allowedExtensions = new Set(['.js', '.ts', '.json', '.yml', '.yaml', '.md', '.sh', '.py']);
const excludedDirectories = new Set(['.git', 'node_modules', 'dist']);
const excludedFiles = new Set(['check-secrets.mjs', 'check-secrets.yml']);
const placeholder = /CHANGE_ME|PLACEHOLDER|your-|example|TestPass/i;
const patterns = [
  ['database password', /postgresql?:\/\/[a-zA-Z0-9_]+:[-A-Za-z0-9_!@#$%^&*()+=]{20,}@/g, placeholder],
  ['Redis password', /redis:\/\/[^:]+:[-A-Za-z0-9_!@#$%^&*()+=]{16,}@/g],
  ['Stripe key', /sk_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['AWS access key', /AKIA[0-9A-Z]{16}/g],
  ['Discord webhook', /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]{20,}/g],
  ['JSON login password', /"password"\s*:\s*"(?=[^"]{8,}")(?=[^"]*[A-Za-z])(?=[^"]*[0-9])(?=[^"]*[!@#])[^"]+"/g, placeholder],
  ['documented login credential', /\bLogin as [^\r\n]{1,120} with:\s*(?=\S{8,})(?=[^\r\n]*[A-Za-z])(?=[^\r\n]*[0-9])(?=[^\r\n]*[!@#$%^&*])[^\s`\r\n]+/gi],
];

let bad = false;

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await scan(resolve(directory, entry.name));
      continue;
    }
    if (excludedFiles.has(entry.name)) continue;
    if (!allowedExtensions.has(extname(entry.name)) && !entry.name.includes('.env')) continue;

    const path = resolve(directory, entry.name);
    const content = await readFile(path, 'utf8');
    for (const [label, pattern, allowed] of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (allowed?.test(match[0])) continue;
        const line = content.slice(0, match.index).split('\n').length;
        const relative = path.slice(root.length + 1).replaceAll('\\', '/');
        console.error(`::error file=${relative},line=${line}::Potential hardcoded ${label} detected (value redacted)`);
        bad = true;
      }
    }
  }
}

await scan(root);
if (bad) {
  console.error('Secret leak gate: FAIL. Move credentials to the approved secret store.');
  process.exit(1);
}
console.log('Secret leak gate: PASS (no hardcoded credentials found)');
