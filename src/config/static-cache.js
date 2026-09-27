import path from 'node:path';

// Cache policy for the built SPA served by @fastify/static.
//
// - /assets/* are Vite outputs with a content hash in the file name: a new
//   build produces new names, so browsers and CDNs may keep them forever.
// - index.html, the service worker and the web manifest must be revalidated
//   on every load, or clients keep booting a deleted build (and its missing
//   hashed chunks) after a deploy.
// - Other public files (icons) are stable but unhashed: short cache.
export const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE = 'no-cache';
export const SHORT_PUBLIC_CACHE = 'public, max-age=3600';

const REVALIDATE_FILES = new Set(['index.html', 'sw.js', 'manifest.json', 'manifest.webmanifest', 'registerSW.js']);

export function staticCacheControl(filePath, root) {
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  if (relative.startsWith('assets/')) return IMMUTABLE_ASSET_CACHE;
  if (REVALIDATE_FILES.has(relative) || relative.endsWith('.html')) return REVALIDATE_CACHE;
  return SHORT_PUBLIC_CACHE;
}

/** Options for `fastify.register(fastifyStatic, ...)`. */
export function spaStaticOptions(root) {
  return {
    root,
    prefix: '/',
    // Our setHeaders owns Cache-Control (send's default is max-age=0).
    cacheControl: false,
    setHeaders(reply, filePath) {
      reply.header('Cache-Control', staticCacheControl(filePath, root));
    },
  };
}
