import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { json, loginAdminThroughUi } from './support';

test('team knowledge works without projects, persists nested edits and reversibly archives pages', async ({ page }) => {
  await loginAdminThroughUi(page);
  const api = page.request, title = `Workspace handbook ${Date.now()}`;
  await page.goto('/wiki');
  await page.getByLabel('Page title', { exact: true }).fill(title);
  await page.getByLabel('Page content', { exact: true }).fill('# Shared knowledge\n\n<script>alert("unsafe")</script>');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const rootId = page.url().split('/').at(-1);
  const root = await json(await api.get(`/api/wiki/pages/${rootId}`));
  expect(root.projectId).toBeUndefined(); expect(root.clientId).toBeUndefined();
  await expect(page.getByRole('region', { name: 'Knowledge page content' }).locator('script')).toHaveCount(0);
  await page.getByRole('link', { name: 'Create nested page' }).click();
  await page.getByLabel('Page title', { exact: true }).fill(`Nested ${title}`);
  await page.getByLabel('Page content', { exact: true }).fill('Nested guide');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Nested ${title}`, exact: true })).toBeVisible();
  const childId = page.url().split('/').at(-1);
  await page.getByRole('button', { name: 'Edit page', exact: true }).click();
  await page.getByLabel('Page content', { exact: true }).fill('Persisted team edit');
  await page.getByRole('button', { name: 'Save page', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Knowledge page content' })).toContainText('Persisted team edit');
  await page.reload();
  expect((await json(await api.get(`/api/wiki/pages/${childId}`))).parentId).toBe(rootId);
  await page.goto(`/wiki/${rootId}`);
  await page.getByRole('button', { name: 'Archive page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore and edit page' })).toBeVisible();
  expect((await json(await api.get(`/api/wiki/pages/${childId}`))).parentId).toBeNull();
  await page.getByRole('button', { name: 'Restore and edit page' }).click();
  await page.getByRole('button', { name: 'Restore and save page' }).click();
  await expect(page.getByRole('button', { name: 'Edit page', exact: true })).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});
