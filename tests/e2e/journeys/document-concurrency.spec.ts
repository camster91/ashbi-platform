import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('concurrent document changes reject a stale draft, preserve it and allow an explicit reviewed retry', async ({ page }) => {
  await loginAdminThroughUi(page);
  const api = page.request;
  const { client, suffix } = await createClientWithContact(api, 'Document concurrency QA');
  const project = await json(await api.post('/api/projects', { data: { clientId: client.id, name: `Docs ${suffix}` } }), 201);
  const title = `Concurrency guide ${suffix}`;
  const note = await json(await api.post(`/api/projects/${project.id}/notes`, { data: { title, type: 'DOC', content: 'Original' } }), 201);
  await page.goto('/docs');
  await page.getByPlaceholder('Search notes...').fill(title);
  await page.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await page.getByLabel(`Edit ${title} content`, { exact: true }).fill('My pending draft');
  await json(await api.put(`/api/notes/${note.id}`, { data: { revision: note.revision, content: 'Teammate update' } }));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Document changed since you started editing' })).toBeVisible();
  await expect(page.getByLabel(`Edit ${title} content`, { exact: true })).toHaveValue('My pending draft');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download draft' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('document-draft.json');
  const draftPath = await download.path();
  expect(draftPath).not.toBeNull();
  const draft = JSON.parse(await readFile(draftPath!, 'utf8'));
  expect(draft.content).toBe('My pending draft'); expect(draft.revision).toBe(note.revision);
  expect((await json(await api.get(`/api/notes/${note.id}`))).content).toBe('Teammate update');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.getByRole('button', { name: 'Reload document and discard draft' }).click();
  await expect(page.getByLabel(`Edit ${title} content`, { exact: true })).toHaveValue('Teammate update');
  await page.getByLabel(`Edit ${title} content`, { exact: true }).fill('Reviewed merge');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel(`Edit ${title} content`, { exact: true })).not.toBeVisible();
  await page.reload();
  expect((await json(await api.get(`/api/notes/${note.id}`))).content).toBe('Reviewed merge');
});
