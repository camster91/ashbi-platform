import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dashboard = readFileSync(join(process.cwd(), 'src/pages/Dashboard.jsx'), 'utf8');
const app = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');
const layout = readFileSync(join(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

describe('dashboard production contract', () => {
  it('never substitutes named demo business records for empty API arrays', () => {
    expect(dashboard).not.toContain('ASHBI_FALLBACK');
    expect(dashboard).not.toMatch(/SSCA|Numan|TotalETO|Wellington Quarters/);

    for (const collection of ['atRiskProjects', 'latest', 'wpSiteAlerts', 'overdueTasks']) {
      expect(dashboard).toContain(`${collection}?.length || 0`);
    }
  });

  it('distinguishes loading, full failure, partial failure, and truthful empty states', () => {
    expect(dashboard).toContain('isLoading && !stats');
    expect(dashboard).toContain('isError && !stats');
    expect(dashboard).toContain('Task data is temporarily unavailable');
    expect(dashboard).toContain('All projects on track');
    expect(dashboard).toContain('Inbox is clear');
    expect(dashboard).toContain("import { Card, Skeleton } from '../components/ui'");
    expect(dashboard.match(/<Skeleton/g)).toHaveLength(4);
  });

  it('only targets registered dashboard, project, and recurring-revenue routes', () => {
    expect(app).toContain('<Route path="/dashboard"');
    expect(app).toContain('<Route path="/project/:id"');
    expect(app).toContain('<Route path="/retainers"');
    expect(dashboard).toContain('navigate(`/project/${project.id}`)');
    expect(dashboard).toContain("navigate('/retainers')");
    expect(dashboard).not.toContain("navigate('/revenue')");
    expect(dashboard).not.toContain('to="/activity"');
    expect(dashboard).not.toMatch(/to=["']\/(activity|revenue|reports)["']/);
    expect(layout).toContain("name: 'Dashboard', href: '/dashboard'");
    expect(layout).toContain("href: '/dashboard', icon: LayoutDashboard, label: 'Home'");
  });
});
