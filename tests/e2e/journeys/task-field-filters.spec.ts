import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('typed field filters and named relations persist in saved views', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const admin = page.request;
  const { client, suffix } = await createClientWithContact(admin, 'Field filter QA');
  const project = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `Filtered tasks ${suffix}` } }), 201);
  await json(await admin.put(`/api/projects/${project.id}/task-fields`, { data: { revision: 0, fields: [
    { key: 'estimate', name: 'Estimate', type: 'NUMBER' }, { key: 'approved', name: 'Approved', type: 'BOOLEAN' },
    { key: 'services', name: 'Services', type: 'MULTI_SELECT', options: ['Design', 'Build'] }, { key: 'client', name: 'Related client', type: 'RELATION', target: 'CLIENT' },
  ] } }));
  const tasks = [];
  for (const matches of [true, false]) {
    const task = await json(await admin.post(`/api/tasks/${project.id}/quick`, { data: { title: `${matches ? 'Match' : 'Other'} ${suffix}` } })); tasks.push(task);
    await json(await admin.put(`/api/tasks/${task.id}/fields`, { data: { revision: 0, definitionRevision: 1, values: { estimate: matches ? 0 : 10, approved: !matches, services: [matches ? 'Design' : 'Build'], client: client.id } } }));
  }
  await page.goto(`/project/${project.id}/views`);
  for (const [index, key] of ['estimate', 'approved', 'services', 'client'].entries()) {
    await page.getByRole('button', { name: 'Add field filter' }).click();
    await page.getByLabel(`Field filter ${index + 1} field`).selectOption(key);
  }
  await page.getByLabel('Search field filter 4 relations').fill(client.name);
  await expect(page.getByRole('option', { name: client.name, exact: true })).toBeAttached();
  await page.getByLabel('Field filter 4 value').selectOption(client.id);
  await page.getByLabel('Task view name').fill('Zero estimate design');
  await expect(page.getByRole('button', { name: 'Save as new view' })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply field filters' }).click();
  await expect(page.getByRole('link', { name: tasks[0].title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: tasks[1].title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Field filter 2 value')).toHaveValue('false');
  await expect(page.getByRole('link', { name: tasks[1].title, exact: true })).toHaveCount(0);
  const saved = await json(await admin.get(`/api/projects/${project.id}/task-views`));
  expect(saved.views[0].filters.fieldFilters).toContainEqual({ key: 'estimate', operator: 'EQ', value: 0 });
  expect(saved.views[0].filters.fieldFilters).toContainEqual({ key: 'approved', operator: 'EQ', value: false });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const result = await new AxeBuilder({ page }).include('[aria-label="Custom field filters"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});
