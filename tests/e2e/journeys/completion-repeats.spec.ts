import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('completion recurrence configuration persists and completion is stamped through the task API', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const api = page.request;
  const { client, suffix } = await createClientWithContact(api, 'Completion repeat QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Completion repeat ${suffix}` } }), 201);
  const task = await json(await api.post(`/api/tasks/${project.id}/quick`, { data: { title: `Finish then repeat ${suffix}` } }));
  await page.goto(`/task/${task.id}`);
  const panel = page.getByRole('region', { name: 'Task recurrence' });
  await panel.getByRole('button', { name: 'Configure recurrence' }).click();
  await panel.getByLabel('Repeat trigger').selectOption('AFTER_COMPLETION');
  await panel.getByLabel('Repeat interval').fill('2');
  await panel.getByLabel('Repeat frequency').selectOption('WEEKLY');
  await panel.getByRole('button', { name: 'Save recurrence' }).click();
  await expect(panel.getByText(/Repeats 2 weeks after each task’s first completion/)).toBeVisible();
  await page.reload();
  await expect(panel.getByText(/Repeats 2 weeks after each task’s first completion/)).toBeVisible();
  const configured = await json(await api.get(`/api/tasks/${task.id}/page`));
  expect(configured.recurrenceRule.trigger).toBe('AFTER_COMPLETION');
  expect(configured.recurrenceNextDate).toBeNull();
  await json(await api.put(`/api/tasks/${task.id}`, { data: { status: 'COMPLETED' } }));
  const completed = await json(await api.get(`/api/tasks/${task.id}/page`));
  expect(completed.recurrenceFirstCompletedAt).toBeTruthy();
  await json(await api.put(`/api/tasks/${task.id}`, { data: { status: 'PENDING' } }));
  await json(await api.post(`/api/tasks/${task.id}/complete`));
  expect((await json(await api.get(`/api/tasks/${task.id}/page`))).recurrenceFirstCompletedAt).toBe(completed.recurrenceFirstCompletedAt);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).include('[aria-label="Task recurrence"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  // The test stack does not run the scheduled worker. Persisted generation,
  // concurrent claims and contributor copies are covered in PostgreSQL tests.
});
