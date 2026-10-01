import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRawColors, scanRawColors } from './helpers/rawColors';

// Design-token guard (#315, #118). Raw Tailwind palette classes
// (`bg-gray-100`, `text-red-600`, `dark:bg-slate-800`, …), opaque `bg-white`
// and hex colours hard-code one theme. Use the semantic tokens from
// `web/src/index.css` instead (`bg-card`, `text-muted-foreground`,
// `bg-success/10`, `text-destructive`, …); `brand-*` colours are for the
// fixed brand surfaces only. The few deliberate exceptions live in
// raw-color-allowlist.json with a reason and an exact count that can only
// go down.

const webRoot = process.cwd();
const allowlist = JSON.parse(readFileSync(resolve(webRoot, 'src/tests/raw-color-allowlist.json'), 'utf8')).files;
const found = scanRawColors(webRoot);

// Keep the exception list short. Raise this only with design-owner approval.
const MAX_ALLOWLISTED_FILES = 14;

describe('raw colour guard', () => {
  it('detects palette classes, variants, opaque white and hex, but not tokens, tints or comments', () => {
    const hits = findRawColors([
      'className="bg-gray-100 dark:bg-slate-800 hover:text-red-600 border-l-blue-500 from-violet-500 bg-red-500/10"',
      'className="bg-white text-white bg-white/10 bg-card text-muted-foreground bg-success/10 bg-brand-indigo"',
      "ctx.fillStyle = '#1e293b'; const c = '#abc'; const x = 'bg-[#2e2958]';",
      '// Tracked in #316 and #1234; bg-gray-100 in a comment',
      '/* text-red-500 #ffffff */ const url = "/items#top";',
    ].join('\n')).map(({ match }) => match);
    expect(hits).toEqual([
      'bg-gray-100', 'dark:bg-slate-800', 'hover:text-red-600', 'border-l-blue-500', 'from-violet-500', 'bg-red-500/10',
      'bg-white',
      '#1e293b', '#abc', '#2e2958',
    ]);
  });

  it('finds no raw colours outside the allowlist', () => {
    const unexpected = Object.entries(found)
      .filter(([file]) => !allowlist[file])
      .map(([file, hits]) => `${file}: ${hits.map(({ line, match }) => `${line}:${match}`).join(', ')}`);
    expect(unexpected, 'Use design tokens (see docs/ui-primitives.md, Design tokens)').toEqual([]);
  });

  it.each(Object.entries(allowlist))('%s stays at its allowlisted count (ratchet)', (file, { count, reason }) => {
    expect(reason?.trim().length, `${file} needs a reason`).toBeGreaterThan(20);
    const actual = found[file]?.length || 0;
    expect(actual, `${file} has more raw colours than allowed; use tokens instead`).toBeLessThanOrEqual(count);
    expect(actual, `${file} dropped to ${actual}: lower its count in raw-color-allowlist.json (remove the entry at 0)`).toBe(count);
  });

  it('keeps the allowlist small', () => {
    expect(Object.keys(allowlist).length).toBeLessThanOrEqual(MAX_ALLOWLISTED_FILES);
  });
});
