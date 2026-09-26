import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scrubCapabilityTokens, scrubTelemetry, sentryScrubOptions } from '../lib/telemetry-scrub';

const TOKEN = 'Zq9-capabilityToken_0123456789abcdefghijklm';

describe('telemetry capability-token scrubbing', () => {
  it.each([
    [`/portal/review/${TOKEN}`, '/portal/review/:token'],
    [`/api/portal/review/${TOKEN}/file`, '/api/portal/review/:token/file'],
    [`/portal/proposal/${TOKEN}`, '/portal/proposal/:token'],
    [`/api/portal/proposal/${TOKEN}/approve`, '/api/portal/proposal/:token/approve'],
    [`/portal/contract/${TOKEN}`, '/portal/contract/:token'],
    [`/api/portal/contract/${TOKEN}/sign`, '/api/portal/contract/:token/sign'],
    [`/portal/invoice/${TOKEN}`, '/portal/invoice/:token'],
    [`/api/portal/invoice/${TOKEN}/pay`, '/api/portal/invoice/:token/pay'],
    [`/portal/form/${TOKEN}`, '/portal/form/:token'],
    [`/api/portal/form/${TOKEN}`, '/api/portal/form/:token'],
    [`/portal/estimate/${TOKEN}`, '/portal/estimate/:token'],
    [`/portal/${TOKEN}`, '/portal/:token'],
    [`/api/portal/${TOKEN}`, '/api/portal/:token'],
    [`/api/proposals/client/${TOKEN}/approve`, '/api/proposals/client/:token/approve'],
    [`/api/contracts/sign/${TOKEN}`, '/api/contracts/sign/:token'],
    [`/api/estimates/view/${TOKEN}`, '/api/estimates/view/:token'],
    [`/api/invoices/client/${TOKEN}`, '/api/invoices/client/:token'],
    [`https://hub.ashbi.ca/portal/review/${TOKEN}?x=1#c`, 'https://hub.ashbi.ca/portal/review/:token?x=1#c'],
    [`GET https://hub.ashbi.ca/api/portal/review/${TOKEN}/file [200]`, 'GET https://hub.ashbi.ca/api/portal/review/:token/file [200]'],
    [`/client-portal/verify?token=${TOKEN}`, '/client-portal/verify?token=:token'],
    [`/reset-password?token=${TOKEN}&a=1`, '/reset-password?token=:token&a=1'],
  ])('%s', (input, expected) => {
    expect(scrubCapabilityTokens(input)).toBe(expected);
  });

  it('leaves ordinary paths and named portal pages alone', () => {
    for (const path of ['/portal/book', '/api/portal/booking/availability?date=2026-10-01', '/review/cm1abc', '/project/p1', '/api/reviews/cm1abc']) {
      expect(scrubCapabilityTokens(path)).toBe(path);
    }
    expect(scrubCapabilityTokens('/portal/:token')).toBe('/portal/:token');
  });

  it('scrubs URLs, transactions, spans and breadcrumbs anywhere in an event', () => {
    const event = {
      request: { url: `https://hub.ashbi.ca/portal/review/${TOKEN}`, headers: { Referer: `https://hub.ashbi.ca/portal/proposal/${TOKEN}` } },
      transaction: `/portal/review/${TOKEN}`,
      spans: [{ description: `GET /api/portal/review/${TOKEN}/file`, data: { 'http.url': `/api/portal/review/${TOKEN}/file` } }],
      breadcrumbs: [{ category: 'navigation', data: { from: `/portal/${TOKEN}`, to: `/portal/invoice/${TOKEN}` } }],
      tags: { url: `/api/contracts/sign/${TOKEN}` },
      contexts: { trace: { data: { url: `/portal/form/${TOKEN}` } } },
    };
    for (const hook of [sentryScrubOptions.beforeSend, sentryScrubOptions.beforeSendTransaction]) {
      const scrubbed = hook(event);
      expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
      expect(scrubbed.transaction).toBe('/portal/review/:token');
    }
    const crumb = sentryScrubOptions.beforeBreadcrumb({ category: 'fetch', data: { url: `/api/portal/review/${TOKEN}/annotations`, method: 'POST' } });
    expect(crumb.data).toEqual({ url: '/api/portal/review/:token/annotations', method: 'POST' });
    expect(event.transaction).toContain(TOKEN); // the original is not mutated
  });

  it('survives circular and deep structures', () => {
    const loop = { url: `/portal/${TOKEN}` };
    loop.self = loop;
    expect(scrubTelemetry(loop)).toEqual({ url: '/portal/:token', self: '[circular]' });
  });

  it('is wired into the Sentry initialisation', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    expect(main).toContain("import('./lib/telemetry-scrub')");
    expect(main).toContain('...sentryScrubOptions');
  });
});
