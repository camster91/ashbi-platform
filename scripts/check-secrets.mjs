#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const allowedExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.json', '.yml', '.yaml', '.md', '.sh', '.py', '.csv']);
const excludedDirectories = new Set(['.git', 'node_modules', 'dist']);
const excludedFiles = new Set(['check-secrets.mjs', 'check-secrets.yml']);
const placeholder = /CHANGE_ME|PLACEHOLDER|your-|example|TestPass/i;
// Reserved documentation domains (example.com / .example / .invalid / .test / .localhost).
const documentationEmail = /@(?:[a-z0-9-]+\.)*example\.(?:com|net|org|invalid)$|@(?:[a-z0-9-]+\.)+(?:example|invalid|test|localhost)$/i;
const emailLiteral = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const clientBookMarker = /\b(?:contactPerson|Contact Email|postalCode|totalRevenueUsd|totalRevenueCad|client_email)\b/;
const streetAddress = /\b\d{1,6}\s+(?!Example\b|Sample\b|Placeholder\b|Fake\b)[A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|Drive|Avenue|Road|Boulevard|Lane|Court|Place|St|Dr|Ave|Rd|Blvd)\b\.?/gi;
const patterns = [
  ['database password', /postgresql?:\/\/[a-zA-Z0-9_]+:[-A-Za-z0-9_!@#$%^&*()+=]{20,}@/g, placeholder],
  ['Redis password', /redis:\/\/[^:]+:[-A-Za-z0-9_!@#$%^&*()+=]{16,}@/g],
  ['Stripe key', /sk_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['AWS access key', /AKIA[0-9A-Z]{16}/g],
  ['Discord webhook', /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]{20,}/g],
  ['JSON login password', /"password"\s*:\s*"(?=[^"]{8,}")(?=[^"]*[A-Za-z])(?=[^"]*[0-9])(?=[^"]*[!@#])[^"]+"/g, placeholder],
  ['documented login credential', /\bLogin as [^\r\n]{1,120} with:\s*(?=\S{8,})(?=[^\r\n]*[A-Za-z])(?=[^\r\n]*[0-9])(?=[^\r\n]*[!@#$%^&*])[^\s`\r\n]+/gi],
];

// Only the documented import at the Git root is private local input. Git's
// index takes precedence over ignore rules, including after `git add --force`.
function approvedLocalImport() {
  try {
    const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const localPath = 'prisma/bonsai-seed.local.json';
    const options = { cwd: repository, stdio: ['ignore', 'pipe', 'ignore'] };
    const tracked = execFileSync('git', ['ls-files', '-z', '--', localPath], options);
    if (tracked.length) return null;
    execFileSync('git', ['check-ignore', '--quiet', '--', localPath], options);
    return resolve(repository, localPath);
  } catch {
    // Standalone fixture directories and Git errors get the full scan.
    return null;
  }
}
const localImport = approvedLocalImport();
let bad = false;

function report(path, content, index, label) {
  const line = content.slice(0, index).split('\n').length;
  const relative = path.slice(root.length + 1).replaceAll('\\', '/');
  console.error(`::error file=${relative},line=${line}::Potential ${label} detected (value redacted)`);
  bad = true;
}

function scanClientBook(path, content) {
  const revenueHits = (content.match(/\btotalRevenue(?:Usd|Cad)\b/g) || []).length;
  const contactHits = (content.match(/\bcontactPerson\b/g) || []).length;
  const roster = revenueHits >= 5 || contactHits >= 8;
  const emails = [];
  emailLiteral.lastIndex = 0;
  let match;
  while ((match = emailLiteral.exec(content)) !== null) {
    if (!documentationEmail.test(match[0])) emails.push(match);
  }
  if (roster || (clientBookMarker.test(content) && emails.length >= 5)) {
    for (const hit of emails) report(path, content, hit.index, 'committed client-book email');
  }
  if (roster || (/\bpostalCode\b/.test(content) && /\bcontactPerson\b/.test(content))) {
    streetAddress.lastIndex = 0;
    while ((match = streetAddress.exec(content)) !== null) {
      report(path, content, match.index, 'committed client street address');
    }
  }
}

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await scan(resolve(directory, entry.name));
      continue;
    }
    if (excludedFiles.has(entry.name)) continue;
    if (!allowedExtensions.has(extname(entry.name)) && !entry.name.includes('.env')) continue;

    const path = resolve(directory, entry.name);
    if (path === localImport) continue;
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
    scanClientBook(path, content);
  }
}

await scan(root);
if (bad) {
  console.error('Secret leak gate: FAIL. Move credentials to the approved secret store and keep client books out of git.');
  process.exit(1);
}
console.log('Secret leak gate: PASS (no hardcoded credentials or client-book exports found)');
