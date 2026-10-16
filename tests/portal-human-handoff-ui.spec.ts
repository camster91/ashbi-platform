import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

for (const width of [1280, 390]) {
  test(`human team request recovers after reload at ${width}px without replaying a POST`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.routeWebSocket('**/*', socket => socket.close());
    let posts = 0;
    let key = '';
    const requests: Record<string, unknown>[] = [];
    const project = { id: 'p1', name: 'Website refresh', status: 'IN_PROGRESS', progressPct: 20, milestones: [], revisions: [], feedback: [] };
    // Serve the actual installed font assets when local worktrees share a
    // read-only dependency junction outside Vite's application allow-list.
    await page.route('**/*.woff2', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.includes('/@fs/') && !pathname.includes('/node_modules/')) return route.continue();
      const family = pathname.includes('instrument-serif') ? 'instrument-serif' : 'dm-sans';
      const directory = path.dirname(require.resolve(`@fontsource/${family}/400.css`, { paths: [path.resolve('web')] }));
      return route.fulfill({ path: path.join(directory, 'files', path.basename(pathname)), contentType: 'font/woff2' });
    });
    await page.route('**/socket.io/**', route => route.abort());
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;
      const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (pathname === '/api/client-portal/me') return fulfill({ client: { name: 'Synthetic Client' }, contact: { name: 'Portal Contact' }, brand: { companyName: 'Ashbi QA' }, handoffIdentity: { organizationId: 'org1', userId: 'portal1', contactId: 'contact1' } });
      if (pathname === '/api/client-portal/projects') return fulfill([project]);
      if (pathname === '/api/client-portal/projects/p1') return fulfill(project);
      if (pathname === '/api/client-portal/projects/p1/tasks') return fulfill({ columns: {} });
      if (pathname === '/api/client-portal/projects/p1/resource-links' && request.method() === 'GET') return fulfill({ items: [], nextCursor: null });
      if (pathname.includes('/account-manager-requests/by-intent/')) {
        expect(pathname.endsWith(key)).toBe(true);
        return fulfill({ request: requests[0] });
      }
      if (pathname.endsWith('/account-manager-requests')) {
        if (request.method() === 'POST') {
          posts += 1;
          const body = request.postDataJSON(); key = body.idempotencyKey;
          const persisted = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('portal-team-request:')).map(key => JSON.parse(localStorage.getItem(key)!)));
          expect(persisted).toEqual([{ key, status: 'PREPARED' }]);
          requests.push({ id: 'r1', projectId: 'p1', question: body.question, status: 'PENDING', createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z' });
          // Simulate a committed submission whose response was lost.
          return route.abort('failed');
        }
        return fulfill({ items: requests, nextCursor: null });
      }
      if (pathname === '/api/client-portal/retainer') return fulfill(null);
      if (pathname === '/api/client-portal/unread-count') return fulfill({ recentMessages: 0, upcomingDeadlines: 0 });
      if (pathname.endsWith('/documents') || pathname.endsWith('/messages') || pathname.endsWith('/invoices') || pathname.endsWith('/contracts')) return fulfill([]);
      return fulfill({ error: 'Unmocked request' }, 401);
    });

    const openProject = async (expandFollowup = true) => {
      await page.getByRole('tab', { name: /Projects/ }).click();
      await page.getByRole('button', { name: 'Open project Website refresh' }).click();
      await expect(page.getByText('Request human follow-up', { exact: true })).toBeVisible();
      if (expandFollowup) {
        await expect(page.getByLabel('Your question', { exact: true })).toHaveCount(0);
        await page.getByText('Request human follow-up', { exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: 'Ask the team', exact: true })).toBeVisible();
    };
    await page.goto('/client-portal'); await openProject();
    await page.getByLabel('Your question', { exact: true }).fill('Please review <b>my question</b>');
    await page.getByRole('button', { name: 'Send question to the team' }).click();
    await expect(page.getByRole('button', { name: 'Check submission status' })).toBeVisible();
    expect(posts).toBe(1);
    await page.reload(); await openProject(false);
    await expect(page.getByLabel('Your question', { exact: true })).toBeDisabled();
    await expect(page.getByText('Please review <b>my question</b>', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check submission status' }).click();
    await expect(page.getByText('Your request is saved for the team. You can follow its status below.')).toBeVisible();
    await expect(page.getByLabel('Your question', { exact: true })).toBeEnabled();
    expect(posts).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('b').count()).toBe(0);
    const labelledBy = await page.getByRole('region', { name: 'Ask the team', exact: true }).getAttribute('aria-labelledby');
    const violations = (await new AxeBuilder({ page }).include(`section[aria-labelledby="${labelledBy}"]`).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations;
    expect(violations).toEqual([]);
    await page.getByLabel('Your question', { exact: true }).focus();
    await expect(page.getByLabel('Your question', { exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('portal-team-request.png'), fullPage: true });
    await page.getByText('Request human follow-up', { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('portal-follow-up-collapsed.png'), fullPage: true });
  });
}
