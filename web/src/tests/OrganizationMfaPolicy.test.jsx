import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getMfaRequirement: vi.fn(),
    setMfaRequirement: vi.fn(),
    getMfaStatus: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: OrganizationMfaPolicy } = await import('../components/OrganizationMfaPolicy');

function renderPolicy(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationMfaPolicy />
    </QueryClientProvider>,
  );
}

function apiError(message, status, data) {
  return Object.assign(new Error(message), { status, data });
}

describe('Settings → Organization security: MFA requirement toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a labelled switch with a 44px target that reports the current state', async () => {
    api.getMfaRequirement.mockResolvedValue({ required: false, staffWithoutMfa: 3, actorMfaEnabled: true });
    renderPolicy();

    const toggle = await screen.findByRole('switch', { name: /require two-factor authentication for all staff/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle.className).toMatch(/min-h-11/);
    expect(toggle.className).toMatch(/min-w-11/);
    expect(toggle).toHaveAccessibleDescription(/only set it up until they do/i);
    expect(screen.getByRole('status')).toHaveTextContent(/optional\. 3 active staff members have not set up/i);
  });

  it('confirms before requiring it, then saves and shows the new state', async () => {
    api.getMfaRequirement.mockResolvedValue({ required: false, staffWithoutMfa: 1, actorMfaEnabled: true });
    api.setMfaRequirement.mockResolvedValue({ required: true, staffWithoutMfa: 1, actorMfaEnabled: true, changed: true });
    renderPolicy();

    fireEvent.click(await screen.findByRole('switch'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/1 active staff member has not set up/i);
    expect(api.setMfaRequirement).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /require two-factor/i }));

    await waitFor(() => expect(api.setMfaRequirement).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('status')).toHaveTextContent(/required for all staff/i);
  });

  it('cancelling the confirmation changes nothing', async () => {
    api.getMfaRequirement.mockResolvedValue({ required: false, staffWithoutMfa: 2, actorMfaEnabled: true });
    renderPolicy();
    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.setMfaRequirement).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('refreshes the "set up your own first" hint once the admin enrolls', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    // TwoFactorSettings (above this section) owns the admin's own status.
    queryClient.setQueryData(['mfa-status'], { enabled: false });
    api.getMfaRequirement
      .mockResolvedValueOnce({ required: false, staffWithoutMfa: 2, actorMfaEnabled: false })
      .mockResolvedValue({ required: false, staffWithoutMfa: 1, actorMfaEnabled: true });
    renderPolicy(queryClient);

    expect(await screen.findByText(/set up two-factor authentication for your own account first/i)).toBeInTheDocument();
    expect(api.getMfaRequirement).toHaveBeenCalledTimes(1);

    // The admin finishes enrolling: their own status turns on.
    act(() => { queryClient.setQueryData(['mfa-status'], { enabled: true }); });

    await waitFor(() => expect(screen.queryByText(/set up two-factor authentication for your own account first/i)).not.toBeInTheDocument());
    expect(api.getMfaRequirement).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent(/1 active staff member has not set up/i);
    // It only observes that status; it never fetches it.
    expect(api.getMfaStatus).not.toHaveBeenCalled();
  });

  it('explains that the admin must enroll first when the server refuses', async () => {
    api.getMfaRequirement.mockResolvedValue({ required: false, staffWithoutMfa: 4, actorMfaEnabled: false });
    api.setMfaRequirement.mockRejectedValue(apiError('Turn on two-factor authentication for your own account before requiring it for everyone.', 409, { code: 'MFA_SELF_ENROLLMENT_REQUIRED' }));
    renderPolicy();

    expect(await screen.findByText(/set up two-factor authentication for your own account first/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /require two-factor/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/your own account/i);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('turns the requirement off without a confirmation dialog', async () => {
    api.getMfaRequirement.mockResolvedValue({ required: true, staffWithoutMfa: 0, actorMfaEnabled: true });
    api.setMfaRequirement.mockResolvedValue({ required: false, staffWithoutMfa: 0, actorMfaEnabled: true, changed: true });
    renderPolicy();

    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/every active staff member has two-factor/i);
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setMfaRequirement).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  });
});
