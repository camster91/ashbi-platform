import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDirectory, '..');

const topLevelCollectionPages = [
  'pages/Clients.jsx',
  'pages/Contracts.jsx',
  'pages/Estimates.jsx',
  'pages/Invoices.jsx',
  'pages/Notifications.jsx',
  'pages/Projects.jsx',
  'pages/Proposals.jsx',
];

describe('top-level collection empty-state contract', () => {
  it.each(topLevelCollectionPages)('%s uses the shared EmptyState primitive', (relativePath) => {
    const source = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

    expect(source).toMatch(/import[\s\S]*EmptyState[\s\S]*from ['"]\.\.\/components\/ui['"]/);
    expect(source).toContain('<EmptyState');
  });
});
