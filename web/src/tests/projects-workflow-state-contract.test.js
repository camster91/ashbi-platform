import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projects = readFileSync(resolve(process.cwd(), 'src/pages/Projects.jsx'), 'utf8');

describe('projects workflow state contract', () => {
  it('shows a retryable request failure instead of an empty Kanban', () => {
    expect(projects).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(projects).toMatch(/isError[\s\S]*error[\s\S]*refetch[\s\S]*isFetching/);
    expect(projects).toMatch(/if \(isError\)[\s\S]*<QueryErrorState/);
  });

  it('does not retain the obsolete hardcoded project fallback', () => {
    expect(projects).not.toContain('ASHBI_DESIGN_PROJECTS');
    expect(projects).not.toMatch(/id:\s*'ashbi-[1-8]'/);
  });
});
