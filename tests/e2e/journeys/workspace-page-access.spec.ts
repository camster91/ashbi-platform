import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { json, loginAdminThroughUi } from './support';

test('knowledge audience edits persist, retain revisions and remain usable on mobile', async ({ page }) => {
  await loginAdminThroughUi(page);
  const api = page.request, title = `Private handbook ${Date.now()}`;
  await page.goto('/wiki');
  await page.getByLabel('Page title', { exact: true }).fill(title);
  await page.getByLabel('Page content', { exact: true }).fill('Restricted staff knowledge');
  await page.getByLabel('Initial audience').selectOption('RESTRICTED');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const id = page.url().split('/').at(-1);
  const access = page.getByRole('region', { name: 'Knowledge page access' });
  await expect(access.getByLabel('Audience', { exact: true })).toHaveValue('RESTRICTED');
  const initial = await json(await api.get(`/api/wiki/pages/${id}/access`));
  const staffName = `Knowledge reader ${Date.now()}`, staffEmail = `${randomUUID()}@e2e.example.test`, staffPassword = randomUUID();
  const reader = await json(await api.post('/api/team', { data: { name: staffName, email: staffEmail, password: staffPassword, role: 'TEAM' } }), 201);
  await access.getByLabel('Search teammates', { exact: true }).fill(staffName);
  await expect(access.getByLabel('Teammate', { exact: true })).toContainText(staffName);
  await access.getByLabel('Teammate', { exact: true }).selectOption(reader.id);
  await access.getByRole('button', { name: 'Add reader' }).click();
  await access.getByRole('button', { name: 'Save page access' }).click();
  await expect.poll(async () => (await json(await api.get(`/api/wiki/pages/${id}/access`))).members.some((member: any) => member.userId === reader.id && member.role === 'READ')).toBe(true);
  const viewerContext = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const signedIn = await viewerContext.request.post('/api/auth/login', { data: { email: staffEmail, password: staffPassword } });
    expect(signedIn.status()).toBe(200);
    const viewer = await viewerContext.newPage();
    await viewer.goto(`/wiki/${id}`);
    await expect(viewer.getByText('This page is read only.', { exact: true })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Edit page', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'Knowledge page access' })).toHaveCount(0);
    const viewed = await json(await viewerContext.request.get(`/api/wiki/pages/${id}`));
    expect((await viewerContext.request.put(`/api/wiki/pages/${id}`, { data: { revision: viewed.revision, content: 'Reader overwrite' } })).status()).toBe(403);
  } finally { await viewerContext.close(); }
  await access.getByLabel('Audience', { exact: true }).selectOption('TEAM');
  await access.getByRole('button', { name: 'Save page access' }).click();
  await expect(access.getByRole('button', { name: 'Save page access' })).toBeDisabled();
  await expect.poll(async () => (await json(await api.get(`/api/wiki/pages/${id}/access`))).mode).toBe('TEAM');
  await page.reload();
  await expect(access.getByLabel('Audience', { exact: true })).toHaveValue('TEAM');
  const current = await json(await api.get(`/api/wiki/pages/${id}/access`));
  expect(current.revision).toBeGreaterThan(initial.revision);
  await access.getByLabel('Audience', { exact: true }).selectOption('RESTRICTED');
  await json(await api.put(`/api/wiki/pages/${id}/access`, { data: { revision: current.revision, mode: 'TEAM', members: [] } }));
  await access.getByRole('button', { name: 'Save page access' }).click();
  await expect(access.getByRole('alert').filter({ hasText: 'Page access changed' })).toBeVisible();
  await expect(access.getByLabel('Audience', { exact: true })).toHaveValue('RESTRICTED');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await access.getByRole('button', { name: 'Reload access and discard draft' }).click();
  await expect(access.getByLabel('Audience', { exact: true })).toHaveValue('TEAM');
});
