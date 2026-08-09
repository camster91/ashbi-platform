import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'components/QuickAdd.jsx'), 'utf8');

describe('Quick Add workflow contract', () => {
  it('uses the shared dialog and cannot dismiss an uncertain write', () => {
    expect(source).toContain("import Modal, { ModalFooter } from './Modal'");
    expect(source).toContain('isOpen={open}');
    expect(source).toContain('if (saving) return;');
    expect(source).not.toContain('role="button"');
  });

  it('requires explicit project/client ownership and never falls back silently', () => {
    expect(source).not.toContain("projects?.[0]?.id");
    expect(source).not.toContain('No client (add later)');
    expect(source).toContain("setError('Select a client')");
    expect(source).toContain("setError('Select a project')");
    expect(source).toContain("status: 'PENDING'");
  });

  it('surfaces lookup failures and preserves contact email in the create request', () => {
    expect(source).toContain('projectsError');
    expect(source).toContain('clientsError');
    expect(source).toContain('retryProjects');
    expect(source).toContain('retryClients');
    expect(source).toContain("contacts: [{ name: name.trim(), email: email.trim(), isPrimary: true }]");
  });

  it('associates field labels and announces error and success states', () => {
    expect(source).toContain('htmlFor="quick-add-name"');
    expect(source).toContain('id="quick-add-name"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('role="status"');
  });
});
