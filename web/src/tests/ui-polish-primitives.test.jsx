import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Alert from '../components/ui/Alert';
import {
  TablePageSkeleton,
  KanbanPageSkeleton,
  ListPageSkeleton,
} from '../components/ui/PageSkeleton';

describe('Alert', () => {
  it('renders a static banner with no role or live region when live is false', () => {
    const { container } = render(<Alert variant="error" live={false} title="2 overdue invoices" />);
    const root = container.firstChild;
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the dismiss button from dismissLabel', () => {
    const onDismiss = vi.fn();
    render(<Alert variant="error" onDismiss={onDismiss} dismissLabel="Dismiss upload error">Upload failed</Alert>);
    screen.getByRole('button', { name: 'Dismiss upload error' }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses alert role for errors and status for info', () => {
    const { rerender } = render(
      <Alert variant="error" title="Something went wrong">
        Please try again.
      </Alert>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(<Alert variant="info" title="Heads up">All good.</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('exposes a dismiss control with a 44px touch target', async () => {
    const onDismiss = vi.fn();
    render(<Alert variant="warning" title="Careful" onDismiss={onDismiss} />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss.className).toMatch(/min-h-11/);
    dismiss.click();
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('PageSkeleton', () => {
  it('announces kanban, table, and list loading states', () => {
    const { rerender } = render(<KanbanPageSkeleton label="Loading projects" />);
    expect(screen.getByRole('status', { name: 'Loading projects' })).toHaveAttribute('aria-busy', 'true');

    rerender(<TablePageSkeleton label="Loading clients" showStats />);
    expect(screen.getByRole('status', { name: 'Loading clients' })).toBeInTheDocument();

    rerender(<ListPageSkeleton label="Loading team" />);
    expect(screen.getByRole('status', { name: 'Loading team' })).toBeInTheDocument();
  });
});
