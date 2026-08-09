import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

describe('keyboard shortcuts dialog contract', () => {
  it('uses the shared focus-managed modal with a labelled title', () => {
    expect(layout).toContain("import Modal, { ModalFooter } from './Modal';");
    expect(layout).toMatch(/<Modal\s+isOpen\s+onClose=\{onClose\}\s+title="Keyboard Shortcuts"/);
  });

  it('uses the shared footer action instead of a bespoke overlay', () => {
    expect(layout).toContain('<ModalFooter>');
    expect(layout).not.toContain('z-[60] flex items-center justify-center bg-foreground/30');
  });
});
