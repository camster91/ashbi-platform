import { expect, test } from '@playwright/test';
import { mockAuthenticatedApi } from './fixtures/authenticated-api';

test('saved views and calendar controls reflow without page-wide horizontal scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedApi(page);
  await page.route('**/api/projects/project-a/task-views', route => route.fulfill({ json: {
    projectId: 'project-a', projectName: 'Agency project', views: [{ key: 'review', name: 'Client review queue', layout: 'CALENDAR', sort: 'TITLE', filters: {} }], revision: 0, stages: [], fields: [],
  } }));
  await page.route('**/api/tasks?*', route => route.fulfill({ json: { tasks: [{ id: 't1', title: 'Review artwork', status: 'REVIEW', dueDate: '2030-01-31T00:00:00Z' }], pagination: { pages: 1 } } }));
  await page.goto('/project/project-a/views?view=review');
  await page.getByLabel('Calendar month').fill('2030-01');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('region', { name: 'Task calendar', exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: globalThis.innerWidth, scroll: globalThis.document.documentElement.scrollWidth,
      offenders: [...globalThis.document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > globalThis.innerWidth + 1).map(element => ({ tag: element.tagName, label: element.getAttribute('aria-label'), classes: element.className })).slice(0, 10),
    }));
    expect(dimensions.scroll, JSON.stringify(dimensions)).toBeLessThanOrEqual(width);
  }
});
