import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAuthenticatedApi, mockClientPortalApi, unmockedRequests } from './fixtures/authenticated-api';

test.afterEach(({ page }) => expect(unmockedRequests(page)).toEqual([]));

for (const target of [{ entityType: 'PROJECT', entityId: 'project-a', path: '/project/project-a' }, { entityType: 'TASK', entityId: 'task-a', path: '/task/task-a' }]) {
  test(`${target.entityType} resources retain exact URLs and default to internal sharing`, async ({ page }) => {
    await page.routeWebSocket('**/*', socket => socket.close());
    await mockAuthenticatedApi(page);
    const items: Record<string, unknown>[] = target.entityType === 'PROJECT'
      ? [{ id: 'resource-existing', entityType: 'PROJECT', entityId: 'project-a', title: 'Existing brief', url: 'https://example.com/existing', clientVisible: false, position: 0, revision: 4, canEdit: true, archivedAt: null }]
      : [];
    const submitted: Record<string, unknown>[] = [];
    const edits: Record<string, unknown>[] = [];
    await page.route('**/api/resource-links?*', route => {
      const query = new URL(route.request().url()).searchParams;
      expect(route.request().method()).toBe('GET');
      expect(query.get('entityType')).toBe(target.entityType);
      expect(query.get('entityId')).toBe(target.entityId);
      return route.fulfill({ json: { items, nextCursor: null } });
    });
    await page.route('**/api/resource-links', route => {
      expect(route.request().method()).toBe('POST');
      const body = route.request().postDataJSON(); submitted.push(body);
      const row = { ...body, id: 'resource-a', position: 0, revision: 1, canEdit: true, archivedAt: null };
      if (submitted.length === 1) items.push(row);
      if (target.entityType === 'PROJECT' && submitted.length === 1) return route.abort('failed');
      if (target.entityType === 'PROJECT' && submitted.length === 2) return route.fulfill({ status: 403, json: { error: 'Access temporarily unavailable' } });
      return route.fulfill({ status: 201, json: row });
    });
    await page.route('**/api/resource-links/resource-existing', route => {
      expect(target.entityType).toBe('PROJECT');
      expect(route.request().method()).toBe('PATCH');
      const body = route.request().postDataJSON(); edits.push(body);
      expect(body).toEqual({ title: 'Updated existing brief', url: 'https://example.com/existing', clientVisible: false, expectedRevision: 4 });
      Object.assign(items[0], body, { revision: 5 });
      return route.fulfill({ json: items[0] });
    });
    await page.goto(target.path);
    const panel = page.getByRole('region', { name: 'Resources', exact: true });
    await panel.getByRole('button', { name: 'Add resource', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add resource', exact: true });
    await dialog.getByLabel('Resource title', { exact: true }).fill('Brief <draft>');
    await dialog.getByLabel('Resource URL', { exact: true }).fill('https://example.com/brief?revision=1&view=team#notes');
    await expect(dialog.getByLabel('Share with client portal')).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Save resource', exact: true }).click();
    if (target.entityType === 'PROJECT') {
      // A committed response can be lost, then its retry denied. Unrelated
      // editing must not discard or replace the unresolved creation intent.
      await expect(dialog.getByLabel('Resource title', { exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Retry exact creation' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Creation outcome is unknown');
      expect(submitted).toHaveLength(2);
      expect(submitted[1]).toEqual(submitted[0]);
      await dialog.getByRole('button', { name: 'Defer unresolved creation' }).click();
      await expect(panel.getByRole('button', { name: 'Add resource', exact: true })).toBeDisabled();
      await panel.getByRole('button', { name: 'Edit Existing brief', exact: true }).click();
      const editDialog = page.getByRole('dialog', { name: 'Edit resource', exact: true });
      await editDialog.getByLabel('Resource title', { exact: true }).fill('Updated existing brief');
      await editDialog.getByRole('button', { name: 'Save resource', exact: true }).click();
      await expect(panel.getByRole('link', { name: 'Updated existing brief (opens in new tab)', exact: true })).toBeVisible();
      expect(edits).toHaveLength(1);
      await expect(panel.getByRole('button', { name: 'Add resource', exact: true })).toBeDisabled();
      await panel.getByRole('button', { name: 'Resume exact creation' }).click();
      await expect(dialog.getByLabel('Resource title', { exact: true })).toHaveValue('Brief <draft>');
      await expect(dialog.getByLabel('Resource URL', { exact: true })).toHaveValue('https://example.com/brief?revision=1&view=team#notes');
      await dialog.getByRole('button', { name: 'Retry exact creation' }).click();
      await expect.poll(() => submitted.length).toBe(3);
      expect(submitted[2]).toEqual(submitted[0]);
    }
    await expect(panel.getByRole('link', { name: 'Brief <draft> (opens in new tab)', exact: true })).toHaveAttribute('href', 'https://example.com/brief?revision=1&view=team#notes');
    await expect(panel.getByText('Internal only', { exact: true })).toHaveCount(target.entityType === 'PROJECT' ? 2 : 1);
    expect(submitted).toHaveLength(target.entityType === 'PROJECT' ? 3 : 1);
    expect(submitted[0]).toEqual({ entityType: target.entityType, entityId: target.entityId, title: 'Brief <draft>', url: 'https://example.com/brief?revision=1&view=team#notes', clientVisible: false, createIntentId: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
  });
}

test('client project renders only minimal shared resource DTOs with no mutation controls', async ({ page }) => {
  await page.routeWebSocket('**/*', socket => socket.close());
  await mockClientPortalApi(page);
  const shared = { id: 'resource-shared', title: 'Approved client brief', url: 'https://example.com/client?version=2#brief', position: 0, updatedAt: '2026-10-16T10:00:00Z' };
  const resources = [shared, ...Array.from({ length: 649 }, (_, index) => ({ ...shared, id: `shared-${index}`, title: `Shared reference ${index + 1}`, position: index + 1 }))];
  const reads: (string | null)[] = [];
  let failNextPage = true;
  await page.route('**/api/client-portal/projects/project-a/resource-links?*', route => {
    expect(route.request().method()).toBe('GET');
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('limit')).toBe('100');
    const after = query.get('after'); reads.push(after);
    if (after === 'page-100' && failNextPage) {
      failNextPage = false;
      return route.fulfill({ status: 503, json: { error: 'Page temporarily unavailable' } });
    }
    expect(after === null || after === 'page-100').toBe(true);
    const offset = after ? 100 : 0;
    return route.fulfill({ json: { items: resources.slice(offset, offset + 100), nextCursor: `page-${offset + 100}` } });
  });
  await page.goto('/client-portal/verify?token=resource-fixture-token');
  await page.getByRole('tab', { name: 'Projects (1)' }).click();
  await page.getByRole('button', { name: /Website Redesign/ }).click();
  const panel = page.getByRole('region', { name: 'Resources', exact: true });
  const link = panel.getByRole('link', { name: 'Approved client brief (opens in new tab)' });
  await expect(link).toHaveAttribute('href', shared.url);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(panel.getByRole('button', { name: /Add|Edit|Archive|Restore|Move/ })).toHaveCount(0);
  // StrictMode may repeat the initial effect, but must never follow its cursor.
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(after => after === null)).toBe(true);
  await expect(panel.getByRole('link')).toHaveCount(100);
  await panel.getByRole('button', { name: 'Load more resources', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('link')).toHaveCount(100);
  await panel.getByRole('button', { name: 'Retry loading more resources', exact: true }).click();
  await expect(panel.getByRole('link')).toHaveCount(200);
  expect(reads.filter(after => after !== null)).toEqual(['page-100', 'page-100']);
  await expect(panel.getByRole('button', { name: 'Load more resources', exact: true })).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = await new AxeBuilder({ page }).include('section[aria-labelledby]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});
