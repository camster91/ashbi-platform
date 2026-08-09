import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../pages/Project.jsx'), 'utf8');

describe('Project dialog workflow-state contract', () => {
  it('uses the shared dialog primitive for all three workflows', () => {
    expect(source).toContain("import Modal from '../components/Modal'");
    expect(source.match(/<Modal\b/g)).toHaveLength(3);
    expect(source).not.toContain('className="fixed inset-0 bg-black/');
  });

  it('associates draft and pasted-message fields with visible labels', () => {
    expect(source).toContain('htmlFor="draft-update-notes"');
    expect(source).toContain('id="draft-update-notes"');
    expect(source).toContain('htmlFor="paste-message-source"');
    expect(source).toContain('id="paste-message-source"');
    expect(source).toContain('htmlFor="paste-message-content"');
    expect(source).toContain('id="paste-message-content"');
  });

  it('makes template loading/failure distinct and retryable', () => {
    expect(source).toContain('templatesLoading');
    expect(source).toContain('templatesError');
    expect(source).toContain('refetchTemplates');
    expect(source).toContain('label="Loading task templates…"');
    expect(source).toContain('message="Failed to load task templates"');
  });

  it('keeps pending dialogs open and exposes mutation failures inline', () => {
    expect(source).toContain('if (draftUpdateMutation.isPending) return;');
    expect(source).toContain('if (applyTemplateMutation.isPending) return;');
    expect(source).toContain('if (pasteMutation.isPending) return;');
    expect(source.match(/role="alert"/g).length).toBeGreaterThanOrEqual(3);
  });

  it('reports clipboard success only after the browser confirms the write', () => {
    expect(source).toContain('async function copyPortalLink()');
    expect(source).toContain('async function copyDraftUpdate()');
    expect(source.match(/await navigator\.clipboard\.writeText/g)).toHaveLength(2);
    expect(source).toContain("toast.error('Portal link could not be copied')");
    expect(source).toContain("toast.error('Draft could not be copied')");
  });
});
