// Finds raw colour literals in web/src sources for the design-token guard
// (web/src/tests/raw-color-guard.test.js, #315 / #118).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PALETTE = [
  'gray', 'slate', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
].join('|');

const UTILITIES = [
  'bg', 'text', 'border(?:-[trblxy])?', 'ring', 'ring-offset', 'from', 'to', 'via',
  'divide', 'outline', 'fill', 'stroke', 'placeholder', 'decoration', 'caret',
  'accent', 'shadow',
].join('|');

// A Tailwind palette class, with any variants (`dark:`, `hover:`) and opacity.
export const RAW_CLASS = new RegExp(
  String.raw`(?<![\w-])(?:[\w\-\[\]=&>*]+:)*(?:${UTILITIES})-(?:${PALETTE})-(?:50|[1-9]00|950)(?:\/\d+)?(?![\w-])`,
  'g'
);

// Opaque `bg-white` hard-codes a light surface; use `bg-card` / `bg-background`.
// Translucent white (`bg-white/10`) is a tint over a fixed dark brand surface
// such as the sidebar, so it is allowed.
export const RAW_WHITE_SURFACE = /(?<![\w-])(?:[\w\-\[\]=&>*]+:)*bg-white(?![\w/-])/g;

// A CSS hex colour (#abc, #abcd, #aabbcc, #aabbccdd).
export const HEX_COLOR = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

/** Blank out comments so issue references (`#316`) and prose are ignored. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

export function findRawColors(source) {
  const code = stripComments(source);
  const hits = [];
  const lines = code.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of [RAW_CLASS, RAW_WHITE_SURFACE, HEX_COLOR]) {
      for (const match of line.matchAll(pattern)) hits.push({ line: index + 1, match: match[0] });
    }
  });
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'tests' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?|css)$/.test(name) && !/\.test\.[jt]sx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** `{ 'src/pages/Foo.jsx': [{ line, match }, …] }` for every file with hits. */
export function scanRawColors(webRoot) {
  const result = {};
  for (const file of walk(join(webRoot, 'src'))) {
    const hits = findRawColors(readFileSync(file, 'utf8'));
    if (hits.length) result[relative(webRoot, file).split('\\').join('/')] = hits;
  }
  return result;
}
