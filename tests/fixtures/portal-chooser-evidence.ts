import { writeFile } from 'node:fs/promises';
import type { Page, Request, TestInfo } from '@playwright/test';

export const PORTAL_CHOOSER_TITLE = 'client contact navigates portal tabs, uploads, chats and cancels a delete with the keyboard only';
export const TRACE_POLICY = { mode: 'on', sources: false, attachments: false, screenshots: true, snapshots: true } as const;
const MARKS = new Set(['UPLOAD_FOCUS_START', 'UPLOAD_FOCUS_CONFIRMED', 'LISTENER_ARMED', 'ENTER_START', 'ENTER_END', 'SETFILES_START', 'SETFILES_END', 'UPLOAD_ASSERTED']);
const ALIASES = ['upload-button', 'file-input', 'portal-tab', 'textarea', 'button', 'link', 'body', 'other', 'none'];
const BROWSER_EVENTS = ['FOCUS_IN', 'FOCUS_OUT', 'WINDOW_FOCUS', 'WINDOW_BLUR', 'VISIBILITY', 'KEY_DOWN', 'KEY_UP', 'CLICK', 'UPLOAD_CONNECTED', 'UPLOAD_DISCONNECTED', 'UPLOAD_ATTRIBUTES'];
const API: Record<string, string> = {
  'GET /api/auth/me': 'AUTH_ME',
  'POST /api/client-portal/verify-token': 'VERIFY_TOKEN',
  ...Object.fromEntries(Object.entries({ me: 'PORTAL_ME', projects: 'PROJECTS', invoices: 'INVOICES', contracts: 'CONTRACTS', retainer: 'RETAINER', 'unread-count': 'UNREAD' }).map(([path, alias]) => [`GET /api/client-portal/${path}`, alias])),
  ...Object.fromEntries(Object.entries({ '': 'PROJECT', '/tasks': 'TASKS', '/resource-links': 'RESOURCES', '/documents': 'DOCUMENTS', '/messages': 'MESSAGES' }).map(([path, alias]) => [`GET /api/client-portal/projects/project-a${path}`, alias])),
  'POST /api/client-portal/projects/project-a/upload': 'UPLOAD',
  'POST /api/client-portal/projects/project-a/messages': 'MESSAGES',
  'DELETE /api/client-portal/documents/document-a': 'DELETE_DOCUMENT',
};

export function classifyRequest(url: string, method: string, resourceType: string, origin: string) {
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.username || parsed.password) return { allowed: false, kind: 'external', requestAlias: 'UNAPPROVED' } as const;
  if (parsed.pathname.startsWith('/api/')) {
    const alias = API[`${method} ${parsed.pathname}`];
    return { allowed: Boolean(alias) && !parsed.search, kind: 'api', requestAlias: alias ?? 'UNAPPROVED' } as const;
  }
  if (method !== 'GET') return { allowed: false, kind: 'asset', requestAlias: 'UNAPPROVED' } as const;
  if (resourceType === 'document') return { allowed: parsed.pathname === '/client-portal/verify' && parsed.search === '?token=portal-keyboard-token', kind: 'asset', requestAlias: 'DOCUMENT' } as const;
  const aliases: Record<string, string> = { script: 'SCRIPT', stylesheet: 'STYLE', font: 'FONT', image: 'IMAGE' };
  const alias = parsed.pathname.startsWith('/@') ? 'VITE' : aliases[resourceType];
  const asset = /^(?:\/src\/|\/assets\/|\/node_modules\/|\/@(?:fs\/|vite\/|react-refresh))/.test(parsed.pathname) || /^\/(?:favicon\.ico|vite\.svg)$/.test(parsed.pathname);
  return { allowed: Boolean(alias) && asset, kind: 'asset', requestAlias: alias ?? 'UNAPPROVED' } as const;
}

