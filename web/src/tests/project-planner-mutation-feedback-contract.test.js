import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(process.cwd(), 'src/pages/ProjectPlanner.jsx'), 'utf8');

describe('project planner mutation feedback', () => {
  it('announces template save failures with the returned message', () => {
    expect(page).toContain('{saveTemplate.isError && (');
    expect(page).toContain('<p role="alert"');
    expect(page).toContain("{saveTemplate.error?.message || 'Failed to save template. Please try again.'}");
  });
});
