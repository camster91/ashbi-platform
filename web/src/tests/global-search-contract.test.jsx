import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeSearchResults, resultDestination } from '../pages/GlobalSearch';

describe('global search result contract', () => {
  it('normalizes every supported result type', () => {
    const results = normalizeSearchResults({
      results: {
        projects: [{ id: 'p1', name: 'Project', client: { name: 'Client' } }],
        tasks: [{ id: 't1', title: 'Task', project: { name: 'Project', client: { name: 'Client' } } }],
        clients: [{ id: 'c1', name: 'Client' }],
        threads: [{ id: 'th1', subject: 'Conversation' }],
        messages: [{ id: 'm1', bodyText: 'Message body', thread: { id: 'th1', subject: 'Conversation' } }],
      },
    });

    expect(results.map(({ type }) => type)).toEqual(['project', 'task', 'client', 'thread', 'message']);
    expect(results[1]).toMatchObject({ title: 'Task', projectName: 'Project', clientName: 'Client' });
    expect(results[4]).toMatchObject({ threadId: 'th1', messageId: 'm1', description: 'Message body' });
  });

  it('provides a registered destination for every result type', () => {
    expect(resultDestination({ type: 'project', id: 'p1' })).toBe('/project/p1');
    expect(resultDestination({ type: 'task', id: 't1' })).toBe('/task/t1');
    expect(resultDestination({ type: 'client', id: 'c1' })).toBe('/client/c1');
    expect(resultDestination({ type: 'thread', id: 'th1' })).toBe('/thread/th1');
    expect(resultDestination({ type: 'message', threadId: 'th1', messageId: 'm 1' }))
      .toBe('/thread/th1?message=m%201');
  });

  it('renders an accessible error without a contradictory empty state', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/pages/GlobalSearch.jsx'), 'utf8');
    expect(source).toContain('text-red-700 dark:text-red-300');
    expect(source).toContain('{!error && (loading ? (');
    expect(source).toContain('flex flex-wrap gap-x-4 gap-y-1');
    expect(source).toContain('min-w-0 break-words');
  });
});
