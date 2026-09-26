// Every capability token carried in a URL is masked in request logs (#417
// security review follow-up): review share links and the older portal view,
// signing and magic links.
import assert from 'node:assert/strict';
import test from 'node:test';
import { redactCapabilityUrl, serializeRequestForLog } from '../../utils/log-redaction.js';

const TOKEN = 'Zq9-capabilityToken_0123456789abcdefghijklm';

test('capability tokens in API and SPA paths are masked', () => {
  const cases = {
    [`/api/portal/review/${TOKEN}/file`]: '/api/portal/review/[Redacted]/file',
    [`/portal/review/${TOKEN}`]: '/portal/review/[Redacted]',
    [`/api/portal/proposal/${TOKEN}/approve`]: '/api/portal/proposal/[Redacted]/approve',
    [`/portal/proposal/${TOKEN}`]: '/portal/proposal/[Redacted]',
    [`/api/portal/contract/${TOKEN}/sign`]: '/api/portal/contract/[Redacted]/sign',
    [`/portal/contract/${TOKEN}`]: '/portal/contract/[Redacted]',
    [`/api/portal/invoice/${TOKEN}/pay`]: '/api/portal/invoice/[Redacted]/pay',
    [`/portal/invoice/${TOKEN}`]: '/portal/invoice/[Redacted]',
    [`/api/portal/form/${TOKEN}`]: '/api/portal/form/[Redacted]',
    [`/portal/form/${TOKEN}`]: '/portal/form/[Redacted]',
    [`/portal/estimate/${TOKEN}`]: '/portal/estimate/[Redacted]',
    [`/api/portal/${TOKEN}`]: '/api/portal/[Redacted]',
    [`/portal/${TOKEN}?tab=1`]: '/portal/[Redacted]?tab=1',
    [`/api/proposals/client/${TOKEN}/approve`]: '/api/proposals/client/[Redacted]/approve',
    [`/api/contracts/sign/${TOKEN}`]: '/api/contracts/sign/[Redacted]',
    [`/api/estimates/view/${TOKEN}/approve`]: '/api/estimates/view/[Redacted]/approve',
    [`/api/invoices/client/${TOKEN}`]: '/api/invoices/client/[Redacted]',
    [`/client-portal/verify?token=${TOKEN}&next=1`]: '/client-portal/verify?token=[Redacted]&next=1',
    [`/reset-password?token=${TOKEN}`]: '/reset-password?token=[Redacted]',
  };
  for (const [url, expected] of Object.entries(cases)) {
    assert.equal(redactCapabilityUrl(url), expected, url);
    assert.equal(JSON.stringify(serializeRequestForLog({ method: 'GET', url, headers: {} })).includes(TOKEN), false, url);
  }
});

test('ordinary routes and the named portal pages are left alone', () => {
  for (const url of ['/portal/book', '/api/portal/booking/availability?date=2026-10-01', '/api/portal/booking', '/api/reviews/cm1abc', '/api/client-portal/documents/doc-1', '/api/attachments/uploads/x.png', '/dashboard']) {
    assert.equal(redactCapabilityUrl(url), url, url);
  }
});
