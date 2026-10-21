import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('team workload distinguishes canonical owner and contributor work after reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const api = page.request;
  const team = await json(await api.get('/api/team'));
  const member = team.find((user: any) => user.role === 'ADMIN' && user.isActive !== false);
  const baseline = (await json(await api.get('/api/team/workload'))).find((row: any) => row.id === member.id);
  const { client, suffix } = await createClientWithContact(api, 'Workload QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Workload ${suffix}` } }), 201);
  const task = await json(await api.post(`/api/tasks/${project.id}/quick`, { data: { title: `Owned and contributed ${suffix}` } }));
  await json(await api.put(`/api/tasks/${task.id}`, { data: { assigneeId: member.id } }));
  await json(await api.put(`/api/tasks/${task.id}/collaborators`, { data: { revision: 0, userIds: [member.id] } }));
  const current = (await json(await api.get('/api/team/workload'))).find((row: any) => row.id === member.id);
  expect(current.activeTasks).toBe(baseline.activeTasks + 1);
  expect(current.contributedTasks).toBe(baseline.contributedTasks + 1);
  expect(current.weeklyCapacityHours).toBe(member.capacity / 100 * 40);
  await page.goto('/team');
  const region = page.getByRole('region', { name: 'Team workload' });
  await expect(region.getByText(`${current.activeTasks} owned tasks · ${current.contributedTasks} contributions`, { exact: true })).toBeVisible();
  await page.reload();
  await expect(region.getByText(`${current.activeTasks} owned tasks · ${current.contributedTasks} contributions`, { exact: true })).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const audit = await new AxeBuilder({ page }).include('[aria-label="Team workload"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
  }
});

test('profile percentage capacity preserves zero and updates weekly workload hours', async ({ page }) => {
  await loginAdminThroughUi(page);
  const api = page.request;
  const original = await json(await api.get('/api/auth/me'));
  try {
    await json(await api.put('/api/auth/me', { data: { capacity: 0 } }));
    await page.goto('/settings?section=profile');
    const capacity = page.getByLabel('Capacity (%)', { exact: true });
    await expect(capacity).toHaveValue('0');
    await capacity.fill('50');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/auth/me') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(capacity).toHaveValue('50');
    const workload = await json(await api.get('/api/team/workload'));
    expect(workload.find((row: any) => row.id === original.id).weeklyCapacityHours).toBe(20);
  } finally {
    await json(await api.put('/api/auth/me', { data: { capacity: original.capacity } }));
  }
});
