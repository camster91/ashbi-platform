import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, role = 'ADMIN') {
  const user = { id: 'qa-human', organizationId: 'qa-org', name: 'QA human', email: 'qa@example.invalid', role };
  const channel = { id: 'qa-channel', kind: 'CLIENT', clientId: 'qa-client', name: 'QA client channel', members: [{ userId: user.id, user: { id: user.id, role, name: user.name } }] };
  const source = { id: 'qa-message', author: { id: user.id, name: user.name }, content: 'Prepare a concise project update.', createdAt: '2026-10-16T12:00:00Z' };
  let binding: null | { id: string; enabled: boolean; revision: number } = null;
  let postCount = 0; let recoveryFound = false; let denied = false;
  const invocation = { id: 'qa-invocation', kind: 'ACCOUNT_MANAGER_DRAFT', scope: 'WORKSPACE_CHANNEL', requestedById: user.id, sourceMessageId: source.id, status: 'SUCCEEDED', deliveryState: 'DELIVERED', response: 'Synthetic saved draft.', profileRevision: 1, bindingId: 'qa-binding', conversationId: 'qa-conversation', runId: 'qa-run', bindingRevision: 2, createdAt: '2026-10-16T12:00:00.000Z', startedAt: '2026-10-16T12:00:01.000Z', finishedAt: '2026-10-16T12:00:02.000Z', deliveredAt: '2026-10-16T12:00:02.000Z', suppressedAt: null, errorCode: null, deliveryCode: null };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname; const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/client-portal/me') return json({ error: 'Unauthorized' }, 401);
    if (path === '/api/auth/me') return json(user);
    if (path === '/api/projects') return json({ projects: [], total: 0 });
    if (path === '/api/time-sessions/running') return json(null);
    if (path === '/api/inbox/stats') return json({ total: 0, unread: 0 });
    if (path === '/api/onboarding/progress') return json({ completed: true, dismissed: true });
    if (path.startsWith('/api/notifications')) return json({ notifications: [], total: 0, count: 0 });
    if (path === '/api/workspace-chat/channels') return json({ items: [channel] });
    if (path === '/api/workspace-chat/people') return json({ items: [user] });
    if (path.endsWith('/messages')) return json(denied ? { error: 'Unavailable' } : { channel, items: [source] }, denied ? 404 : 200);
    if (path.endsWith('/read')) return json({});
    if (path === '/api/client-assistants/qa-client/profile') return json({ id: 'qa-profile', name: 'Synthetic QA manager', enabled: true, pluginIds: ['client-work'] });
    if (path.endsWith('/account-manager')) {
      if (denied) return json({ error: 'Unavailable' }, 404);
      if (method === 'POST') { expect(route.request().postDataJSON()).toEqual({ profileId: 'qa-profile' }); binding = { id: 'qa-binding', enabled: false, revision: 1 }; }
      return json({ binding });
    }
    if (path.endsWith('/account-manager/qa-binding') && method === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ revision: 1, enabled: true }); binding = { id: 'qa-binding', enabled: true, revision: 2 }; return json({ binding });
    }
    if (path.endsWith('/account-manager/requests')) {
      if (denied) return json({ error: 'Unavailable' }, 404);
      if (method === 'POST') { postCount++; expect(route.request().postDataJSON()).toMatchObject({ bindingId: 'qa-binding', sourceMessageId: source.id }); return json({ error: 'Uncertain' }, 503); }
      return json({ items: recoveryFound ? [invocation] : [], nextCursor: null });
    }
    if (path.includes('/requests/by-intent/')) return json(recoveryFound ? { invocation } : { error: 'Not found' }, recoveryFound ? 200 : 404);
    return json({ error: 'Unexpected fixture request' }, 501);
  });
  return { posts: () => postCount, recover: () => { recoveryFound = true; }, revoke: () => { denied = true; }, preinstall: () => { binding = { id: 'qa-binding', enabled: true, revision: 1 }; } };
}
async function openPanel(page: Page) {
  await page.goto('/messages');
  await page.getByRole('button', { name: /QA client channel/ }).click();
  await page.getByText('Channel account manager', { exact: true }).click();
}

test('explicit disabled install and enable, uncertain request recovery survives reload without another POST', async ({ page }) => {
  const state = await fixture(page); await openPanel(page);
  await expect(page.getByText(/configured provider and consume usage/)).toBeVisible();
  await page.getByRole('button', { name: 'Install disabled account manager' }).click();
  await expect(page.getByText('Account manager is disabled.')).toBeVisible(); expect(state.posts()).toBe(0);
  await page.getByRole('button', { name: 'Enable account manager', exact: true }).click();
  await page.getByLabel('Source message for AI draft').selectOption('qa-message');
  await page.getByRole('button', { name: 'Request AI draft', exact: true }).click();
  await expect(page.getByText('The result could not be verified. Refresh access and status before continuing.', { exact: true })).toBeVisible(); expect(state.posts()).toBe(1);
  await page.reload(); await page.getByRole('button', { name: /QA client channel/ }).click(); await page.getByText('Channel account manager', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request AI draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Recover previous request' }).click(); await expect(page.getByText('The result could not be verified. Refresh access and status before continuing.', { exact: true })).toBeVisible(); expect(state.posts()).toBe(1);
  state.recover(); await page.getByRole('button', { name: 'Recover previous request' }).click();
  await expect(page.getByText('Synthetic saved draft.')).toBeVisible(); expect(state.posts()).toBe(1);
});

test('TEAM has no installation controls and a revoked member loses private draft visibility', async ({ page }) => {
  const state = await fixture(page, 'TEAM'); state.preinstall(); state.recover(); await openPanel(page);
  await expect(page.getByText('Synthetic saved draft.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Install disabled|Enable account manager|Disable account manager/ })).toHaveCount(0);
  state.revoke(); await page.getByRole('button', { name: 'Refresh account manager' }).click();
  await expect(page.getByText('Synthetic saved draft.')).toHaveCount(0); expect(state.posts()).toBe(0);
});
