import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_THEME, renderEmailTheme } from '../../emails/theme.js';
import { loadTemplate } from '../../services/email.service.js';

const EMAIL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'emails');
const templates = readdirSync(EMAIL_DIR).filter((name) => name.endsWith('.html'));

test('every email template takes its colours from the shared email theme (#315)', () => {
  assert.ok(templates.length >= 8);
  for (const name of templates) {
    const html = readFileSync(path.join(EMAIL_DIR, name), 'utf8');
    assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b/i, `${name} has a hex colour; use {{theme.*}}`);
    assert.doesNotMatch(html, /rgba?\(/i, `${name} has an rgb() colour; use {{theme.*}}`);
    assert.match(html, /\{\{theme\.indigo\}\}/, `${name} should use the brand indigo`);
    for (const [, key] of html.matchAll(/\{\{theme\.(\w+)\}\}/g)) {
      assert.ok(Object.hasOwn(EMAIL_THEME, key), `${name} uses unknown theme colour ${key}`);
    }
  }
});

test('renderEmailTheme fills theme colours and rejects unknown names', () => {
  assert.equal(renderEmailTheme('<p style="color:{{theme.indigo}}">{{clientName}}</p>'), '<p style="color:#2e2958">{{clientName}}</p>');
  assert.throws(() => renderEmailTheme('{{theme.nope}}'), /Unknown email theme colour: nope/);
});

test('loadTemplate renders theme colours before user variables, which cannot inject theme tokens', async () => {
  const injected = 'X{{theme.lime}}X';
  const html = await loadTemplate('welcome.html', { clientName: injected, portalLink: 'https://example.test', senderName: 'Ashbi' });
  assert.match(html, /background-color:#2e2958/i);
  // The user value is inserted verbatim, not resolved to a colour…
  assert.ok(html.includes(injected));
  // …and no template placeholder is left unresolved.
  assert.doesNotMatch(html.split(injected).join(''), /\{\{theme\./);
});

test('email brand colours match the web brand colours', () => {
  const config = readFileSync(path.join(EMAIL_DIR, '..', '..', 'web', 'tailwind.config.js'), 'utf8');
  for (const [key, brand] of [['indigo', 'indigo'], ['lime', 'lime'], ['cream', 'cream']]) {
    assert.match(config, new RegExp(`${brand}: "${EMAIL_THEME[key]}"`), `${key} should match web brand.${brand}`);
  }
});
