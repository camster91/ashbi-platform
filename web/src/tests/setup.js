import '@testing-library/jest-dom';

// Mock window.matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},   // Deprecated
    removeListener: () => {}, // Deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Keep a complete URL for BrowserRouter while making reload replaceable in
// recovery tests. Newer React Router versions resolve navigation against it.
const locationFields = Object.fromEntries(
  ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']
    .map((field) => [field, window.location[field]]),
);
// Under the vmThreads pool jsdom's own Location is unforgeable, so the
// replacement only applies in the `dom-forks` project (forks pool), where
// the tests that swap location live (vitest.config.js).
try {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...locationFields, reload: () => {} },
  });
} catch {
  // vmThreads: keep jsdom's Location.
}