// Rebuild every event from closed scalar fields; never serialize page objects or raw errors.
export function sanitizeBrowserEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!BROWSER_EVENTS.includes(String(source.event)) || !Number.isInteger(source.seq) || Number(source.seq) < 1 || Number(source.seq) > 400 || !Number.isFinite(source.ms) || Number(source.ms) < 0) return null;
  const result: Record<string, unknown> = { seq: source.seq, clock: 'browser', ms: source.ms, event: source.event };
  for (const key of ['target', 'active']) if (ALIASES.includes(String(source[key]))) result[key] = source[key];
  for (const key of ['generation', 'activeGeneration']) if (Number.isInteger(source[key]) && Number(source[key]) >= 0 && Number(source[key]) <= 10000) result[key] = source[key];
  for (const key of ['connected', 'disabled', 'activeConnected', 'activeDisabled', 'hasFocus', 'userActive', 'userEverActive', 'trusted', 'defaultPrevented']) if (typeof source[key] === 'boolean') result[key] = source[key];
  if (['capture', 'bubble', 'observer'].includes(String(source.phase))) result.phase = source.phase;
  if (['visible', 'hidden', 'unknown'].includes(String(source.visibility))) result.visibility = source.visibility;
  if (['Tab', 'Enter', 'Space', 'OTHER'].includes(String(source.key))) result.key = source.key;
  if (['BUTTON', 'INPUT', 'TEXTAREA', 'A', 'DIV', 'BODY', 'OTHER'].includes(String(source.targetTag))) result.targetTag = source.targetTag;
  if (Array.isArray(source.path)) result.path = source.path.slice(0, 8).map(alias => ALIASES.includes(String(alias)) ? alias : 'other');
  return result;
}

export function sanitizeFontChecks(value: unknown) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { status: ['loaded', 'loading'].includes(String(source.status)) ? source.status as string : 'unavailable', registeredDmSans: source.registeredDmSans === true, dmSans400: source.dmSans400 === true, dmSans500: source.dmSans500 === true, dmSans600: source.dmSans600 === true };
}

