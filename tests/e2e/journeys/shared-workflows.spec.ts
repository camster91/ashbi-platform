// Authenticated persistence journey against the disposable full-stack CI environment.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('shared portfolios, stages, recurrence and saved task views persist through the real UI and API', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const admin = page.request;
  const { client, suffix } = await createClientWithContact(admin, 'Shared workflow QA');
  const agency = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `Agency ${suffix}`, portfolio: 'ASHBI_DESIGN' } }), 201);
  const freelance = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `Freelance ${suffix}`, portfolio: 'FREELANCE' } }), 201);
  const task = await json(await admin.post(`/api/tasks/${agency.id}/quick`, { data: { title: `Review ${suffix}` } }));

  await test.step('portfolio filters retain shared canonical projects', async () => {
    await page.goto('/projects?portfolio=FREELANCE');
    await expect(page.getByRole('link', { name: new RegExp(freelance.name) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(agency.name) })).toHaveCount(0);
    await page.getByLabel('Work portfolio').selectOption('ASHBI_DESIGN');
    await expect(page.getByRole('link', { name: new RegExp(agency.name) })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Work portfolio')).toHaveValue('ASHBI_DESIGN');
    await expect(page.getByRole('link', { name: new RegExp(freelance.name) })).toHaveCount(0);
  });

  await test.step('stage editing, movement and occupied-stage recovery persist', async () => {
    await page.goto(`/project/${agency.id}/kanban`);
    await page.getByRole('button', { name: 'Configure stages' }).click();
    await page.getByLabel('Stage 3 name').fill('Client review');
    await page.getByRole('button', { name: 'Save stages' }).click();
    await expect(page.getByRole('form', { name: 'Task stage settings' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Client review' })).toBeVisible();
    await page.getByLabel(`Move "${task.title}" to column`).selectOption({ label: 'Client review' });
    await expect.poll(async () => (await json(await admin.get(`/api/tasks/${task.id}/page`))).stageKey).toBe('review');
    expect((await json(await admin.get(`/api/tasks/${task.id}/page`))).status).toBe('REVIEW');
    await page.getByRole('button', { name: 'Configure stages' }).click();
    await page.getByRole('button', { name: 'Remove Client review' }).click();
    await page.getByRole('button', { name: 'Save stages' }).click();
    await expect(page.getByRole('form', { name: 'Task stage settings' }).getByRole('alert')).toContainText('Move tasks out of removed stages');
    expect((await json(await admin.get(`/api/projects/${agency.id}`))).taskStages.some((stage: any) => stage.key === 'review')).toBe(true);
    await page.getByRole('button', { name: 'Reload board settings' }).click();
    await expect(page.getByRole('form', { name: 'Task stage settings' })).toHaveCount(0);
  });

  await test.step('monthly recurrence saves and reloads, then stops without deleting the task', async () => {
    await page.goto(`/task/${task.id}`);
    await page.getByRole('button', { name: 'Configure recurrence' }).click();
    await page.getByLabel('Repeat frequency').selectOption('MONTHLY');
    await page.getByLabel('Repeat interval').fill('1');
    await page.getByLabel('First repeat due date').fill('2030-01-31');
    await page.getByLabel('Recurrence timezone').fill('America/Toronto');
    await page.getByRole('button', { name: 'Save recurrence' }).click();
    await expect(page.getByRole('form', { name: 'Recurring task settings' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Task recurrence' })).toContainText('Next due 2030-01-31');
    const saved = await json(await admin.get(`/api/tasks/${task.id}/page`));
    expect(saved.recurrenceRule).toEqual({ frequency: 'MONTHLY', interval: 1, startDate: '2030-01-31', timeZone: 'America/Toronto' });
    await page.getByRole('button', { name: 'Configure recurrence' }).click();
    await page.getByRole('button', { name: 'Stop repeating' }).click();
    await expect(page.getByRole('region', { name: 'Task recurrence' })).toContainText('Does not repeat');
    const stopped = await json(await admin.get(`/api/tasks/${task.id}/page`));
    expect(stopped.recurrenceNextDate).toBeNull();
    expect(stopped.status).toBe('REVIEW');
  });

  await test.step('a filtered saved view survives reload and deletion preserves its records', async () => {
    await page.goto(`/project/${agency.id}/views`);
    await page.getByLabel('View status filter').selectOption('REVIEW');
    await page.getByLabel('Task view name').fill('Client review queue');
    await page.getByRole('button', { name: 'Save as new view' }).click();
    await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('View status filter')).toHaveValue('REVIEW');
    await expect(page.getByRole('table').getByRole('link', { name: task.title, exact: true })).toBeVisible();
    const saved = await json(await admin.get(`/api/projects/${agency.id}/task-views`));
    expect(saved.views[0].name).toBe('Client review queue');
    await json(await admin.put(`/api/tasks/${task.id}`, { data: { dueDate: '2030-01-31T00:00:00.000Z' } }));
    await page.getByLabel('Task view layout').selectOption('CALENDAR');
    await page.getByRole('button', { name: 'Save view changes' }).click();
    await expect.poll(async () => (await json(await admin.get(`/api/projects/${agency.id}/task-views`))).views[0].layout).toBe('CALENDAR');
    await page.reload();
    await expect(page.getByLabel('Task view layout')).toHaveValue('CALENDAR');
    await page.getByLabel('Calendar month').fill('2030-01');
    await expect(page.getByRole('region', { name: /Thursday, Jan 31, 2030/ }).getByRole('link', { name: task.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('region', { name: 'Task calendar', exact: true })).toContainText('1 dated tasks in other months');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('region', { name: /Thursday, Jan 31, 2030/ }).getByRole('link', { name: task.title, exact: true })).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const calendar = page.getByRole('region', { name: 'Task calendar', exact: true });
      await expect(calendar.getByRole('link', { name: task.title, exact: true })).toBeVisible();
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
      const accessibility = await new AxeBuilder({ page }).include('[aria-label="Task calendar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(accessibility.violations).toEqual([]);
      await test.info().attach(`task-calendar-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    await page.getByRole('button', { name: 'Delete view' }).click();
    await expect(page.getByLabel('Saved task view')).toHaveValue('');
    expect((await json(await admin.get(`/api/tasks/${task.id}/page`))).id).toBe(task.id);
  });
});
