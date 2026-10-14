import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientAssistantPreview from '../components/ClientAssistantPreview';

const { previewClientAssistant } = vi.hoisted(() => ({ previewClientAssistant: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { previewClientAssistant } }));

function ask(message = 'What is the project status?') {
  fireEvent.click(screen.getByText('Assistant preview'));
  fireEvent.change(screen.getByLabelText('Ask about this client'), { target: { value: message } });
  fireEvent.submit(screen.getByLabelText('Ask about this client').closest('form'));
}

beforeEach(() => { vi.resetAllMocks(); });

describe('client assistant preview', () => {
  it('generates only on explicit submission, scopes to the client and renders plain text provenance', async () => {
    previewClientAssistant.mockResolvedValue({
      response: '<img src=x onerror=alert(1)> Ready for review.',
      context: { projects: [{ id: 'p1', name: 'Website', status: 'ACTIVE' }], truncated: true },
    });
    const { container } = render(<ClientAssistantPreview clientId="client-a" clientName="Acme" />);
    expect(previewClientAssistant).not.toHaveBeenCalled();
    ask('  What is the project status?  ');
    await screen.findByText('<img src=x onerror=alert(1)> Ready for review.');
    expect(previewClientAssistant).toHaveBeenCalledExactlyOnceWith('client-a', { message: 'What is the project status?' });
    expect(screen.getByText('Website — ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/Only part of this client/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Ask about this client')).toHaveAttribute('maxlength', '2000');
    expect(screen.getByText(/Conversations are not saved/)).toBeInTheDocument();
  });

  it('blocks duplicate submissions while pending and reports safe errors without automatic retry', async () => {
    let reject;
    previewClientAssistant.mockImplementation(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }));
    render(<ClientAssistantPreview clientId="client-a" />);
    ask();
    fireEvent.submit(screen.getByLabelText('Ask about this client').closest('form'));
    expect(previewClientAssistant).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Generating preview…')).toBeInTheDocument();
    await act(async () => { reject(new Error('Secret provider credential and response body')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Assistant preview could not be generated');
    expect(screen.queryByText(/Secret provider/)).not.toBeInTheDocument();
    expect(previewClientAssistant).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Generate preview' })).toBeEnabled();
  });

  it('discards an old client response and clears the question when the client changes', async () => {
    let resolveOld;
    previewClientAssistant.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<ClientAssistantPreview clientId="client-a" clientName="Acme" />);
    ask();
    rerender(<ClientAssistantPreview clientId="client-b" clientName="Beta" />);
    expect(screen.getByLabelText('Ask about this client')).toHaveValue('');
    await act(async () => { resolveOld({ response: 'Acme confidential response', context: { projects: [] } }); });
    expect(screen.queryByText('Acme confidential response')).not.toBeInTheDocument();
    expect(previewClientAssistant).toHaveBeenCalledTimes(1);
    previewClientAssistant.mockResolvedValueOnce({ response: 'Beta preview', context: { projects: [] } });
    fireEvent.change(screen.getByLabelText('Ask about this client'), { target: { value: 'Beta status?' } });
    fireEvent.submit(screen.getByLabelText('Ask about this client').closest('form'));
    await waitFor(() => expect(screen.getByText('Beta preview')).toBeInTheDocument());
    expect(previewClientAssistant).toHaveBeenLastCalledWith('client-b', { message: 'Beta status?' });
  });

  it('explains a known budget error without displaying the provider message or body', async () => {
    previewClientAssistant.mockRejectedValue(Object.assign(new Error('Secret provider credential'), {
      data: { code: 'AI_BUDGET_EXCEEDED', error: 'Secret provider response body' },
    }));
    render(<ClientAssistantPreview clientId="client-a" />);
    ask();
    expect(await screen.findByRole('alert')).toHaveTextContent('monthly AI budget');
    expect(screen.getByRole('alert')).toHaveTextContent('Ask an admin to review the budget in Settings.');
    expect(screen.queryByText(/Secret provider/)).not.toBeInTheDocument();
    expect(previewClientAssistant).toHaveBeenCalledTimes(1);
  });

  it('does not submit blank or oversized questions', () => {
    render(<ClientAssistantPreview clientId="client-a" />);
    ask('   ');
    expect(previewClientAssistant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ask about this client'), { target: { value: 'x'.repeat(2001) } });
    fireEvent.submit(screen.getByLabelText('Ask about this client').closest('form'));
    expect(previewClientAssistant).not.toHaveBeenCalled();
  });
});
