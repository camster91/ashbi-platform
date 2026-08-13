import path from 'node:path';

const SOURCE_PREFIX = 'notion-markdown:';

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Notion import paths must be relative export paths');
  }
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Notion import paths must be relative export paths');
  }
  return normalized;
}

function sourceKey(relativePath) {
  return `${SOURCE_PREFIX}${relativePath}`;
}

export function buildNotionMarkdownImportPlan(relativePaths) {
  const normalized = relativePaths.map(normalizeRelativePath);
  return normalized
    .sort((left, right) => {
      const depthDifference = left.split('/').length - right.split('/').length;
      return depthDifference || left.localeCompare(right);
    })
    .map((relativePath) => {
      const directory = path.posix.dirname(relativePath);
      return {
        relativePath,
        sourceKey: sourceKey(relativePath),
        parentSourceKey: directory === '.' ? null : sourceKey(`${directory}.md`),
      };
    });
}

