// Authenticated persistence journey against the disposable full-stack CI environment.
import { expect, test } from '@playwright/test';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('shared portfolios, named stages and recurrence persist through the real UI and API', async ({ page }) => {
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
});
