import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const targets = [
  'pages/AiContextSettings.jsx',
  'pages/AssetLibrary.jsx',
  'components/Milestones.jsx',
  'pages/Docs.jsx',
  'pages/Project.jsx',
  'pages/ProjectTemplates.jsx',
  'pages/Proposals.jsx',
  'pages/Retainers.jsx',
  'pages/TimeTracking.jsx',
];

describe('native confirmation removal', () => {
  it.each(targets)('%s uses the shared confirmation contract', (target) => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src', ...target.split('/')), 'utf8');
    const importPath = target.startsWith('components/') ? './ConfirmDialog' : '../components/ConfirmDialog';

    expect(source).toContain(`import ConfirmDialog from '${importPath}'`);
    expect(source).toContain('<ConfirmDialog');
    expect(source).not.toMatch(/(?:window\.)?confirm\s*\(/);
  });

  it('leaves no native confirmation calls in production frontend source', () => {
    const root = path.resolve(process.cwd(), 'src');
    const files = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (/\.[jt]sx?$/.test(entry.name) && !absolute.includes(`${path.sep}tests${path.sep}`)) files.push(absolute);
      }
    };
    walk(root);

    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/(?:window\.)?confirm\s*\(/);
    }
  });
});
