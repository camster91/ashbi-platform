import { describe, expect, it } from 'vitest';
import { projectSummary } from '../../components/projects/projectBoard';

describe('projects page summary', () => {
  it('counts active projects like the dashboard: on hold, launched and cancelled are not active', () => {
    const projects = [
      { id: 'a', status: 'DESIGN_DEV' },
      { id: 'b', status: 'STARTING_UP' },
      { id: 'c', status: 'ON_HOLD' },
      { id: 'd', status: 'LAUNCHED' },
      { id: 'e', status: 'CANCELLED' },
    ];
    const summary = projectSummary(projects, Date.parse('2026-10-18T12:00:00Z'));
    expect(summary.total).toBe(5);
    expect(summary.active).toBe(2);
  });
});
