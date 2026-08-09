import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'pages/SemanticSearch.jsx'), 'utf8');

describe('Client Brain workflow contract', () => {
  it('does not seed fabricated client knowledge and sends the backend source contract', () => {
    expect(source).not.toContain('Client prefers modern');
    expect(source).not.toContain('Project timeline: 8 weeks');
    expect(source).not.toContain('Budget range: $5,000');
    expect(source).toContain('source: indexDoc.source');
    expect(source).not.toContain('sourceType: doc.source');
  });

  it('uses the shared dialog with preserved input and pending dismissal protection', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showIndex}');
    expect(source).toContain('if (indexMutation.isPending) return;');
    expect(source).toContain('indexMutation.error');
    expect(source).not.toContain('role="button" tabIndex={0}');
  });

  it('distinguishes search and stats failures from empty states and announces rebuild outcomes', () => {
    expect(source).toContain('searchError');
    expect(source).toContain('statsError');
    expect(source).toContain('hasSearched');
    expect(source).toContain('rebuildMutation.error');
    expect(source).toContain('rebuildMutation.data');
  });
});
