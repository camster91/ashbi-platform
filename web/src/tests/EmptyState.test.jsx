/**
 * EmptyState Component Unit Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmptyState, { EmptyInbox, EmptyProjects, EmptySearch, EmptyNotifications, EmptyTeam } from '../components/ui/EmptyState';

describe('EmptyState Component', () => {
  it('renders default title and description', () => {
    render(<EmptyState />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('There are no items to display at the moment.')).toBeInTheDocument();
  });

  it('renders custom title and description', () => {
    render(<EmptyState title="Custom Title" description="Custom Description" />);
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByText('Custom Description')).toBeInTheDocument();
  });

  it('handles action button click', () => {
    const handleAction = vi.fn();
    render(<EmptyState actionLabel="Do Something" onAction={handleAction} />);
    
    const button = screen.getByRole('button', { name: /do something/i });
    fireEvent.click(button);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('renders secondary action', () => {
    render(
      <EmptyState 
        actionLabel="Primary"
        secondaryAction={<button data-testid="secondary">Secondary</button>} 
      />
    );
    expect(screen.getByTestId('secondary')).toBeInTheDocument();
  });

  describe('Pre-configured Empty States', () => {
    it('EmptyInbox renders correctly', () => {
      const onBrowse = vi.fn();
      render(<EmptyInbox onBrowseProjects={onBrowse} />);
      expect(screen.getByText('All caught up!')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Browse Projects'));
      expect(onBrowse).toHaveBeenCalled();
    });

    it('EmptyProjects renders correctly', () => {
      const onCreate = vi.fn();
      render(<EmptyProjects onCreateProject={onCreate} />);
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Create Project'));
      expect(onCreate).toHaveBeenCalled();
    });

    it('EmptySearch renders correctly with query', () => {
      const onClear = vi.fn();
      render(<EmptySearch query="test-query" onClear={onClear} />);
      expect(screen.getByText(/test-query/)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Clear Search'));
      expect(onClear).toHaveBeenCalled();
    });

    it('EmptyNotifications renders correctly', () => {
      render(<EmptyNotifications />);
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });

    it('EmptyTeam renders correctly', () => {
      const onInvite = vi.fn();
      render(<EmptyTeam onInvite={onInvite} />);
      expect(screen.getByText('No team members')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Invite Team Member'));
      expect(onInvite).toHaveBeenCalled();
    });
  });
});
