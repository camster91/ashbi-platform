import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

describe('detail workflow states', () => {
  it.each([
    ['Client', 'clientError', 'refetchClient'],
    ['TaskPage', 'taskError', 'refetchTask'],
    ['Thread', 'threadError', 'refetchThread'],
  ])('%s distinguishes request failure from a missing record', (pageName, errorToken, retryToken) => {
    const page = readPage(pageName);
    expect(page).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(page).toContain(errorToken);
    expect(page).toContain(retryToken);
    expect(page).toMatch(new RegExp(`if \\(${errorToken}\\)[\\s\\S]*<QueryErrorState[\\s\\S]*if \\(!`));
  });

  it('keeps optional client insights and task breadcrumbs visibly recoverable', () => {
    const client = readPage('Client');
    const task = readPage('TaskPage');
    expect(client).toContain('insightsError');
    expect(client).toContain('refetchInsights');
    expect(task).toContain('breadcrumbsError');
    expect(task).toContain('refetchBreadcrumbs');
  });
});
