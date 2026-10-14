import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('canonical client grouping persists with named table and gallery headers', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const api = page.request;
  const { client, suffix } = await createClientWithContact(api, 'Relation grouping QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Relation grouping ${suffix}` } }), 201);
  await json(await api.put(`/api/projects/${project.id}/task-fields`, { data: { revision: 0, fields: [{ key: 'client', name: 'Related client', type: 'RELATION', target: 'CLIENT' }] } }));
  const task = await json(await api.post(`/api/tasks/${project.id}/quick`, { data: { title: `Named relationship ${suffix}` } }));
  await json(await api.put(`/api/tasks/${task.id}/fields`, { data: { revision: 0, definitionRevision: 1, values: { client: client.id } } }));
  await page.goto(`/project/${project.id}/views`);
  await page.getByLabel('Task view layout').selectOption('GALLERY');
  await page.getByLabel('Task view grouping').selectOption('FIELD:client');
  await expect(page.getByRole('heading', { name: `${client.name} (1)`, exact: true })).toBeVisible();
  await page.getByLabel('Task view name').fill('By canonical client');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: `${client.name} (1)`, exact: true })).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).include('[aria-label="Task gallery"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.getByLabel('Task view layout').selectOption('TABLE');
  await expect(page.getByRole('rowheader', { name: `${client.name} (1)`, exact: true })).toBeVisible();
  expect((await json(await api.get(`/api/tasks/${task.id}/page`))).assigneeId).toBe(task.assigneeId);
});
