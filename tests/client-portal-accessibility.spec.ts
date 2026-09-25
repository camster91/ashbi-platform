import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const viewports = [
  { width: 320, height: 812 },
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

test.describe('Client portal accessibility', () => {
  test('exchanges and removes magic tokens, uses the cookie session, and performs server logout', async ({ page }) => {
    let exchangedToken = '';
    let logoutCalled = false;
    await page.route('**/api/client-portal/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/verify-token')) {
        exchangedToken = request.postDataJSON().token;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { role: 'CLIENT' } }) });
      }
      if (pathname.endsWith('/logout')) {
        logoutCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
      }
      if (pathname.endsWith('/me')) {
        return route.fulfill({
          status: logoutCalled ? 401 : 200,
          contentType: 'application/json',
          body: logoutCalled ? '{"error":"revoked"}' : JSON.stringify({ client: { name: 'Fixture Client' }, contact: { name: 'Fixture Contact' } }),
        });
      }
      if (pathname.endsWith('/projects') || pathname.endsWith('/invoices')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (pathname.endsWith('/retainer')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"recentMessages":0,"upcomingDeadlines":0}' });
    });

    await page.goto('/client-portal/verify?token=one-time-magic-token');
    await expect(page).toHaveURL(/\/client-portal$/);
    await expect(page.getByText('Fixture Client')).toBeVisible();
    expect(exchangedToken).toBe('one-time-magic-token');
    expect(page.url()).not.toContain('token=');

    // The production control's accessible name is its descriptive aria-label
    // ("Log out of client portal"), not the short visible text.
    await page.getByRole('button', { name: 'Log out of client portal' }).click();
    await expect(page.getByRole('button', { name: 'Send Login Link' })).toBeVisible();
    expect(logoutCalled).toBe(true);
  });

  test('shows milestones and contracts and submits auditable revision and project feedback', async ({ page }) => {
    let revisionPayload: Record<string, string> | null = null;
    let projectFeedback = '';
    await page.route('**/api/client-portal/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (pathname.endsWith('/verify-token')) return json({ user: { role: 'CLIENT' } });
      if (pathname.endsWith('/me')) return json({ client: { name: 'Fixture Client' }, contact: { name: 'Fixture Contact' } });
      if (pathname.endsWith('/contracts')) return json([{ id: 'contract-a', title: 'Project agreement', status: 'SENT', signToken: 'sign-a', canReview: true }]);
      if (pathname.endsWith('/projects/project-a/revisions/revision-a/respond')) {
        revisionPayload = request.postDataJSON();
        return json({ id: 'revision-a', roundNumber: 1, status: revisionPayload.action === 'APPROVE' ? 'APPROVED' : 'OPEN' });
      }
      if (pathname.endsWith('/projects/project-a/feedback')) {
        projectFeedback = request.postDataJSON().message;
        return json({ id: 'activity-a' }, 201);
      }
      if (pathname.endsWith('/projects/project-a/tasks')) return json({ columns: { TODO: [], IN_PROGRESS: [], DONE: [], BLOCKED: [] } });
      if (pathname.endsWith('/projects/project-a/documents')) return json([]);
      if (pathname.endsWith('/projects/project-a')) return json({
        id: 'project-a', name: 'Portal Project', status: 'ACTIVE', progressPct: 25,
        milestones: [{ id: 'milestone-a', name: 'Design review', description: 'Review the first design.', dueDate: '2026-08-20T12:00:00.000Z', status: 'IN_PROGRESS' }],
        revisionRounds: [{ id: 'revision-a', roundNumber: 1, status: 'IN_REVIEW', notes: 'Homepage and contact page' }],
      });
      if (pathname.endsWith('/projects')) return json([{ id: 'project-a', name: 'Portal Project', status: 'ACTIVE', updatedAt: '2026-08-09T12:00:00.000Z', totalTasks: 1, completedTasks: 0, progressPct: 0 }]);
      if (pathname.endsWith('/invoices')) return json([]);
      if (pathname.endsWith('/retainer')) return json(null);
      return json({ recentMessages: 0, upcomingDeadlines: 0 });
    });

    await page.goto('/client-portal/verify?token=workflow-token');
    // Portal tabs expose proper tab semantics — address them by their real
    // role and accessible names ("Projects (1)", "Contracts (1)"), not as
    // generic buttons.
    await page.getByRole('tab', { name: 'Projects (1)' }).click();
    await page.getByRole('button', { name: /Portal Project/ }).click();
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
    await expect(page.getByText('Design review')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Revision approvals' })).toBeVisible();

    await page.getByRole('button', { name: 'Request changes' }).click();
    await expect(page.getByRole('alert')).toContainText('Describe the changes');
    await page.getByLabel('Feedback for round 1').fill('Please adjust the homepage hierarchy.');
    await page.getByRole('button', { name: 'Request changes' }).click();
    await expect(page.getByRole('status')).toContainText('Change request sent');
    expect(revisionPayload).toEqual({ action: 'REQUEST_CHANGES', feedback: 'Please adjust the homepage hierarchy.' });

    await page.getByLabel('Message to the project team').fill('The new direction looks good.');
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(page.getByRole('status')).toContainText('feedback was sent');
    expect(projectFeedback).toBe('The new direction looks good.');

    await page.getByRole('tab', { name: 'Contracts (1)' }).click();
    await expect(page.getByRole('link', { name: 'Review and sign' })).toHaveAttribute('href', '/portal/contract/sign-a');
  });

  test('login reflows without overflow at supported breakpoints', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/client-portal');
      await expect(page.getByRole('heading', { name: 'Ashbi Design' })).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(dimensions.scrollWidth, `${viewport.width}px viewport`).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
    }
  });

  test('uses accessible muted text, input boundaries, and keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/client-portal');

    const subtitle = page.getByText('Client Portal', { exact: true });
    const email = page.getByPlaceholder('your@email.com');

    await expect(subtitle).toHaveCSS('color', 'rgb(107, 102, 127)');
    await expect(email).toHaveCSS('border-color', 'rgb(145, 140, 159)');

    await email.focus();
    await expect(email).toBeFocused();
    await expect(email).toHaveCSS('outline-width', '3px');
    await expect(email).toHaveCSS('outline-style', 'solid');
  });

  test('login has no automatically detectable WCAG A or AA violations', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/client-portal');
    await expect(page.getByRole('heading', { name: 'Ashbi Design' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
