import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave from '../hooks/useAutosave';

vi.mock('../lib/api.js', () => ({
  default: {
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    clearDraft: vi.fn(),
  },
}));

import api from '../lib/api.js';

describe('useAutosave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDraft.mockResolvedValue({ draft: null });
    api.saveDraft.mockResolvedValue({ revision: 1, savedAt: '2026-08-07T18:00:00.000Z' });
    api.clearDraft.mockResolvedValue({ cleared: true });
  });

  it('does not save the initial server-backed form value', async () => {
    const form = { title: 'Existing title' };
    renderHook(() => useAutosave('proposal', 'proposal-1', form, 10));

    await waitFor(() => expect(api.getDraft).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('debounces meaningful edits and saves with the loaded revision', async () => {
    api.getDraft.mockResolvedValue({ draft: null, revision: 4 });
    const { rerender } = renderHook(
      ({ form }) => useAutosave('invoice', 'invoice-1', form, 10),
      { initialProps: { form: { title: 'Initial' } } },
    );
    await waitFor(() => expect(api.getDraft).toHaveBeenCalledTimes(1));

    rerender({ form: { title: 'Edited' } });

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(
      'invoice',
      'invoice-1',
      { title: 'Edited' },
      4,
      undefined,
    ));
  });

  it('exposes a conflict and does not report stale work as saved', async () => {
    api.saveDraft.mockRejectedValue(Object.assign(new Error('Draft conflict'), {
      status: 409,
      data: { code: 'DRAFT_CONFLICT', currentRevision: 3 },
    }));
    const { result, rerender } = renderHook(
      ({ form }) => useAutosave('contract', 'contract-1', form, 10),
      { initialProps: { form: { title: 'Initial' } } },
    );
    await waitFor(() => expect(api.getDraft).toHaveBeenCalledTimes(1));

    rerender({ form: { title: 'Edited elsewhere' } });

    await waitFor(() => expect(result.current.status).toBe('conflict'));
    expect(result.current.lastSaved).toBeNull();
  });

  it('clears only the currently loaded draft revision', async () => {
    api.getDraft.mockResolvedValue({ draft: { title: 'Recovered' }, revision: 7 });
    const { result } = renderHook(() => useAutosave('estimate', 'estimate-1', null, 10));
    await waitFor(() => expect(result.current.draft).toEqual({ title: 'Recovered' }));

    await act(async () => result.current.clearDraft());

    expect(api.clearDraft).toHaveBeenCalledWith('estimate', 'estimate-1', 7);
    expect(result.current.draft).toBeNull();
  });

  it('warns before unloading while edits are not safely persisted', async () => {
    api.saveDraft.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook(
      ({ form }) => useAutosave('proposal', 'proposal-2', form, 10),
      { initialProps: { form: { title: 'Initial' } } },
    );
    await waitFor(() => expect(api.getDraft).toHaveBeenCalledTimes(1));
    rerender({ form: { title: 'Unsaved' } });
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('can retry a failed save without requiring another edit', async () => {
    api.saveDraft
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ revision: 1, draftSavedAt: '2026-08-07T18:00:00.000Z' });
    const { result, rerender } = renderHook(
      ({ form }) => useAutosave('invoice', 'invoice-2', form, 10),
      { initialProps: { form: { title: 'Initial' } } },
    );
    await waitFor(() => expect(api.getDraft).toHaveBeenCalledTimes(1));
    rerender({ form: { title: 'Retry me' } });
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => result.current.saveNow());

    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });
});
