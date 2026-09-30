/**
 * Shared status vocabulary (lib/status.js) and the StatusBadge primitive.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../components/ui/StatusBadge';
import {
  STATUS_DOMAINS,
  STATUS_TONE_CLASSES,
  getStatus,
  statusClasses,
  statusLabel,
} from '../lib/status';

const BADGE_COLORS = ['default', 'primary', 'success', 'warning', 'danger', 'accent', 'info'];

describe('lib/status', () => {
  it('covers the required domains', () => {
    for (const domain of ['invoice', 'proposal', 'contract', 'project', 'task', 'review']) {
      expect(Object.keys(STATUS_DOMAINS[domain] || {}).length, domain).toBeGreaterThan(2);
    }
  });

  it('gives every status a label, a Badge colour and an icon, so colour is never the only cue', () => {
    for (const [domain, map] of Object.entries(STATUS_DOMAINS)) {
      for (const [status, entry] of Object.entries(map)) {
        const where = `${domain}.${status}`;
        expect(entry.label, where).toMatch(/\w/);
        expect(BADGE_COLORS, where).toContain(entry.color);
        expect(entry.icon, where).toBeTruthy();
      }
    }
  });

  it('only uses token classes for plain-class pills', () => {
    for (const classes of Object.values(STATUS_TONE_CLASSES)) {
      expect(classes).not.toMatch(/-(gray|slate|red|green|blue|yellow|amber|orange|purple|indigo)-\d/);
    }
    expect(statusClasses('invoice', 'PAID')).toBe('bg-success/10 text-success');
  });

  it('uses the client wording on client-facing pages', () => {
    expect(statusLabel('invoice', 'SENT')).toBe('Sent');
    expect(statusLabel('invoice', 'SENT', { audience: 'client' })).toBe('Awaiting Payment');
    expect(statusLabel('estimate', 'SENT', { audience: 'client' })).toBe('Pending Review');
  });

  it('falls back to a neutral, readable label for unknown statuses', () => {
    const entry = getStatus('invoice', 'PARTIALLY_PAID');
    expect(entry).toMatchObject({ label: 'PARTIALLY PAID', color: 'default', known: false });
    expect(() => getStatus('nope', 'X')).toThrow(/Unknown status domain/);
  });

  it('knows every task, project and health status the API accepts', () => {
    const schemas = readFileSync(resolve(process.cwd(), '../src/validators/schemas.js'), 'utf8');
    const listed = (name) => {
      const match = schemas.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
      expect(match, name).toBeTruthy();
      return [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    };
    const projectUpdate = schemas.match(/projectUpdateSchema[\s\S]*?status: z\.enum\(\[([^\]]*)\]/);
    const expected = {
      task: listed('TASK_STATUS_VALUES'),
      project: [...listed('PROJECT_STATUS_VALUES'), ...[...projectUpdate[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])],
      health: listed('PROJECT_HEALTH_VALUES'),
    };
    for (const [domain, statuses] of Object.entries(expected)) {
      expect(statuses.length, domain).toBeGreaterThan(2);
      for (const status of statuses) {
        expect(getStatus(domain, status).known, `${domain}.${status}`).toBe(true);
      }
    }
    expect(statusLabel('task', 'WAITING_US')).toBe('Waiting on us');
    expect(statusLabel('task', 'WAITING_CLIENT')).toBe('Waiting on client');
    expect(statusLabel('project', 'PAUSED')).toBe('Paused');
    expect(statusLabel('project', 'DRAFT')).toBe('Draft');
  });

  it('gives every task priority a distinct tone, used by the Kanban board', () => {
    const tones = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].map((p) => statusClasses('priority', p));
    expect(new Set(tones).size).toBe(4);
    const kanban = readFileSync(resolve(process.cwd(), 'src/pages/TaskKanban.jsx'), 'utf8');
    expect(kanban).not.toMatch(/PRIORITY_COLORS\s*=/);
    expect(kanban).toContain("statusClasses('priority'");
  });

  it('replaces the duplicated per-page invoice status maps', () => {
    for (const file of ['src/pages/Invoices.jsx', 'src/pages/InvoiceDetail.jsx', 'src/pages/PortalInvoice.jsx']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/(STATUS_CONFIG|statusConfig)\s*=/);
      expect(source, file).toContain('<StatusBadge domain="invoice"');
    }
  });
});

describe('StatusBadge', () => {
  it('renders the label with a decorative icon and token colours', () => {
    render(<StatusBadge domain="invoice" status="OVERDUE" />);
    const badge = screen.getByText('Overdue');
    expect(badge).toHaveAttribute('data-status', 'OVERDUE');
    expect(badge.className).toContain('bg-destructive/10');
    expect(badge.className).toContain('text-destructive');
    const icon = badge.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports client wording, a label override and hiding the icon', () => {
    const { rerender } = render(<StatusBadge domain="invoice" status="SENT" audience="client" />);
    expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();
    rerender(<StatusBadge domain="contract" status="SIGNED" label="Signed by client" showIcon={false} />);
    const badge = screen.getByText('Signed by client');
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('uses the solid treatment where the map asks for it', () => {
    render(<StatusBadge domain="review" status="approved" />);
    expect(screen.getByText('Approved').className).toContain('text-success-foreground');
  });
});
