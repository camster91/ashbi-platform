import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const notes = readFileSync(resolve(process.cwd(), 'src/components/Notes.jsx'), 'utf8');
const milestones = readFileSync(resolve(process.cwd(), 'src/components/Milestones.jsx'), 'utf8');
const api = readFileSync(resolve(process.cwd(), 'src/lib/api.js'), 'utf8');

describe('destructive action recovery contract', () => {
  it('offers entity-specific note undo and reports restore failure', () => {
    expect(api).toContain('restoreTrashItem: (trashId)');
    expect(notes).toContain('label: `Undo delete ${title}`');
    expect(notes).toContain('restoreMutation.mutate(result.trashId)');
    expect(notes).toContain("title: 'Could not restore note'");
  });

  it('requires explicit consequence confirmation for permanent milestone deletion', () => {
    expect(milestones).toContain('Permanently delete “${selectedMilestone.name}”?');
    expect(milestones).toContain('This cannot be undone. Associated tasks will be kept but unlinked');
    expect(milestones).toContain('disabled={isDeleting}');
  });
});
