import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeChunkPreloadPlugin, VENDOR_CHUNK_GROUPS } from '../../vite.config.js';

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


it('keeps workspace icons and the Tailwind merge registry out of the public entry import graph', async () => {
  const entryId = '\0public-icon-entry';
  const workspaceId = '\0workspace-icon-page';
  const result = await build({
    configFile: false,
    root: resolve(process.cwd(), existsSync('web/package.json') ? 'web' : '.'),
    logLevel: 'silent',
    plugins: [{
      name: 'icon-isolation-fixture',
      resolveId(id) {
        if (id === 'public-icon-entry') return entryId;
        if (id === 'workspace-icon-page') return workspaceId;
      },
      load(id) {
        if (id === entryId) return "import { ArrowRight } from 'lucide-react'; import { clsx } from 'clsx'; globalThis.publicClass = clsx('public'); globalThis.publicIcon = ArrowRight; globalThis.loadWorkspace = () => import('workspace-icon-page');";
        if (id === workspaceId) return "import { ImageUpscale } from 'lucide-react'; import { twMerge } from 'tailwind-merge'; globalThis.workspaceClass = twMerge('p-2', 'p-4'); globalThis.workspaceIcon = ImageUpscale;";
      },
    }],
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: 'public-icon-entry',
        output: { codeSplitting: { groups: VENDOR_CHUNK_GROUPS } },
      },
    },
  });
  const chunks = result.output.filter(item => item.type === 'chunk');
  const entry = chunks.find(item => item.isEntry);
  const graph = new Set();
  const collect = chunk => {
    if (graph.has(chunk)) return;
    graph.add(chunk);
    chunk.imports.forEach(file => collect(chunks.find(item => item.fileName === file)));
  };
  collect(entry);
  const ownsWorkspaceIcon = chunk => Object.keys(chunk.modules).some(id => /[\\/]icons[\\/]image-upscale\.m?js$/.test(id));
  const ownsPublicIcon = chunk => Object.keys(chunk.modules).some(id => /[\\/]icons[\\/]arrow-right\.m?js$/.test(id));
  expect([...graph].some(ownsPublicIcon)).toBe(true);
  expect(chunks.some(ownsWorkspaceIcon)).toBe(true);
  expect([...graph].some(ownsWorkspaceIcon)).toBe(false);
  const ownsMergeRegistry = chunk => Object.keys(chunk.modules).some(id => /[\\/]tailwind-merge[\\/]/.test(id));
  expect(chunks.some(ownsMergeRegistry)).toBe(true);
  expect([...graph].some(ownsMergeRegistry)).toBe(false);
  expect(entry.dynamicImports).toHaveLength(1);
});