export async function startPortalChooserEvidence(page: Page, testInfo: TestInfo, baseURL: string | undefined) {
  const origin = new URL(baseURL ?? '').origin;
  const url = new URL(origin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || testInfo.title !== PORTAL_CHOOSER_TITLE) throw new Error('PORTAL_CHOOSER_SCOPE');
  testInfo.annotations.push({ type: 'portal-chooser-repeat', description: String(testInfo.repeatEachIndex) });
  const events: Record<string, unknown>[] = [];
  const start = performance.now();
  let truncated = false;
  let externalBlockedCount = 0;
  let unexpectedApiCount = 0;
  const emit = (event: string, fields: Record<string, unknown> = {}) => {
    if (events.length >= 160 || (['REQUEST', 'REQUEST_FINISHED', 'REQUEST_FAILED', 'CONSOLE_ERROR'].includes(event) && events.length >= 136)) { truncated = true; return; }
    events.push({ seq: events.length + 1, clock: 'node', ms: performance.now() - start, event, ...fields });
  };
  const fields = (request: Request) => {
    const classified = classifyRequest(request.url(), request.method(), request.resourceType(), origin);
    return { requestAlias: classified.requestAlias, method: ['GET', 'POST', 'DELETE'].includes(request.method()) ? request.method() : 'OTHER', kind: classified.kind };
  };
  const block = (kind: string) => {
    if (kind === 'external') externalBlockedCount++; else if (kind === 'api') unexpectedApiCount++;
    emit('BOUNDARY_BLOCK', { kind: ['external', 'api'].includes(kind) ? kind : 'asset' });
  };
  // Context fence also covers popups. No API may reach the network, even an approved URL.
  await page.context().route('**/*', async route => {
    const request = route.request();
    const decision = classifyRequest(request.url(), request.method(), request.resourceType(), origin);
    if (!decision.allowed || decision.kind === 'api') { block(decision.kind); await route.abort('blockedbyclient'); return; }
    await route.continue();
  });
  // Installed after the canned API fixture; only these exact methods fall through to it.
  await page.route('**/api/**', async route => {
    const request = route.request();
    const decision = classifyRequest(request.url(), request.method(), request.resourceType(), origin);
    if (!decision.allowed || decision.kind !== 'api') { block(decision.kind); await route.abort('blockedbyclient'); return; }
    await route.fallback();
  });
  await page.context().routeWebSocket(/.*/, socket => {
    const socketUrl = new URL(socket.url());
    block(socketUrl.hostname === url.hostname && socketUrl.port === url.port ? 'asset' : 'external');
    socket.close();
  });
  await page.addInitScript(() => {
    const events: Record<string, unknown>[] = [];
    let truncated = false;
    let next = 0;
    const generations = new WeakMap<Element, number>();
    const tracked = new Set<Element>();
    const alias = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) return 'none';
      if (target.matches('button.cp-upload-zone')) return 'upload-button';
      if (target.matches('input[type="file"]')) return 'file-input';
      if (target.matches('[role="tab"]')) return 'portal-tab';
      return ({ TEXTAREA: 'textarea', BUTTON: 'button', A: 'link', BODY: 'body' } as Record<string, string>)[target.tagName] ?? 'other';
    };
    const generation = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !['upload-button', 'file-input'].includes(alias(target))) return 0;
      if (!generations.has(target)) generations.set(target, Math.min(++next, 10000));
      return generations.get(target)!;
    };
    const record = (event: string, phase = 'observer', input?: Event, target: EventTarget | null = input?.target ?? null) => {
      if (events.length >= 400) { truncated = true; return; }
      const element = target instanceof Element ? target : null;
      const active = document.activeElement;
      const activation = navigator.userActivation;
      const item: Record<string, unknown> = {
        seq: events.length + 1, clock: 'browser', ms: performance.now(), event, phase,
        target: alias(target), active: alias(active), generation: generation(target), activeGeneration: generation(active),
        connected: Boolean(element?.isConnected), disabled: Boolean(element?.matches(':disabled')), activeConnected: Boolean(active?.isConnected), activeDisabled: Boolean(active?.matches(':disabled')),
        hasFocus: document.hasFocus(), userActive: Boolean(activation?.isActive), userEverActive: Boolean(activation?.hasBeenActive),
        trusted: Boolean(input?.isTrusted), defaultPrevented: Boolean(input?.defaultPrevented), visibility: document.visibilityState === 'visible' ? 'visible' : 'hidden',
        targetTag: element && ['BUTTON', 'INPUT', 'TEXTAREA', 'A', 'DIV', 'BODY'].includes(element.tagName) ? element.tagName : 'OTHER',
      };
      if (input instanceof KeyboardEvent) item.key = ['Tab', 'Enter'].includes(input.key) ? input.key : input.key === ' ' ? 'Space' : 'OTHER';
      if (input?.type === 'click') item.path = input.composedPath().slice(0, 8).map(alias);
      events.push(item);
    };
    for (const [name, code] of [['focusin', 'FOCUS_IN'], ['focusout', 'FOCUS_OUT'], ['keydown', 'KEY_DOWN'], ['keyup', 'KEY_UP'], ['click', 'CLICK']]) {
      document.addEventListener(name, event => record(code, 'capture', event), true);
      document.addEventListener(name, event => record(code, 'bubble', event));
    }
    window.addEventListener('focus', event => record('WINDOW_FOCUS', 'observer', event));
    window.addEventListener('blur', event => record('WINDOW_BLUR', 'observer', event));
    document.addEventListener('visibilitychange', event => record('VISIBILITY', 'observer', event));
    const attributes = new MutationObserver(records => records.forEach(item => record('UPLOAD_ATTRIBUTES', 'observer', undefined, item.target)));
    const discover = () => {
      for (const element of document.querySelectorAll('button.cp-upload-zone,input[type="file"]')) {
        if (!tracked.has(element)) { if (next >= 64) { truncated = true; continue; } tracked.add(element); generation(element); attributes.observe(element, { attributes: true, attributeFilter: ['disabled', 'hidden', 'tabindex'] }); record('UPLOAD_CONNECTED', 'observer', undefined, element); }
      }
      for (const element of tracked) if (!element.isConnected) { record('UPLOAD_DISCONNECTED', 'observer', undefined, element); tracked.delete(element); }
    };
    new MutationObserver(discover).observe(document, { childList: true, subtree: true });
    (window as unknown as { __portalChooser659: unknown }).__portalChooser659 = { drain: () => {
      const fonts = document.fonts;
      const registeredDmSans = fonts ? Array.from(fonts).slice(0, 256).some(face => face.family.replace(/^["']|["']$/g, '') === 'DM Sans') : false;
      return { events, truncated, fontChecks: { status: fonts?.status ?? 'unavailable', registeredDmSans, dmSans400: Boolean(fonts?.check('400 16px "DM Sans"')), dmSans500: Boolean(fonts?.check('500 16px "DM Sans"')), dmSans600: Boolean(fonts?.check('600 16px "DM Sans"')) } };
    } };
  });
  const onRequest = (request: Request) => emit('REQUEST', fields(request));
  const onFinished = (request: Request) => emit('REQUEST_FINISHED', fields(request));
  const onFailed = (request: Request) => emit('REQUEST_FAILED', fields(request));
  const onChooser = () => emit('FILECHOOSER');
  const onError = () => emit('PAGE_ERROR');
  const onCrash = () => emit('CRASH');
  const onConsole = (message: { type(): string }) => { if (message.type() === 'error') emit('CONSOLE_ERROR'); };
  page.on('request', onRequest); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
  page.on('pageerror', onError); page.on('crash', onCrash); page.on('console', onConsole);
  emit('START');
  return {
    mark(event: string) {
      if (!MARKS.has(event)) throw new Error('PORTAL_CHOOSER_MARK');
      emit(event);
      // Register only after the test's original waiter. No extra await on activation path.
      if (event === 'LISTENER_ARMED') page.once('filechooser', onChooser);
    },
    async finish(outcome: 'completed' | 'failed') {
      emit(outcome === 'completed' ? 'BODY_COMPLETED' : 'BODY_FAILED');
      let browser: Record<string, unknown>[] = [];
      let fontChecks = sanitizeFontChecks(undefined);
      let drainStatus = page.isClosed() ? 'page_closed' : 'complete';
      if (!page.isClosed()) {
        try {
          const drain = page.evaluate(() => (window as unknown as { __portalChooser659?: { drain(): { events: unknown[]; truncated: boolean; fontChecks: unknown } } }).__portalChooser659?.drain());
          let timer: ReturnType<typeof setTimeout> | undefined;
          const drained = await Promise.race([drain, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 2000); })]).finally(() => clearTimeout(timer));
          if (!drained) drainStatus = 'unavailable';
          else { browser = drained.events.map(sanitizeBrowserEvent).filter((event): event is Record<string, unknown> => event !== null); truncated ||= drained.truncated; fontChecks = sanitizeFontChecks(drained.fontChecks); }
        } catch { drainStatus = page.isClosed() ? 'page_closed' : 'unavailable'; }
      }
      emit('FLUSH');
      page.off('request', onRequest); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed);
      page.off('filechooser', onChooser);
      page.off('pageerror', onError); page.off('crash', onCrash); page.off('console', onConsole);
      const proof = { schemaVersion: 1, issue: 659, title: PORTAL_CHOOSER_TITLE, projectName: testInfo.project.name, retry: testInfo.retry, repeatEachIndex: testInfo.repeatEachIndex, sourceMarker: 'portal-chooser-659-v1', synthetic: true, originScope: 'loopback-only', tracePolicy: TRACE_POLICY, fontChecks, boundary: { externalBlockedCount, unexpectedApiCount, truncated, drainStatus }, events: [...events, ...browser] };
      const path = testInfo.outputPath('portal-chooser-659-chronology.json');
      await writeFile(path, JSON.stringify(proof));
      await testInfo.attach('portal-chooser-659-chronology', { path, contentType: 'application/json' });
    },
  };
}
