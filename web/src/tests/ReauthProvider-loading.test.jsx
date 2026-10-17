import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ handler: null, loads: 0 }));
vi.mock('../lib/api', () => ({
  setReauthHandler: vi.fn((handler) => { state.handler = handler; }),
}));
vi.mock('../components/ReauthDialog', async () => {
  state.loads += 1;
  throw new Error('Dialog chunk unavailable');
});
const { ReauthProvider } = await import('../components/ReauthProvider');

it('registers without loading the dialog and fails closed when the requested chunk cannot load', async () => {
  const { unmount } = render(<ReauthProvider><p>App remains available</p></ReauthProvider>);
  expect(state.handler).toEqual(expect.any(Function));
  expect(state.loads).toBe(0);
  expect(screen.getByText('App remains available')).toBeInTheDocument();

  let result;
  await act(async () => { result = await state.handler(); });
  expect(result).toBe(false);
  expect(state.loads).toBe(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('App remains available')).toBeInTheDocument();
  unmount();
  expect(state.handler).toBe(null);
});
