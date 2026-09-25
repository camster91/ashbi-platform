import { describe, expect, it } from 'vitest';
import { clientPortalSource } from './helpers/clientPortalSource';

const source = clientPortalSource();

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
