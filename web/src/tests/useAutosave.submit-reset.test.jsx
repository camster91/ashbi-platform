import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave from '../hooks/useAutosave';

vi.mock('../lib/api.js', () => ({
  default: { getDraft: vi.fn(), saveDraft: vi.fn(), clearDraft: vi.fn() },
}));

import api from '../lib/api.js';

const blankForm = { title: '', amount: '' };
const recoveredForm = { title: 'Recovered invoice', amount: '100' };
const editedForm = { title: 'Ready to submit', amount: '120' };
const settleDebounce = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60));
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function setup() {
  const hook = renderHook(
    ({ form }) => useAutosave('invoice', 'new-invoice', form, 20),
    { initialProps: { form: blankForm } },
  );
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  await waitFor(() => expect(hook.result.current.draft).toEqual(recoveredForm));
  return hook;
}

describe('useAutosave after successful invoice submission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getDraft.mockResolvedValue({ draft: recoveredForm, revision: 7 });
    api.saveDraft.mockResolvedValue({ revision: 8, savedAt: '2026-10-15T12:00:00.000Z' });
    api.clearDraft.mockResolvedValue({ cleared: true });
  });

  it('cancels an edited form queued for autosave before clearing the submitted draft', async () => {
    const { result, rerender } = await setup();
    rerender({ form: editedForm });

    await act(async () => {
      expect(await result.current.clearDraft({ resetTo: blankForm })).toBe(true);
    });
    await settleDebounce();

    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.clearDraft).toHaveBeenCalledWith('invoice', 'new-invoice', 7);
    expect(result.current.draft).toBeNull();
  });

  it('waits for an active save and clears its returned revision', async () => {
    const save = deferred();
    api.saveDraft.mockReturnValue(save.promise);
    const { result, rerender } = await setup();
    rerender({ form: editedForm });
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));

    let clearing;
    act(() => { clearing = result.current.clearDraft({ resetTo: blankForm }); });
    expect(api.clearDraft).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve({ revision: 8 });
      expect(await clearing).toBe(true);
    });

    expect(api.clearDraft).toHaveBeenCalledWith('invoice', 'new-invoice', 8);
    expect(result.current.revision).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('does not recreate a blank draft when the caller resets after clearing', async () => {
    const { result, rerender } = await setup();
    rerender({ form: editedForm });
    await waitFor(() => expect(result.current.status).toBe('saved'));

    await act(async () => {
      expect(await result.current.clearDraft({ resetTo: blankForm })).toBe(true);
    });
    api.saveDraft.mockClear();
    rerender({ form: { ...blankForm } });
    await settleDebounce();

    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.draft).toBeNull();

    rerender({ form: { title: 'Next invoice', amount: '50' } });
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    expect(api.saveDraft).toHaveBeenCalledWith(
      'invoice', 'new-invoice', { title: 'Next invoice', amount: '50' }, undefined, undefined,
    );
  });

  it.each([
    ['error', new Error('offline')],
    ['conflict', Object.assign(new Error('Changed elsewhere'), { status: 409 })],
  ])('retains the draft and its revision when clearing returns %s', async (status, error) => {
    api.clearDraft.mockRejectedValue(error);
    const { result, rerender } = await setup();

    await act(async () => {
      expect(await result.current.clearDraft({ resetTo: blankForm })).toBe(false);
    });

    expect(result.current.draft).toEqual(recoveredForm);
    expect(result.current.revision).toBe(7);
    expect(result.current.status).toBe(status);
    rerender({ form: { ...blankForm } });
    await settleDebounce();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['error', new Error('offline')],
    ['conflict', Object.assign(new Error('Changed elsewhere'), { status: 409 })],
  ])('preserves recovery when the active save ends in %s', async (status, error) => {
    const save = deferred();
    api.saveDraft.mockReturnValue(save.promise);
    const { result, rerender } = await setup();
    rerender({ form: editedForm });
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));

    let clearing;
    act(() => { clearing = result.current.clearDraft({ resetTo: blankForm }); });
    await act(async () => {
      save.reject(error);
      expect(await clearing).toBe(false);
    });

    expect(api.clearDraft).not.toHaveBeenCalled();
    expect(result.current.draft).toEqual(recoveredForm);
    expect(result.current.revision).toBe(7);
    expect(result.current.status).toBe(status);
  });
});
