import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sockets = [];
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const handlers = {};
    const socket = {
      connected: false,
      on: vi.fn((event, fn) => { (handlers[event] ||= []).push(fn); }),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    sockets.push(socket);
    return socket;
  }),
}));

let mockUser = { id: 'u1' };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser }) }));

const { useSocket, resetSharedSocketForTests } = await import('../hooks/useSocket');

function Probe() {
  useSocket();
  return null;
}

function renderStrict() {
  const queryClient = new QueryClient();
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Probe />
        <Probe />
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('useSocket', () => {
  beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; mockUser = { id: 'u1' }; });
  afterEach(() => { resetSharedSocketForTests(); vi.useRealTimers(); });

  it('opens one socket under StrictMode and does not close it while it is still in use', () => {
    const view = renderStrict();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(sockets).toHaveLength(1);
    expect(sockets[0].disconnect).not.toHaveBeenCalled();

    view.unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not connect without a signed-in user (public pages)', () => {
    mockUser = null;
    renderStrict();
    expect(sockets).toHaveLength(0);
  });
});
