import { describe, expect, it } from 'vitest';
import { clientPortalSource } from './helpers/clientPortalSource';

const source = clientPortalSource();

describe('client portal document deletion contract', () => {
  it('uses a shared accessible confirmation in both document surfaces', () => {
    expect(source).toContain("import ConfirmDialog from '../../components/ConfirmDialog'");
    expect(source.match(/<ConfirmDialog/g)).toHaveLength(2);
    expect(source.match(/Permanently delete .*This removes the file from the client portal and cannot be undone\./g)).toHaveLength(2);
  });

  it('names the selected document and guards duplicate deletion requests', () => {
    expect(source.match(/documentToDelete/g).length).toBeGreaterThanOrEqual(10);
    expect(source.match(/pending=\{deletingDocument\}/g)).toHaveLength(2);
    expect(source.match(/disabled=\{deletingDocument\}/g)).toHaveLength(2);
  });

  it('keeps delete failures in the open dialog instead of reporting success', () => {
    expect(source.match(/deleteError/g).length).toBeGreaterThanOrEqual(4);
    expect(source.match(/error=\{deleteError\}/g)).toHaveLength(2);
    expect(source).not.toContain('onClick={() => handleDeleteDoc(doc.id)}');
  });
});
