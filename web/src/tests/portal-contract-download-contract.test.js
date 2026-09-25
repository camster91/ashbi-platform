import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/ClientPortal.jsx'), 'utf8');

describe('client portal signed contract download contract', () => {
  it('downloads signed contracts through the session-scoped portal route', () => {
    expect(source).toContain('/api/client-portal/contracts/${contract.id}/pdf');
    expect(source).toContain('<ContractsTab contracts={contracts} token={token} />');
  });

  it('only offers the download for contracts the API marks downloadable', () => {
    expect(source).toContain('{contract.canDownload && (');
    expect(source).toContain('aria-label={`Download signed contract PDF: ${contract.title}`}');
  });

  it('announces download failures and pending state', () => {
    expect(source).toContain('The signed contract could not be downloaded.');
    expect(source).toContain('aria-busy={downloadingId === contract.id || undefined}');
  });
});
