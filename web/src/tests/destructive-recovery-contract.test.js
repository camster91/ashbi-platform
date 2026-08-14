import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(notes).toContain('restoreMutation.mutate(result.trashId)');
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
    expect(milestones).toContain('restoreMutation.mutate(result.trashId)');
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
