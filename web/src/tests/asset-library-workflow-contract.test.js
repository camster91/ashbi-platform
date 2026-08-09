import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'pages/AssetLibrary.jsx'), 'utf8');

describe('Asset Library workflow contract', () => {
  it('removes the fake guidelines save and routes admins to the real editor', () => {
    expect(source).not.toContain('Save Guidelines');
    expect(source).not.toContain('setGuidelines');
    expect(source).toContain("navigate('/admin/brand')");
    expect(source).toContain("user?.role !== 'ADMIN'");
  });

  it('uses a shared upload dialog and recoverable asset loading', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showUpload}');
    expect(source).not.toContain('role="button" tabIndex={0}');
    expect(source).toContain('assetsError');
    expect(source).toContain('message="Failed to load assets"');
  });

  it('preserves upload failures and hardens deletion controls', () => {
    expect(source).toContain('if (createMutation.isPending) return;');
    expect(source).toContain('createMutation.error');
    expect(source).toContain('deleteMutation.error');
    expect(source).toContain('aria-label={`Delete asset ${asset.name}`}');
    expect(source).toContain('disabled={deleteMutation.isPending}');
    expect(source).toContain('min-h-11 min-w-11');
  });
});
