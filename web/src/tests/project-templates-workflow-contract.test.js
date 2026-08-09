import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../pages/ProjectTemplates.jsx'), 'utf8');

describe('Project Templates workflow contract', () => {
  it('uses shared loading, error, empty, and dialog primitives', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('LoadingState');
    expect(source).toContain('templatesError');
    expect(source).toContain('message="Failed to load project templates"');
    expect(source).toContain('isOpen={showCreateDialog}');
    expect(source).not.toContain('className="fixed inset-0');
  });

  it('distinguishes client loading/failure and preserves create input', () => {
    expect(source).toContain('clientsLoading');
    expect(source).toContain('clientsError');
    expect(source).toContain('message="Failed to load clients"');
    expect(source).toContain('if (createFromTemplate.isPending) return;');
    expect(source).toContain('role="alert"');
  });

  it('labels fields and protects template deletion from duplicate requests', () => {
    expect(source).toContain('htmlFor="template-project-name"');
    expect(source).toContain('htmlFor="template-project-client"');
    expect(source).toContain('aria-label={`Delete template ${template.name}`}');
    expect(source).toContain('disabled={deleteTemplate.isPending}');
    expect(source).toContain('min-h-11 min-w-11');
  });
});
