import { describe, expect, it } from 'vitest';
import { routeChunkPreloadPlugin } from '../../vite.config.js';

function run(bundle, modules) {
  const plugin = routeChunkPreloadPlugin(modules);
  return plugin.transformIndexHtml.handler('<html></html>', { bundle });
}

const bundle = {
  'index.js': { type: 'chunk', isEntry: true, fileName: 'assets/index.js', imports: ['assets/vendor-react.js'] },
  'Login.js': {
    type: 'chunk',
    fileName: 'assets/Login.js',
    facadeModuleId: '/repo/web/src/pages/Login.jsx',
    imports: ['assets/vendor-react.js', 'assets/useTranslation.js'],
  },
  'index.css': { type: 'asset', fileName: 'assets/index.css' },
};

describe('login route chunk preload', () => {
  it('preloads the login chunk and its imports that the entry does not already load', () => {
    expect(run(bundle)).toEqual([
      { tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/Login.js' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/useTranslation.js' }, injectTo: 'head' },
    ]);
  });

  it('fails the build if the login route chunk disappears instead of silently dropping the preload', () => {
    expect(() => run(bundle, ['src/pages/Missing.jsx'])).toThrow(/no chunk found/);
  });

  it('only runs for production builds', () => {
    expect(routeChunkPreloadPlugin().apply).toBe('build');
  });
});

describe('login route chunk preload with a non-root base', () => {
  it('prefixes preload links with the configured base path', () => {
    const plugin = routeChunkPreloadPlugin();
    plugin.configResolved({ base: '/hub/' });
    const tags = plugin.transformIndexHtml.handler('<html></html>', { bundle });
    expect(tags.map((tag) => tag.attrs.href)).toEqual(['/hub/assets/Login.js', '/hub/assets/useTranslation.js']);
  });
});
