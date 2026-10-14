import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('grouped gallery and table layouts persist without changing task ownership', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const api = page.request;
  const { client, suffix } = await createClientWithContact(api, 'Gallery QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Gallery ${suffix}` } }), 201);
  await json(await api.put(`/api/projects/${project.id}/task-fields`, { data: { revision: 0, fields: [{ key: 'approved', name: 'Approved', type: 'BOOLEAN' }] } }));
  const tasks = [];
  for (const approved of [false, true]) {
    const task = await json(await api.post(`/api/tasks/${project.id}/quick`, { data: { title: `${approved ? 'Approved' : 'Draft'} card ${suffix}` } })); tasks.push(task);
    await json(await api.put(`/api/tasks/${task.id}/fields`, { data: { revision: 0, definitionRevision: 1, values: { approved } } }));
  }
  await page.goto(`/project/${project.id}/views`);
  await page.getByLabel('Task view layout').selectOption('GALLERY');
  await page.getByLabel('Task view grouping').selectOption('FIELD:approved');
  await expect(page.getByRole('heading', { name: 'No (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yes (1)', exact: true })).toBeVisible();
  await page.getByLabel('Task view name').fill('Approval gallery');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Task gallery' })).toBeVisible();
  await expect(page.getByLabel('Task view grouping')).toHaveValue('FIELD:approved');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const audit = await new AxeBuilder({ page }).include('[aria-label="Task gallery"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.getByLabel('Task view layout').selectOption('TABLE');
  await expect(page.getByRole('rowheader', { name: 'No (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save view changes' }).click();
  await page.reload();
  await expect(page.getByRole('table')).toBeVisible();
  expect((await json(await api.get(`/api/tasks/${tasks[0].id}/page`))).assigneeId).toBe(tasks[0].assigneeId);
});
