import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { startImpersonation: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: ImpersonateAction } = await import('../components/ImpersonateAction');

const member = { id: 'team-1', name: 'Terry Team', role: 'TEAM', isActive: true };

describe('Team → View as (#416)', () => {
  beforeEach(() => {
    auth.startImpersonation = vi.fn();
  });

  it('explains the view and requires a reason before starting it', async () => {
    auth.startImpersonation.mockResolvedValue({ active: true });
    render(<ImpersonateAction member={member} />);
    fireEvent.click(screen.getByRole('button', { name: 'View as Terry Team' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/read only, for up to 30 minutes/);
    expect(dialog).toHaveTextContent(/is notified with your reason/);
    expect(dialog).toHaveTextContent(/Activity Log/);

    fireEvent.change(screen.getByLabelText(/Reason \(shown to Terry Team\)/), { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start read-only view' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 10 characters/);
    expect(auth.startImpersonation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  Ticket 2231: tasks missing  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start read-only view' }));
    await waitFor(() => expect(auth.startImpersonation).toHaveBeenCalledWith(member, 'Ticket 2231: tasks missing'));
  });

  it('shows why the server refused and keeps the dialog open', async () => {
    auth.startImpersonation.mockRejectedValue(Object.assign(new Error('Only team members and client users can be viewed as; never another administrator.'), { status: 403 }));
    render(<ImpersonateAction member={member} />);
    fireEvent.click(screen.getByRole('button', { name: 'View as Terry Team' }));
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: 'Ticket 2231: tasks missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start read-only view' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/never another administrator/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
