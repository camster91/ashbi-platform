import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), 'web', relativePath), 'utf8');

test('staff inquiry page is wired into the app and primary navigation', () => {
  const app = read('src/App.jsx');
  const layout = read('src/components/Layout.jsx');
  assert.match(app, /const LeadInbox = lazy\(\(\) => import\('\.\/pages\/LeadInbox'\)\)/);
  assert.match(app, /<Route path="\/inquiries" element={<LeadInbox \/>} \/>/);
  assert.match(layout, /name: 'Inquiries', href: '\/inquiries'/);
});

test('inquiry page uses the governed API for list, detail, review, and conversion', () => {
  const api = read('src/lib/api.js');
  assert.match(api, /getQualifiedLeads:[\s\S]*client-acquisition\/leads/);
  assert.match(api, /getQualifiedLead:[\s\S]*client-acquisition\/leads\/\$\{id\}/);
  assert.match(api, /updateLeadQualification:[\s\S]*qualification[\s\S]*method: 'PATCH'/);
  assert.match(api, /convertQualifiedLead:[\s\S]*convert[\s\S]*method: 'POST'/);
});

test('inquiry page shows evidence and requires deliberate conversion confirmation', () => {
  const page = read('src/pages/LeadInbox.jsx');
  assert.match(page, /Business context/);
  assert.match(page, /Requested outcome/);
  assert.match(page, /budgetCurrency/);
  assert.match(page, /qualificationNotes/);
  assert.match(page, /qualificationReasonCode/);
  assert.match(page, /nextAction/);
  assert.match(page, /nextActionDueAt/);
  assert.match(page, /Account owner/);
  assert.match(page, /Attribution/);
  assert.match(page, /Follow-up overdue/);
  assert.match(page, /QUALIFIED/);
  assert.match(page, /ConfirmDialog/);
  assert.match(page, /Convert to client/);
  assert.match(page, /No inquiries match this view/);
  assert.match(page, /QueryErrorState/);
});
