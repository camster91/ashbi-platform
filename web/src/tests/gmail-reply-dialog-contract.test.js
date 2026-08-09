import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/pages/Thread.jsx'), 'utf8');

describe('Gmail reply workflow contract', () => {
  it('uses the shared modal and protects an uncertain send', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showGmailReply}');
    expect(source).toContain('if (gmailSendMutation.isPending) return;');
    expect(source).not.toContain('className="fixed inset-0 z-50 flex items-end');
  });

  it('labels required fields and uses native form submission', () => {
    for (const id of ['gmail-reply-to', 'gmail-reply-subject', 'gmail-reply-message']) {
      expect(source).toContain(`htmlFor="${id}"`);
      expect(source).toContain(`id="${id}"`);
    }
    expect(source).toContain('type="submit"');
    expect(source).toContain('required');
  });

  it('keeps draft and send failures visible and announced', () => {
    expect(source).toContain('gmailDraftMutation.error');
    expect(source).toContain('gmailSendMutation.error');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Your draft is still available');
  });
});
