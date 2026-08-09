import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortalIntakeForm from '../pages/PortalIntakeForm';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPortalForm: vi.fn(),
    submitPortalForm: vi.fn(),
  },
}));

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/forms/test-token']}>
        <Routes><Route path="/forms/:token" element={<PortalIntakeForm />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('public intake accessibility', () => {
  afterEach(() => vi.clearAllMocks());

  it('has no automated role, name, form, or focus-order violations', async () => {
    api.getPortalForm.mockResolvedValue({
      name: 'Project intake',
      description: 'Tell us about the work.',
      clientName: 'Example client',
      fields: [
        { label: 'Project summary', type: 'TEXTAREA', required: true },
        { label: 'Contact preference', type: 'SELECT', options: ['Email', 'Phone'], required: true },
        { label: 'Terms accepted', type: 'CHECKBOX', required: true },
      ],
    });
    const { container } = renderForm();
    await screen.findByRole('heading', { name: 'Project intake' });

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('announces validation and moves focus to the error summary on keyboard submit', async () => {
    api.getPortalForm.mockResolvedValue({
      name: 'Project intake',
      fields: [{ label: 'Project summary', type: 'TEXTAREA', required: true }],
    });
    renderForm();
    const user = userEvent.setup();
    const submit = await screen.findByRole('button', { name: 'Submit' });
    submit.focus();
    await user.keyboard('{Enter}');

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText(/Your Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Project summary/)).toHaveAccessibleDescription('Complete Project summary.');
    expect(api.submitPortalForm).not.toHaveBeenCalled();
  });
});
