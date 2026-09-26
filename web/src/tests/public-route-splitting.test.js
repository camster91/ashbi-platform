import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const publicPages = [
  'Login', 'ForgotPassword', 'ResetPassword', 'Portal', 'PortalProposal',
  'PortalContract', 'PortalInvoice', 'PortalBooking', 'PortalIntakeForm',
  'PortalEstimate', 'PortalReview', 'ClientPortal',
];

describe('public route splitting contract', () => {
  it.each(publicPages)('%s is loaded through React.lazy', (page) => {
    expect(app).toContain(`const ${page} = lazy(() => import('./pages/${page}'))`);
    expect(app).not.toContain(`import ${page} from './pages/${page}'`);
  });

  it('wraps public routes in an accessible route loading boundary', () => {
    expect(app).toContain('<Suspense fallback={<RouteLoader />}>');
    expect(app).toContain('aria-label="Loading page"');
    expect(app).toContain('motion-reduce:animate-none');
  });
});
