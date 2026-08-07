import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgePrivateCaches } from '../lib/private-cache';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    delete navigator.serviceWorker;
  }
});

describe('purgePrivateCaches', () => {
  it('deletes only legacy private API caches', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['hub-api-v1', 'hub-api-v3', 'hub-static-v3', 'hub-v3']),
      delete: deleteCache,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: null, getRegistrations: vi.fn().mockResolvedValue([]) },
    });

    await purgePrivateCaches();

    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(deleteCache).toHaveBeenCalledWith('hub-api-v1');
    expect(deleteCache).toHaveBeenCalledWith('hub-api-v3');
    expect(deleteCache).not.toHaveBeenCalledWith('hub-static-v3');
  });

  it('notifies controlled, active, waiting, and installing workers', async () => {
    const controller = { postMessage: vi.fn() };
    const active = { postMessage: vi.fn() };
    const waiting = { postMessage: vi.fn() };
    const installing = { postMessage: vi.fn() };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller,
        getRegistrations: vi.fn().mockResolvedValue([{ active, waiting, installing }]),
      },
    });

    await purgePrivateCaches();

    const message = { type: 'PURGE_PRIVATE_CACHES' };
    expect(controller.postMessage).toHaveBeenCalledWith(message);
    expect(active.postMessage).toHaveBeenCalledWith(message);
    expect(waiting.postMessage).toHaveBeenCalledWith(message);
    expect(installing.postMessage).toHaveBeenCalledWith(message);
  });
});
