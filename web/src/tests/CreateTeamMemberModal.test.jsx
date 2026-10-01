/**
 * CreateTeamMemberModal adopts Field/Input/Select: every control is labelled
 * and validation errors are announced.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateTeamMemberModal from '../components/CreateTeamMemberModal';

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreateTeamMemberModal isOpen onClose={() => {}} />
    </QueryClientProvider>
  );
}

describe('CreateTeamMemberModal', () => {
  it('labels every control and marks the required ones', () => {
    renderModal();
    expect(screen.getByRole('textbox', { name: /Full Name/ })).toBeRequired();
    expect(screen.getByRole('textbox', { name: /Email/ })).toBeRequired();
    expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription('At least 6 characters');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('TEAM');
    expect(screen.getByRole('spinbutton', { name: 'Capacity (%)' })).toHaveAccessibleDescription('100% = full-time availability');
    expect(screen.getByRole('group', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'design' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('announces a validation error', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Add Team Member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Email is required');
  });
});
