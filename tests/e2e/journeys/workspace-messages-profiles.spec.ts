import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('staff profile settings and workspace messages persist through UI writes', async ({ page }) => {
  await loginAdminThroughUi(page);
  const api = page.request;
  const { client, suffix } = await createClientWithContact(api, 'Account manager settings');
  await page.goto(`/clients/${client.id}`);
  await page.getByText('Account manager', { exact: true }).click();
  await page.getByText('Account manager settings', { exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(`Manager ${suffix}`);
  await page.getByLabel('Client instructions', { exact: true }).fill('Keep updates concise.');
  const profileSaved = page.waitForResponse(response => response.request().method() === 'PATCH' &&
    new URL(response.url()).pathname === `/api/client-assistants/${client.id}/profile`);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  expect((await profileSaved).status()).toBe(200);
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  const storedProfile = await json(await api.get(`/api/client-assistants/${client.id}/profile`));
  expect(storedProfile.name).toBe(`Manager ${suffix}`);
  expect(storedProfile.instructions).toBe('Keep updates concise.');
  expect(storedProfile.portalEnabled).toBe(false);
  await page.reload();
  await page.getByText('Account manager', { exact: true }).click();
  await page.getByText('Account manager settings', { exact: true }).click();
  await expect(page.getByLabel('Agent name', { exact: true })).toHaveValue(`Manager ${suffix}`);

  const name = `Team QA ${suffix}`;
  const { channel } = await json(await api.post('/api/workspace-chat/channels', {
    data: { kind: 'COMPANY', name, memberIds: [] },
  }));
  await page.goto('/messages');
  await page.getByRole('button', { name, exact: true }).click();
  const content = `Persisted team update ${suffix}`;
  await page.getByLabel('Message', { exact: true }).fill(content);
  const messageSaved = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/workspace-chat/channels/${channel.id}/messages`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await messageSaved).status()).toBe(200);
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  const history = await json(await api.get(`/api/workspace-chat/channels/${channel.id}/messages`));
  expect(history.items.filter(item => item.content === content)).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
});
