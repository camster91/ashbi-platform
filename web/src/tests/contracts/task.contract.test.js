import fs, { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Task page, kanban and comments: recovery copy and accessible actions.

describe('task-comment-recovery-contract.test.js', () => {
  it('keeps a failed task comment available for an explicit retry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskPage.jsx'), 'utf8');
    expect(source).toContain('commentError');
    expect(source).toContain('Comment was not posted. Try again.');
    expect(source).toContain('addCommentMutation.mutate(commentError)');
  });
});

describe('task-comments-delete-contract.test.js', () => {
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

    it('uses semantic theme tokens for readable light and dark states', () => {
      expect(source).not.toMatch(/(?:text|bg|border|hover:bg|hover:text)-(?:gray|blue|red)-\d+/);
      expect(source).not.toContain('bg-white');
      expect(source).toContain('text-foreground');
      expect(source).toContain('text-muted-foreground');
      expect(source).toContain('bg-muted');
      expect(source).toContain('bg-primary');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});

describe('task-kanban-move-recovery-contract.test.js', () => {
  it('explains a failed Kanban move and lets the user retry the same transition', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskKanban.jsx'), 'utf8');
    expect(source).toContain('moveError');
    expect(source).toContain('Task move was not saved. Try again.');
    expect(source).toContain('moveMutation.mutate(moveError)');
  });

  it('keeps a failed quick task creation available for retry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskKanban.jsx'), 'utf8');
    expect(source).toContain('createError');
    expect(source).toContain('Task was not created. Try again.');
    expect(source).toContain('createMutation.mutate(createError)');
  });
});

describe('task-page-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskPage.jsx'), 'utf8');

  describe('task page accessibility contract', () => {
    it('names and sizes page header controls for keyboard and touch users', () => {
      expect(source).toContain('aria-label="Remove cover image"');
      expect(source).toContain('aria-label="Choose task icon"');
      expect(source).toContain('aria-label={`Choose task icon ${emoji}`}');
      expect(source).toContain('aria-label="Edit task properties"');
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('uses native button types for task navigation and subpage actions', () => {
      expect(source).toContain('aria-label="Go back to the previous page"');
      expect(source).toContain('aria-label={`Open subpage ${subpage.title}`}');
      expect(source).toContain('type="button"');
      expect(source).toContain('<Button type="button" size="sm" onClick={onCreateSubpage}');
      expect(source).toContain('<Button type="button" size="sm" variant="outline" onClick={onCreateSubpage}');
    });
  });
});

describe('task-page-content-recovery-contract.test.js', () => {
  it('debounces task-content saves and preserves a failed revision for retry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskPage.jsx'), 'utf8');
    expect(source).toContain('contentSaveTimerRef');
    expect(source).toContain('contentSaveError');
    expect(source).toContain('Content was not saved. Try again.');
    expect(source).toContain('updateMutation.mutate({ content: contentSaveError })');
  });
});
