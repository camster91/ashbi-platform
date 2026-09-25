import assert from 'node:assert/strict';
import { after, test } from 'node:test';

// email.service reads MAILGUN_* at module load, so configure a fake key before
// importing it. fetch is stubbed: no request ever reaches Mailgun.
process.env.MAILGUN_API_KEY = 'test-only-mailgun-key';
process.env.MAILGUN_DOMAIN = 'mg.example.test';
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), body: new URLSearchParams(init.body) });
  return new Response(JSON.stringify({ id: '<msg-42@mg.example.test>', message: 'Queued' }), { status: 200 });
};
const { sendInvoiceDeliveryEmail, sendContractSignEmail } = await import('../../services/email.service.js');

after(() => { globalThis.fetch = originalFetch; });

test('invoice delivery email adds document custom variables and returns the message id', async () => {
  const result = await sendInvoiceDeliveryEmail({
    to: 'client@example.test', invoiceNumber: 'INV-9', total: 10, viewUrl: 'https://hub.example.test/x', invoiceId: 'inv-9',
  });
  assert.deepEqual(result, { ok: true, id: '<msg-42@mg.example.test>' });
  const { url, body } = requests.at(-1);
  assert.equal(url, 'https://api.mailgun.net/v3/mg.example.test/messages');
  assert.equal(body.get('v:ashbi-document-type'), 'invoice');
  assert.equal(body.get('v:ashbi-document-id'), 'inv-9');
});

test('contract sign email adds contract custom variables', async () => {
  await sendContractSignEmail({ to: 'client@example.test', clientName: 'C', contractTitle: 'T', signLink: 'https://x', contractId: 'ct-1' });
  const { body } = requests.at(-1);
  assert.equal(body.get('v:ashbi-document-type'), 'contract');
  assert.equal(body.get('v:ashbi-document-id'), 'ct-1');
});
