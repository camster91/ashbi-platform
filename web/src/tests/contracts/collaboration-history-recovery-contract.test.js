import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectChat = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
const taskComments = readFileSync(resolve(process.cwd(), 'src/components/TaskComments.jsx'), 'utf8');

describe('collaboration history recovery', () => {
  it('does not present a failed project-chat request as an empty conversation', () => {
    expect(projectChat).toContain("import QueryErrorState from './QueryErrorState';");
    expect(projectChat).toContain('isError: messagesError');
    expect(projectChat).toContain('message="Project conversation could not be loaded"');
    expect(projectChat).toContain('onRetry={refetchMessages}');
    expect(projectChat).toContain('!messagesError && messages.length === 0');
  });

  it('does not present a failed task-comments request as an empty list', () => {
    expect(taskComments).toContain("import QueryErrorState from './QueryErrorState';");
    expect(taskComments).toContain('isError: commentsError');
    expect(taskComments).toContain('message="Task comments could not be loaded"');
    expect(taskComments).toContain('onRetry={refetchComments}');
    expect(taskComments).toContain('!commentsError && comments.length === 0');
  });
});
