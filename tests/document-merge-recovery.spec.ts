import { expect, test, type BrowserContext } from '@playwright/test';

test('two independent editors explicitly reconcile after reconnect, reject a third edit and retain a revoked local draft', async ({ browser, baseURL }) => {
  // Synthetic transport with an actual observed-revision comparison, not a
  // database concurrency claim. No request can reach a provider or live API.
  let note = { id: 'qa-note', projectId: 'qa-project', title: 'QA shared document', content: 'Original', type: 'DOC', tags: ['original'], mentions: [], parentId: null, isTemplate: false, revision: 0, updatedAt: '2026-10-16T12:00:00Z', permissions: { canEdit: true, canManage: true }, project: { id: 'qa-project', name: 'QA project' } };
  const posts: { actor: string; revision: number; content: string }[] = [];
  let offlineA = false, revokedA = false;
  const contexts: BrowserContext[] = [];
  async function editor(actor: string) {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });contexts.push(context);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());if (url.origin !== new URL(baseURL!).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname, method = route.request().method();
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/client-portal/me') return json({ error: 'Unauthorized' }, 401);
      if (path === '/api/auth/me') return json({ id: actor, organizationId: 'qa-org', name: actor, email: `${actor}@example.invalid`, role: 'ADMIN' });
      if (path === '/api/projects') return json({ projects: [note.project], total: 1 });
      if (path === '/api/team' || path === '/api/notes/templates') return json([]);
      if (path === '/api/time-sessions/running') return json(null);
      if (path === '/api/inbox/stats') return json({ total: 0, unread: 0 });
      if (path === '/api/onboarding/progress') return json({ completed: true, dismissed: true });
      if (path.startsWith('/api/notifications')) return json({ notifications: [], total: 0, count: 0 });
      if (path === '/api/notes' || path === '/api/notes/qa-note') {
        if (actor === 'editor-a' && offlineA) return route.abort('internetdisconnected');
        if (actor === 'editor-a' && revokedA) return json({ error: 'Document unavailable' }, 404);
        if (path === '/api/notes') return json({ notes: [note], pagination: { page: 1, pages: 1 } });
        if (method === 'GET') return json(note);
        if (method === 'PUT') {
          const data = route.request().postDataJSON();posts.push({ actor, revision: data.revision, content: data.content });
          if (data.revision !== note.revision) return json({ error: 'Document changed since you started editing. Your draft has not been saved.' }, 409);
          note = { ...note, ...data, revision: note.revision + 1 };return json(note);
        }
      }
      return json({ error: 'Unexpected synthetic request' }, 501);
    });
    const page = await context.newPage();await page.goto('/docs');await page.getByRole('button', { name: `Edit ${note.title}`, exact: true }).click();return page;
  }
  try {
    const a = await editor('editor-a'), b = await editor('editor-b');
    const content = (page: typeof a) => page.getByLabel('Edit QA shared document content', { exact: true });
    await content(a).fill('A local change');await content(b).fill('B saved change');await b.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => note.revision).toBe(1);await expect(content(b)).toHaveCount(0);
    await a.getByRole('button', { name: 'Save', exact: true }).click();await expect(a.getByRole('region', { name: 'Document save recovery' })).toBeVisible();
    offlineA = true;await a.getByRole('button', { name: 'Compare latest saved document' }).click();await expect(a.getByText(/could not be reloaded/)).toBeVisible();await expect(content(a)).toHaveValue('A local change');
    offlineA = false;await a.getByRole('button', { name: 'Compare latest saved document' }).click();await expect(a.getByText('B saved change', { exact: true })).toBeVisible();
    await a.getByLabel('Reviewed merged content').fill('A and B reviewed merge');const before = posts.length;
    await a.getByRole('button', { name: 'Use reviewed merge in editor' }).click();expect(posts).toHaveLength(before);await expect(content(a)).toHaveValue('A and B reviewed merge');
    // Offline feedback remains until dismissed and can cover mobile controls.
    const dismiss = a.getByRole('button', { name: 'Dismiss notification', exact: true });
    while (await dismiss.count()) await dismiss.first().click();
    await b.getByRole('button', { name: 'Edit QA shared document', exact: true }).click();await content(b).fill('B third change');await b.getByRole('button', { name: 'Save', exact: true }).click();await expect.poll(() => note.revision).toBe(2);
    await a.getByRole('button', { name: 'Save', exact: true }).click();await expect(a.getByRole('region', { name: 'Document save recovery' })).toBeVisible();expect(posts.at(-1)).toMatchObject({ actor: 'editor-a', revision: 1 });await expect(content(a)).toHaveValue('A and B reviewed merge');
    await a.getByRole('button', { name: 'Compare latest saved document' }).click();await expect(a.getByText('B third change', { exact: true })).toBeVisible();
    revokedA = true;await a.getByRole('button', { name: 'Compare latest saved document' }).click();await expect(a.getByText(/could not be reloaded/)).toBeVisible();await expect(a.getByRole('region', { name: 'Review document merge' })).toHaveCount(0);
    await expect(content(a)).toHaveValue('A and B reviewed merge');await expect(a.getByRole('button', { name: 'Download draft' })).toBeEnabled();expect(note.content).toBe('B third change');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
