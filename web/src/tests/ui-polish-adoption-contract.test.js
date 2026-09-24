import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const skeletonPages = [
  ['pages/Projects.jsx', 'KanbanPageSkeleton'],
  ['pages/Clients.jsx', 'TablePageSkeleton'],
  ['pages/Expenses.jsx', 'TablePageSkeleton'],
  ['pages/Team.jsx', 'ListPageSkeleton'],
  ['pages/Docs.jsx', 'ListPageSkeleton'],
  ['pages/Notifications.jsx', 'ListPageSkeleton'],
];

describe('collection page skeleton adoption', () => {
  it.each(skeletonPages)('%s uses %s instead of a bare spinner', (relativePath, skeleton) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    expect(source).toContain(skeleton);
    expect(source).toMatch(new RegExp(`<${skeleton}`));
  });
});

describe('onboarding feature intro', () => {
  it('ships a crisp 3-step feature walkthrough before the checklist', () => {
    const source = fs.readFileSync(path.join(root, 'components/OnboardingTour.jsx'), 'utf8');
    expect(source).toContain('FEATURE_INTRO_STEPS');
    expect(source.match(/id: '/g).length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('introStep');
    expect(source).toContain('Start checklist');
  });
});
