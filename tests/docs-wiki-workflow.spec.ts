import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('creates a nested document from a tenant template with authorized mentions', async ({ page }) => {
  let createdPayload: Record<string, unknown> | null = null;
  let notes = [
    { id: 'root-note', title: 'Project home', content: '<img src=x onerror="window.__wikiXss=true"><script>window.__wikiXss=true</script>', type: 'WIKI', tags: [], mentions: [], parentId: null, isTemplate: false, isPinned: false, projectId: 'project-a', updatedAt: '2026-08-09T12:00:00.000Z', author: { name: 'Admin' }, project: { id: 'project-a', name: 'Portal Project', client: { id: 'client-a', name: 'Fixture Client' } } },
  ];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/auth/me') return json({ id: 'user-a', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' });
    if (pathname === '/api/notes' && request.method() === 'GET') return json(notes);
    if (pathname === '/api/notes/templates') return json([{ id: 'template-a', title: 'Launch template', project: { id: 'project-a', name: 'Portal Project' } }]);
    if (pathname === '/api/projects') return json({ projects: [{ id: 'project-a', name: 'Portal Project', client: { name: 'Fixture Client' } }] });
    if (pathname === '/api/team') return json([{ id: 'user-b', name: 'Teammate', isActive: true }]);
    if (pathname === '/api/projects/project-a/notes/from-template/template-a' && request.method() === 'POST') {
      createdPayload = request.postDataJSON();
      notes = [...notes, { ...notes[0], id: 'created-note', title: String(createdPayload.title), parentId: createdPayload.parentId, mentions: createdPayload.mentionUserIds }];
      return json(notes.at(-1), 201);
    }
    if (pathname.startsWith('/api/notifications')) return json({ notifications: [], total: 0 });
    if (pathname.includes('/unread')) return json({ count: 0 });
    return json({});
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/docs');
  await expect(page.getByRole('heading', { name: 'Docs & Notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Project home', exact: true }).click();
  await expect(page.getByText(/<img src=x onerror=/)).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __wikiXss?: boolean }).__wikiXss)).toBeUndefined();
  await page.getByRole('button', { name: 'New Note' }).click();
  await page.getByLabel('Project', { exact: true }).selectOption('project-a');
  await page.getByLabel('Start from template').selectOption('template-a');
  await page.getByLabel('Document title').fill('Nested launch guide');
  await page.getByLabel('Parent document').selectOption('root-note');
  await page.getByLabel('Notify mentioned teammates').selectOption('user-b');
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('button', { name: 'Nested launch guide', exact: true })).toBeVisible();
  expect(createdPayload).toEqual({ title: 'Nested launch guide', parentId: 'root-note', mentionUserIds: ['user-b'] });
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
