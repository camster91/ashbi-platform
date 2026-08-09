import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

describe.each(['Estimates', 'Expenses'])('%s list workflow state', (pageName) => {
  const source = readPage(pageName);
  const prefix = pageName.toLowerCase();

  it('imports the shared typed query recovery state', () => {
    expect(source).toContain("import QueryErrorState from '../components/QueryErrorState';");
  });

  it('tracks request failure, retry, and retry progress', () => {
    expect(source).toContain(`${prefix}Error`);
    expect(source).toContain(`refetch${pageName}`);
    expect(source).toContain(`${prefix}Fetching`);
  });

  it('renders request failure before the legitimate empty state', () => {
    expect(source).toMatch(new RegExp(`${prefix}Error\\s*\\?\\s*\\([\\s\\S]*<QueryErrorState[\\s\\S]*length === 0`));
  });
});
