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
  'src/pages/AssetLibrary.jsx',
  'src/pages/ApprovalQueue.jsx',
  'src/pages/Contracts.jsx',
  'src/pages/Pipeline.jsx',
  'src/pages/Project.jsx',
  'src/pages/ProjectTemplates.jsx',
  'src/pages/RateCards.jsx',
  'src/pages/Schedule.jsx',
  'src/pages/Trash.jsx',
];

describe('shared modal contract', () => {
  it.each(modalConsumers)('%s explicitly controls every Modal', (relativePath) => {
    const source = fs.readFileSync(path.resolve(relativePath), 'utf8');
    const openingTags = source.match(/<Modal\b(?!Footer)[\s\S]*?>/g) || [];
    expect(openingTags.length).toBeGreaterThan(0);
    openingTags.forEach((tag) => expect(tag).toMatch(/\bisOpen=/));
  });

  it.each(['src/pages/ApprovalQueue.jsx', 'src/pages/Trash.jsx'])('%s has no private fixed-overlay dialog', (relativePath) => {
    const source = fs.readFileSync(path.resolve(relativePath), 'utf8');
    expect(source).not.toContain('className="fixed inset-0 bg-black/');
  });
});
