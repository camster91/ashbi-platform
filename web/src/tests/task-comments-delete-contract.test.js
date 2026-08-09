import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TaskComments.jsx'), 'utf8');

describe('task comment deletion contract', () => {
  it('requires shared accessible confirmation before permanent deletion', () => {
    expect(source).toContain("import ConfirmDialog from './ConfirmDialog'");
    expect(source).toContain('commentToDelete');
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain('This permanently removes the comment from the task and cannot be undone.');
  });

  it('identifies the selected comment and guards duplicate requests', () => {
    expect(source).toContain('commentToDelete?.author?.name');
    expect(source).toContain('commentToDelete.content');
    expect(source).toContain('pending={deleteMutation.isPending}');
    expect(source).toContain('disabled={deleteMutation.isPending}');
  });

  it('keeps deletion errors visible in the open dialog', () => {
    expect(source).toContain('error={deleteMutation.error?.message}');
    expect(source).not.toContain('onClick={() => deleteMutation.mutate(comment.id)}');
  });
});
