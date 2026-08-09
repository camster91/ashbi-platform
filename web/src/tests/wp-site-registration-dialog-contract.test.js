import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/pages/WPSites.jsx'), 'utf8');

describe('WordPress site registration dialog contract', () => {
  it('uses the shared modal and protects pending registration and one-time secrets', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showAdd}');
    expect(source).toContain('if (registerMutation.isPending || provisionedSecret) return;');
    expect(source).toContain('showCloseButton={!registerMutation.isPending && !provisionedSecret}');
    expect(source).not.toContain('role="presentation" className="fixed inset-0');
  });

  it('requires explicit acknowledgement before discarding the one-time key', () => {
    expect(source).toContain('finishProvisioning');
    expect(source).toContain('I saved this key');
    expect(source).toContain('setProvisionedSecret(\'\')');
  });

  it('labels the URL and announces registration and copy failures inside the dialog', () => {
    expect(source).toContain('htmlFor="wp-site-url"');
    expect(source).toContain('id="wp-site-url"');
    expect(source).toContain('registerMutation.error');
    expect(source).toContain('copyError');
    expect(source).toContain('role="alert"');
  });
});
