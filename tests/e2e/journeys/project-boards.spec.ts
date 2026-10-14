import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('additional board creation, task membership and saved views persist in the canonical project', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const api = page.request;
  const { client, suffix } = await createClientWithContact(api, 'Boards QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Boards ${suffix}` } }), 201);
  await page.goto(`/project/${project.id}/boards`);
  await page.getByLabel('Board name', { exact: true }).fill(`Delivery ${suffix}`);
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Delivery ${suffix}`, exact: true })).toBeVisible();
  const boards = await json(await api.get(`/api/projects/${project.id}/boards`));
  const board = boards.items.find((row: any) => !row.isDefault);
  const task = await json(await api.post(`/api/tasks/${project.id}/quick`, { data: { title: `Movable ${suffix}`, boardId: 'DEFAULT' } }));
  expect(task.boardId).toBeNull();
  await page.goto(`/task/${task.id}`);
  await page.getByLabel('Destination board').selectOption(board.id);
  const committedMove = page.waitForResponse(response => response.url().endsWith(`/api/tasks/${task.id}/board`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Move to board', exact: true }).click();
  const moved = await committedMove;
  expect(moved.status()).toBe(200);
  expect((await moved.json()).boardId).toBe(board.id);
  await expect(page.getByRole('button', { name: 'Move to board', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Destination board')).toHaveValue(board.id);
  const stored = await json(await api.get(`/api/tasks/${task.id}/page`));
  expect(stored.projectId).toBe(project.id); expect(stored.assigneeId).toBe(task.assigneeId);
  expect((await json(await api.get(`/api/tasks/kanban/${project.id}`))).PENDING.some((row: any) => row.id === task.id)).toBe(false);
  await page.goto(`/project/${project.id}/views?board=${board.id}`);
  await expect(page.getByRole('link', { name: `Movable ${suffix}`, exact: true })).toBeVisible();
  await page.getByLabel('Task view name').fill('Delivery view');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Task view name')).toHaveValue('Delivery view');
  await page.goto(`/project/${project.id}/boards`);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});
