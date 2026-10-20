import { expect, test } from '@playwright/test';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('document and timesheet portfolios persist without changing canonical records', async ({ page }) => {
  await loginAdminThroughUi(page);
  const admin = page.request;
  const { client, suffix } = await createClientWithContact(admin, 'Portfolio documents QA');
  const projects = [];
  for (const portfolio of ['ASHBI_DESIGN', 'FREELANCE']) {
    const project = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `${portfolio} ${suffix}`, portfolio } }), 201);
    projects.push(project);
    await json(await admin.post(`/api/projects/${project.id}/notes`, { data: { title: `${portfolio} brief ${suffix}`, content: 'Synthetic QA content', type: 'DOC' } }), 201);
    await json(await admin.post('/api/time-entries', { data: { projectId: project.id, duration: 30, billable: true, description: `${portfolio} time ${suffix}`, date: new Date().toISOString() } }), 201);
  }
  await page.goto('/docs?portfolio=FREELANCE');
  await expect(page.getByRole('button', { name: `Toggle note FREELANCE brief ${suffix}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Toggle note ASHBI_DESIGN brief ${suffix}` })).toHaveCount(0);
  await page.getByLabel('Work portfolio').selectOption('ASHBI_DESIGN');
  await page.reload();
  await expect(page.getByLabel('Work portfolio')).toHaveValue('ASHBI_DESIGN');
  await expect(page.getByRole('button', { name: `Toggle note ASHBI_DESIGN brief ${suffix}` })).toBeVisible();
  await page.goto('/timesheets?portfolio=FREELANCE');
  await expect(page.getByRole('heading', { name: /^Time .*week$/, level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Work portfolio')).toHaveValue('FREELANCE');
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const time = await json(await admin.get(`/api/time-entries/summary?portfolio=FREELANCE&startDate=${encodeURIComponent(weekStart.toISOString())}`));
  expect(time.byProject.some((row: any) => row.project.id === projects[1].id)).toBe(true);
  expect(time.byProject.some((row: any) => row.project.id === projects[0].id)).toBe(false);
  expect((await json(await admin.get(`/api/projects/${projects[1].id}`))).clientId).toBe(client.id);
});
