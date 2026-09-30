import { expect, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Shared setup for the visual-regression baselines (#322).
 * See docs/visual-baselines.md for what is covered and how to update them.
 */

// Every screenshot is taken "on" this instant. It matches the `NOW` used by
// tests/fixtures/authenticated-api.ts, so due dates, greetings and relative
// times ("1 day ago") render the same on every run.
export const FROZEN_NOW = new Date('2026-08-20T15:00:00.000Z');

export type Theme = 'light' | 'dark';

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/** The theme x width matrix every staff screen is captured at. */
export const MATRIX: Array<{ theme: Theme; viewport: ViewportName }> = [
  { theme: 'light', viewport: 'mobile' },
  { theme: 'light', viewport: 'desktop' },
  { theme: 'dark', viewport: 'mobile' },
  { theme: 'dark', viewport: 'desktop' },
];

export function snapshotName(screen: string, theme: Theme, viewport: ViewportName) {
  return `${screen}-${theme}-${VIEWPORTS[viewport].width}.png`;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const YESTERDAY = '2026-08-19T15:00:00.000Z';
const NEXT_WEEK = '2026-08-27T15:00:00.000Z';

// GET /api/work-queue (work-queue.routes.js): one row per view so every tab
// count is non-zero and the default "Needs action" tab has two rows.
const workQueue = {
  view: null,
  rows: [
    { type: 'task', id: 'task-a', title: 'Finalize homepage wireframe', sourceUrl: '/task/task-a', client: { id: 'client-a', name: 'Northwind Studio' }, project: { id: 'project-a', name: 'Website Redesign' }, owner: { id: 'user-admin', name: 'Cameron Admin', role: null }, state: 'IN_PROGRESS', nextAction: 'Finish the task', dueAt: NEXT_WEEK, ageDays: 3, view: 'needs_action' },
    { type: 'review', id: 'review-a', title: 'Homepage draft', sourceUrl: '/review/review-a', client: { id: 'client-a', name: 'Northwind Studio' }, project: { id: 'project-a', name: 'Website Redesign' }, owner: { id: 'user-admin', name: 'Cameron Admin', role: null }, state: 'CHANGES_REQUESTED', nextAction: 'Address the requested changes', dueAt: null, ageDays: 1, view: 'needs_action' },
    { type: 'approval', id: 'approval-a', title: 'Send launch email', sourceUrl: '/approvals', client: { id: 'client-a', name: 'Northwind Studio' }, project: null, owner: { id: null, name: 'Admins', role: 'ADMIN' }, state: 'PENDING', nextAction: 'Approve or reject this email', dueAt: null, ageDays: 1, view: 'awaiting_approval' },
    { type: 'task', id: 'task-b', title: 'Collect brand assets', sourceUrl: '/task/task-b', client: { id: 'client-a', name: 'Northwind Studio' }, project: { id: 'project-a', name: 'Website Redesign' }, owner: null, state: 'PENDING', nextAction: 'Waiting on the client', dueAt: NEXT_WEEK, ageDays: 5, view: 'waiting_on_client' },
    { type: 'invoice', id: 'invoice-a', title: 'Invoice INV-2026-001', sourceUrl: '/invoices/invoice-a', client: { id: 'client-a', name: 'Northwind Studio' }, project: { id: 'project-a', name: 'Website Redesign' }, owner: null, state: 'SENT', nextAction: 'Due in 7 days: confirm the client received it', dueAt: NEXT_WEEK, ageDays: 7, view: 'at_risk' },
  ],
  counts: { needs_action: 2, awaiting_approval: 1, waiting_on_client: 1, at_risk: 1 },
  total: 5,
  sources: ['tasks', 'approvals', 'reviews', 'proposals', 'contracts', 'invoices'],
  partial: false,
  failedSources: [],
  truncatedSources: [],
  generatedAt: YESTERDAY,
};

/**
 * Screens the shared authenticated fixture does not answer yet. Registered
 * after `mockAuthenticatedApi`, so it is consulted first and falls back to it.
 */
export async function mockVisualExtras(page: Page) {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'GET' && pathname === '/api/work-queue') {
      const view = new URL(request.url()).searchParams.get('view');
      return json(route, view ? { ...workQueue, view, rows: workQueue.rows.filter(row => row.view === view) } : workQueue);
    }
    return route.fallback();
  });
}

/**
 * Pins the clock and colour scheme, sizes the viewport and cuts the realtime
 * socket before the first navigation. `pushPrompt: false` records that the
 * signed-in user already answered the push-notification prompt, so the shell
 * banner only appears on the screens that capture it on purpose.
 */
export async function prepare(page: Page, theme: Theme, viewport: ViewportName, { pushPrompt = false } = {}) {
  // Fixes Date.now()/new Date() without faking timers, so data fetching and
  // debounces still run normally.
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  // There is no backend: keep socket.io from retrying against the preview
  // proxy, which would make connection-state UI race the screenshot.
  await page.route('**/socket.io/**', route => route.abort());
  await page.routeWebSocket(/\/socket\.io\//, ws => ws.close());
  // The app declares its self-hosted faces with `font-display: optional`, so
  // a face that is not ready within ~100 ms of first use is skipped for the
  // life of the page. That makes a cold render use DejaVu Sans on one run and
  // DM Sans on the next. Baselines show the intended typography (what a
  // returning visitor with cached fonts sees), so the stylesheet is served
  // with `block` and `settle` waits for every face.
  await page.route('**/assets/*.css', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('font-display:optional', 'font-display:block');
    return route.fulfill({ response, body });
  });
  if (!pushPrompt) {
    await page.addInitScript(() => {
      try { window.localStorage.setItem('push-prompt-snoozed:user-admin', 'true'); } catch { /* storage blocked */ }
    });
  }
}

/**
 * Waits until web fonts, images and finite entry animations have settled so
 * the first screenshot is already the final frame.
 */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    // `document.fonts.ready` alone is not enough: it resolves as soon as no
    // face is *currently* loading, which can be before a face that the page
    // uses later has started. Load every declared face (DM Sans 400-700 and
    // Instrument Serif, all self-hosted) so text never renders in a fallback.
    await Promise.all(Array.from(document.fonts).map(face => face.load().catch(() => undefined)));
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => (image.complete ? undefined : image.decode().catch(() => undefined))));
    await Promise.all(
      document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)),
    );
  });
}

/**
 * Regions that legitimately change between runs or machines and are painted
 * over with a solid box in every capture:
 * - running timers and anything that reads the live clock (`[data-visual-mask]`,
 *   `[role="timer"]`);
 * - relative times rendered in `<time>` elements;
 * - avatars loaded from remote URLs (`img` with an http(s) source that is not
 *   same-origin).
 */
export function volatileRegions(page: Page): Locator[] {
  return [
    page.locator('[data-visual-mask], [role="timer"], time'),
    page.locator('img[src^="http"]:not([src^="http://127.0.0.1"])'),
  ];
}

export async function expectScreen(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  await settle(page);
  await expect(page).toHaveScreenshot(name, { fullPage: options.fullPage ?? false, mask: volatileRegions(page) });
}
