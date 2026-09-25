import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'tests' ? [] : sourceFiles(path);
    return /\.(jsx?|tsx?|css)$/.test(entry) ? [path] : [];
  });
}

describe('primary colour utilities', () => {
  it('only uses primary shades that the Tailwind theme defines', () => {
    // `primary` is a CSS-variable token without numbered shades, so classes like
    // `bg-primary-600` silently generate no CSS. Use opacity modifiers instead.
    const primary = tailwindConfig.theme.extend.colors.primary;
    const definedShades = Object.keys(primary).filter((key) => /^\d+$/.test(key));
    const offenders = [];
    for (const file of sourceFiles(resolve(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline)-primary-(\d+)\b/g)) {
        if (!definedShades.includes(match[1])) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
