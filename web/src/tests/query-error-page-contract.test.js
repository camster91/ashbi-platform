import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDirectory, '..');

const retryablePages = [
  'pages/Automations.jsx',
  'pages/TaskKanban.jsx',
];

describe('retryable page query-error contract', () => {
  it.each(retryablePages)('%s uses QueryErrorState with retry progress', (relativePath) => {
    const source = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

    expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
    expect(source).toContain('<QueryErrorState');
    expect(source).toMatch(/onRetry=\{(?:\(\) => )?refetch/);
    expect(source).toContain('isRetrying={isFetching}');
  });
});
