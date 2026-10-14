import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('task contributors persist through reload and appear in participant reads', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const api = page.request;
  const team = await json(await api.get('/api/team'));
  const member = team.find((user: any) => user.role === 'ADMIN' && user.isActive !== false);
  expect(member).toBeTruthy();
  const { client, suffix } = await createClientWithContact(api, 'Collaboration QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Collaboration ${suffix}` } }), 201);
  const task = await json(await api.post(`/api/tasks/${project.id}/quick`, { data: { title: `Shared contribution ${suffix}` } }));
  await page.goto(`/task/${task.id}`);
  const panel = page.getByRole('region', { name: 'Task collaborators' });
  await panel.getByRole('checkbox', { name: member.name, exact: true }).check();
  await panel.getByRole('button', { name: 'Save collaborators' }).click();
  await expect(panel.getByRole('button', { name: 'Save collaborators' })).toBeDisabled();
  await page.reload();
  await expect(panel.getByRole('checkbox', { name: member.name, exact: true })).toBeChecked();
  const persisted = await json(await api.get(`/api/tasks/${task.id}/collaborators`));
  expect(persisted.collaborators.some((user: any) => user.id === member.id)).toBe(true);
  expect(persisted.ownerId).toBe(task.assigneeId);
  const mine = await json(await api.get('/api/tasks/my'));
  expect(Object.values(mine).flat().some((row: any) => row.id === task.id)).toBe(true);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const audit = await new AxeBuilder({ page }).include('[aria-label="Task collaborators"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
  }
});
