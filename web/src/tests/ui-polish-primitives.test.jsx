import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Alert from '../components/ui/Alert';
import {
  TablePageSkeleton,
  KanbanPageSkeleton,
  ListPageSkeleton,
} from '../components/ui/PageSkeleton';

describe('Alert', () => {
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
