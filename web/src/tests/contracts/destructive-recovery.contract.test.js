import fs, { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Destructive actions offer recovery (undo, confirm, retry).

describe('destructive-recovery-contract.test.js', () => {
  const notes = readFileSync(resolve(process.cwd(), 'src/components/Notes.jsx'), 'utf8');
  const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');
  const docs = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');
  const estimates = readFileSync(resolve(process.cwd(), 'src/pages/Estimates.jsx'), 'utf8');
  const expenses = readFileSync(resolve(process.cwd(), 'src/pages/Expenses.jsx'), 'utf8');
  const proposals = readFileSync(resolve(process.cwd(), 'src/pages/Proposals.jsx'), 'utf8');
  const milestones = readFileSync(resolve(process.cwd(), 'src/components/Milestones.jsx'), 'utf8');
  const invoices = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.jsx'), 'utf8');
  const invoiceDetail = readFileSync(resolve(process.cwd(), 'src/pages/InvoiceDetail.jsx'), 'utf8');
  const api = readFileSync(resolve(process.cwd(), 'src/lib/api.js'), 'utf8');

  describe('destructive action recovery contract', () => {
    it('offers entity-specific note undo and reports restore failure', () => {
      expect(api).toContain('restoreTrashItem: (trashId)');
      expect(notes).toContain('label: `Undo delete ${title}`');
      expect(notes).toContain('restoreMutation.mutateAsync(result.trashId)');
      expect(notes).toContain("title: 'Could not restore note'");
    });

    it.each([
      ['project notes', project],
      ['global docs', docs],
    ])('reports failed Undo recovery on the active %s surface', (_surface, source) => {
      expect(source).toContain("title: 'Could not restore note'");
      expect(source).toContain("message: error.message || 'Open Trash or refresh before trying again.'");
      expect(source).toContain('duration: 0');
    });

    it.each([
      ['estimate', estimates, 'estimate'],
      ['expense', expenses, 'expense'],
      ['proposal', proposals, 'proposal'],
    ])('reports failed Undo recovery for a deleted %s', (_surface, source, entity) => {
      expect(source).toContain(`title: 'Could not restore ${entity}'`);
      expect(source).toContain("message: error.message || 'Open Trash or refresh before trying again.'");
      expect(source).toContain('duration: 0');
    });

    it('requires confirmation and gives milestone deletion a bounded, safe Undo path', () => {
      expect(milestones).toContain('Delete “${milestoneToDelete.name}”? You can undo this action for 10 seconds.');
      expect(milestones).toContain('Former tasks will be restored only if they remain unassigned.');
      expect(milestones).toContain('label: `Undo delete ${name}`');
      expect(milestones).toContain('restoreMutation.mutateAsync(result.trashId)');
      expect(milestones).toContain("title: 'Could not restore milestone'");
      expect(milestones).toContain('disabled={isDeleting}');
    });

    it('offers a bounded, named Undo action for invoice void on list and detail surfaces', () => {
      expect(api).toContain('undoInvoiceVoid: (id)');
      expect(invoices).toContain('label: `Undo void ${invoiceNumber}`');
      expect(invoiceDetail).toContain('label: `Undo void ${invoice.invoiceNumber}`');
      expect(invoices).toContain('Invoice void undo expired');
      expect(invoiceDetail).toContain('Invoice void undo expired');
    });
  });
});

describe('notes-destructive-recovery-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/Notes.jsx'), 'utf8');

  describe('project notes destructive recovery', () => {
    it('requires confirmation before a soft delete while preserving the existing undo path', () => {
      expect(source).toContain("import ConfirmDialog from './ConfirmDialog'");
      expect(source).toContain('const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);');
      expect(source).toContain('<Modal isOpen={!showDeleteConfirm && !showHistory}');
      expect(source).toContain('onClick={() => setShowDeleteConfirm(true)}');
      expect(source).toContain('<ConfirmDialog');
      expect(source).toContain('isOpen={showDeleteConfirm}');
      expect(source).toContain('onConfirm={onDelete}');
      expect(source).toContain('error={deleteError}');
      expect(source).toContain('Undo delete ${title}');
    });
  });
});

describe('chat-destructive-recovery-contract.test.js', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Chat.jsx'), 'utf8');

  describe('Ash chat destructive recovery contract', () => {
    it('requires an accessible shared confirmation before permanent deletion', () => {
      expect(source).toContain("import ConfirmDialog from '../components/ConfirmDialog'");
      expect(source).toContain('conversationToDelete');
      expect(source).toContain('<ConfirmDialog');
      expect(source).toContain('This permanently removes the conversation and its messages. This cannot be undone.');
    });

    it('keeps mutation errors visible and prevents duplicate deletion', () => {
      expect(source).toContain('deleteConversationMutation');
      expect(source).toContain('pending={deleteConversationMutation.isPending}');
      expect(source).toContain('error={deleteConversationMutation.error?.message}');
      expect(source).toContain('disabled={deleteConversationMutation.isPending}');
    });

    it('names the new-chat, message, and send controls', () => {
      expect(source).toContain('aria-label="Start a new conversation"');
      expect(source).toContain('aria-label="Message Ash"');
      expect(source).toContain('aria-label="Send message to Ash"');
    });
  });
});

describe('schedule-delete-contract.test.js', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

  describe('calendar event deletion contract', () => {
    it('requires shared confirmation from both event surfaces', () => {
      expect(source).toContain("import ConfirmDialog from '../components/ConfirmDialog'");
      expect(source.match(/<ConfirmDialog/g)).toHaveLength(2);
      expect(source.match(/This permanently removes the calendar event and cannot be undone\./g)).toHaveLength(2);
      expect(source.match(/Permanently delete “\$\{.*\.title\}”\?/g)).toHaveLength(2);
    });

    it('guards duplicate requests and keeps errors in the confirmation', () => {
      expect(source.match(/pending=\{deleteMutation\.isPending\}/g)).toHaveLength(2);
      expect(source.match(/error=\{deleteMutation\.error\?\.message\}/g)).toHaveLength(2);
      expect(source.match(/disabled=\{deleteMutation\.isPending\}/g).length).toBeGreaterThanOrEqual(2);
    });

    it('removes direct destructive mutation handlers', () => {
      expect(source).not.toContain('onClick={() => deleteMutation.mutate()}');
      expect(source.match(/confirmingDelete/g).length).toBeGreaterThanOrEqual(4);
    });
  });
});
