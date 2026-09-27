import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientPortalCss } from './helpers/clientPortalSource';

// Guards the #316 convergence of the client portal onto the shared UI
// primitives (docs/ui-primitives.md, "Portal convergence"). Buttons, fields,
// cards, badges, alerts, stats, loading states and typography come from
// web/src/components/ui and design tokens; portal.css keeps only the
// portal-specific layout listed in PORTAL_LAYOUT_CLASSES.

const portalDir = resolve(process.cwd(), 'src/pages/client-portal');
const jsxFiles = [
  resolve(process.cwd(), 'src/pages/ClientPortal.jsx'),
  ...readdirSync(portalDir).filter((f) => f.endsWith('.jsx')).sort().map((f) => resolve(portalDir, f)),
];
const jsx = jsxFiles.map((file) => ({ file: file.replace(`${process.cwd()}/`, ''), source: readFileSync(file, 'utf8') }));
const css = clientPortalCss();

// The only .cp-* classes allowed. Each has no shared primitive yet; the doc
// explains why it stays.
const PORTAL_LAYOUT_CLASSES = [
  'cp-root', 'cp-header', 'cp-tab',
  'cp-kanban', 'cp-kanban-col', 'cp-kanban-col-header', 'cp-kanban-col-body',
  'cp-chat-container', 'cp-chat-messages',
  'cp-upload-zone',
];

// Retired bespoke component classes that were replaced by primitives. They
// must not come back in JSX or CSS.
const RETIRED = [
  'cp-btn-primary', 'cp-btn-secondary', 'cp-btn-danger', 'cp-btn-ghost', 'cp-link',
  'cp-input', 'cp-label',
  'cp-card', 'cp-card--interactive', 'cp-card-title', 'cp-kanban-card', 'cp-chat-bubble', 'cp-chat-input-bar',
  'cp-stat', 'cp-stat-label', 'cp-stat-value',
  'cp-badge', 'cp-badge--green', 'cp-badge--lime', 'cp-badge--orange', 'cp-badge--red', 'cp-badge--blue', 'cp-badge--purple', 'cp-badge--muted',
  'cp-alert', 'cp-alert--red', 'cp-error', 'cp-error-box', 'cp-loading',
  'cp-text', 'cp-text-muted', 'cp-page-title', 'cp-section-title',
  'cp-grid-2', 'cp-grid-3', 'cp-space-y-2', 'cp-space-y-3', 'cp-space-y-4', 'cp-space-y-6', 'cp-visually-hidden',
  'cp-login-bg', 'cp-login-card', 'cp-login-logo', 'cp-login-title', 'cp-login-subtitle', 'cp-login-form', 'cp-login-sent',
];

const classTokens = (source) => [...source.matchAll(/\bcp-[\w-]+/g)].map((m) => m[0]);

describe('client portal primitive convergence (#316)', () => {
  it('uses only the documented portal-specific .cp-* layout classes in JSX', () => {
    const unexpected = jsx.flatMap(({ file, source }) =>
      classTokens(source).filter((cls) => !PORTAL_LAYOUT_CLASSES.includes(cls)).map((cls) => `${file}: ${cls}`));
    expect(unexpected).toEqual([]);
  });

  it('defines only the documented portal-specific .cp-* classes in portal.css', () => {
    const defined = [...new Set([...css.matchAll(/\.(cp-[\w-]+)/g)].map((m) => m[1]))];
    expect(defined.filter((cls) => !PORTAL_LAYOUT_CLASSES.includes(cls))).toEqual([]);
  });

  it('does not bring back retired bespoke component classes', () => {
    for (const cls of RETIRED) {
      expect(css, `portal.css ${cls}`).not.toMatch(new RegExp(`\\.${cls}(?![\\w-])`));
      for (const { file, source } of jsx) {
        expect(source, `${file} ${cls}`).not.toMatch(new RegExp(`\\b${cls}(?![\\w-])`));
      }
    }
  });

  it('builds portal controls from the shared primitives', () => {
    const all = jsx.map(({ source }) => source).join('\n');
    for (const primitive of ['<Button', '<Input', '<Card', '<Badge', '<Alert', '<StatCard', '<LoadingState', '<CardTitle', 'buttonStyles(', 'inputStyles(']) {
      expect(all, primitive).toContain(primitive);
    }
    // Native form controls only where no primitive exists (select, textarea,
    // the hidden file input) and native tabs/upload zone buttons.
    expect(all).not.toMatch(/<input(?![^>]*type="file")/);
    const nativeButtons = [...all.matchAll(/<button\s[^>]*>/g)].map((m) => m[0]);
    for (const button of nativeButtons) {
      expect(button).toMatch(/className="cp-(?:tab|upload-zone)"/);
    }
  });

  it('takes every portal colour from design tokens', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rules).not.toMatch(/\brgba?\(/);
    for (const { file, source } of jsx) {
      expect(source, file).not.toMatch(/['"]#[0-9a-f]{3,8}['"]/i);
      expect(source, file).not.toMatch(/\brgba?\(/);
      expect(source, file).not.toMatch(/\bBRAND\b/);
      // No inline colour styling; token utilities only.
      expect(source, file).not.toMatch(/style=\{\{[^}]*\b(?:color|background|borderColor)\s*:/);
    }
  });

  it('keeps the portal light-only by pinning the light token set while mounted', () => {
    const all = jsx.map(({ source }) => source).join('\n');
    expect(all).toContain("root.classList.remove('dark')");
    expect(all).toContain('usePortalLightTheme();');
  });

  it('keeps 16px mobile text on portal form fields', () => {
    const shared = jsx.find(({ file }) => file.endsWith('shared.jsx')).source;
    expect(shared).toMatch(/portalFieldClass = '[^']*\btext-base\b[^']*\bsm:text-sm\b/);
  });
});
