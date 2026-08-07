import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const modalConsumers = [
  'src/components/Calendar.jsx',
  'src/components/CreateClientModal.jsx',
  'src/components/CreateProjectModal.jsx',
  'src/components/CreateTeamMemberModal.jsx',
  'src/components/Milestones.jsx',
  'src/components/Notes.jsx',
  'src/pages/Contracts.jsx',
  'src/pages/Pipeline.jsx',
  'src/pages/Schedule.jsx',
];

describe('shared modal contract', () => {
  it.each(modalConsumers)('%s explicitly controls every Modal', (relativePath) => {
    const source = fs.readFileSync(path.resolve(relativePath), 'utf8');
    const openingTags = source.match(/<Modal\b(?!Footer)[\s\S]*?>/g) || [];
    expect(openingTags.length).toBeGreaterThan(0);
    openingTags.forEach((tag) => expect(tag).toMatch(/\bisOpen=/));
  });
});
