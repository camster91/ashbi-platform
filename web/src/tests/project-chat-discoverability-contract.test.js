import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

describe('project chat discoverability', () => {
  it('mounts the realtime project conversation in the staff project workspace', () => {
    expect(project).toContain("import ProjectChat from '../components/ProjectChat'");
    expect(project).toContain('<ProjectChat projectId={id} />');
    expect(project).toContain('Project conversation');
  });
});
