import { describe, expect, it } from 'vitest';
import { inlineEntryCssPlugin } from '../../../vite.config.js';

const css = '@font-face{src:url(/assets/font.woff2)}body{color:red}';
const asset = { type: 'asset', fileName: 'assets/main.css', source: css };
const bundle = { 'assets/main.css': asset };

function transform(html, base = '/') {
  const plugin = inlineEntryCssPlugin();
  plugin.configResolved({ base });
  return plugin.transformIndexHtml.handler(html, { bundle });
}

describe('entry CSS delivery', () => {
  it('inlines the exact emitted stylesheet while retaining its asset for cache consumers', () => {
    const html = transform('<head><link rel="stylesheet" crossorigin href="/assets/main.css"></head>');
    expect(html).toBe(`<head><style data-entry-css="assets/main.css">${css}</style></head>`);
    expect(bundle['assets/main.css']).toBe(asset);
    expect(asset.source).toBe(css);
  });

  it('keeps external, unknown, non-stylesheet and body links untouched', () => {
    const html = '<head><link rel="stylesheet" href="https://example.com/site.css"><link rel="stylesheet" href="/other.css"><link rel="preload" href="/assets/main.css"></head><body><link rel="stylesheet" href="/assets/main.css"></body>';
    expect(transform(html)).toBe(html);
  });

  it('preserves conditional and integrity-protected stylesheet links', () => {
    for (const attribute of ['media="print"', 'disabled', 'title="Alternate"', 'integrity="sha256-value"']) {
      const html = `<head><link rel="stylesheet" ${attribute} href="/assets/main.css"></head>`;
      expect(transform(html)).toBe(html);
    }
  });

  it('leaves nonstandard asset filenames out of HTML attributes', () => {
    const html = '<head><link rel="stylesheet" href="/assets/main unsafe.css"></head>';
    const plugin = inlineEntryCssPlugin();
    expect(plugin.transformIndexHtml.handler(html, {
      bundle: { unsafe: { ...asset, fileName: 'assets/main unsafe.css' } },
    })).toBe(html);
  });

  it('matches the configured base without changing stylesheet contents', () => {
    expect(transform('<head><link rel="stylesheet" href="/hub/assets/main.css"></head>', '/hub/'))
      .toContain(`<style data-entry-css="assets/main.css">${css}</style>`);
  });

  it('rejects HTML style terminators rather than injecting markup', () => {
    const plugin = inlineEntryCssPlugin();
    expect(() => plugin.transformIndexHtml.handler('<head><link rel="stylesheet" href="/assets/main.css"></head>', {
      bundle: { bad: { ...asset, source: 'body{content:"</StYlE><script>"}' } },
    })).toThrow(/unsafe HTML style terminator/);
  });

  it('leaves development HTML processing unchanged', () => {
    expect(inlineEntryCssPlugin().apply).toBe('build');
  });
});
