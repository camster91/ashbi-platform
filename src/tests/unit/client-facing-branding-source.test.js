// Issue #531: client-facing renderers, email templates and the public portal
// pages take the agency's name from its branding (resolveBranding), so none
// may hard-code one agency's name, logo text, domain or people. Comments are
// skipped; stored keys such as the `ashbi-*` proposal template ids and the
// ASHBI_RUN_EMAIL_TESTS toggle are not brand text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const CLIENT_FACING = [
  'src/agents/proposal-builder.agent.js',
  'src/routes/auth.routes.js',
  'src/routes/client-portal.routes.js',
  'src/routes/contract.routes.js',
  'src/routes/estimate.routes.js',
  'src/routes/invoice-chaser.routes.js',
  'src/routes/invoice.routes.js',
  'src/routes/portal.routes.js',
  'src/routes/proposal-builder.routes.js',
  'src/routes/proposal.routes.js',
  'src/services/automation.service.js',
  'src/services/contractTemplates.service.js',
  'src/services/email.service.js',
  'src/services/weeklyReport.service.js',
  'src/utils/generate-contract-pdf.js',
  'src/utils/generate-invoice-pdf.js',
  ...fs.readdirSync(path.join(ROOT, 'src/emails')).filter((name) => name.endsWith('.html')).map((name) => `src/emails/${name}`),
  'web/src/components/PortalBrand.jsx',
  ...fs.readdirSync(path.join(ROOT, 'web/src/pages'))
    .filter((name) => /^Portal.*\.jsx$|^ClientPortal\.jsx$/.test(name))
    .map((name) => `web/src/pages/${name}`),
  ...fs.readdirSync(path.join(ROOT, 'web/src/pages/client-portal'))
    .filter((name) => name.endsWith('.jsx'))
    .map((name) => `web/src/pages/client-portal/${name}`),
];

// "Ashbi Design", the "ASHBI" logo text, the agency's domains and its people.
const BRAND_TEXT = /Ashbi Design|Ashbi Team|\bASHBI\b(?!_)|ashbi\.ca|ashbi\.design|cameron@|'cameron'|\bashbi<\/h1>|>ashbi</;

function codeLines(source) {
  return source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

test('client-facing sources hard-code no agency name, logo text or domain', () => {
  const offenders = [];
  for (const file of CLIENT_FACING) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const { line, number } of codeLines(source)) {
      if (BRAND_TEXT.test(line)) offenders.push(`${file}:${number}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the scan covers the email templates and portal pages', () => {
  assert.ok(CLIENT_FACING.includes('src/emails/invoice-created.html'));
  assert.ok(CLIENT_FACING.includes('web/src/pages/PortalInvoice.jsx'));
  assert.ok(CLIENT_FACING.includes('web/src/pages/ClientPortal.jsx'));
  assert.ok(CLIENT_FACING.length >= 30, `${CLIENT_FACING.length} files`);
});
