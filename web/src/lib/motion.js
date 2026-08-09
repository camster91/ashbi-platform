export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function preferredScrollBehavior(matchMedia = globalThis.matchMedia) {
  return prefersReducedMotion(matchMedia) ? 'auto' : 'smooth';
}
