import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const notifications = readFileSync(resolve(process.cwd(), 'src/pages/Notifications.jsx'), 'utf8');

describe('notifications workflow state contract', () => {
  it('distinguishes a failed list request from a truly empty inbox', () => {
    expect(notifications).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(notifications).toMatch(/isError[\s\S]*error[\s\S]*refetch[\s\S]*isFetching/);
    expect(notifications).toMatch(/isError\s*\?\s*\([\s\S]*<QueryErrorState/);
  });

  it('announces mutation failures without claiming notifications changed', () => {
    expect(notifications).toContain('markReadMutation.isError');
    expect(notifications).toContain('markAllReadMutation.isError');
    expect(notifications.match(/role="alert"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('prevents duplicate mark-read writes and names the icon action', () => {
    expect(notifications).toContain('disabled={markReadMutation.isPending}');
    expect(notifications).toContain('aria-label="Mark notification as read"');
    expect(notifications.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(notifications).toContain('min-h-11 min-w-11');
  });
});
