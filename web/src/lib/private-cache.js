const LEGACY_API_CACHE_PREFIX = 'hub-api-';
const PURGE_MESSAGE = Object.freeze({ type: 'PURGE_PRIVATE_CACHES' });

/**
 * Remove private caches left by older service workers and notify every worker
 * lifecycle state so logout/account changes cannot expose a prior session.
 */
export async function purgePrivateCaches() {
  const work = [];

  if ('caches' in globalThis) {
    work.push(
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(LEGACY_API_CACHE_PREFIX))
          .map((key) => caches.delete(key))
      ))
    );
  }

  if ('navigator' in globalThis && 'serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage(PURGE_MESSAGE);
    work.push(
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        const workers = new Set();
        for (const registration of registrations) {
          if (registration.active) workers.add(registration.active);
          if (registration.waiting) workers.add(registration.waiting);
          if (registration.installing) workers.add(registration.installing);
        }
        for (const worker of workers) worker.postMessage(PURGE_MESSAGE);
      })
    );
  }

  await Promise.allSettled(work);
}
