import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAuthenticatedApi, mockPortalReviewApi, portalReviewToken, unmockedRequests } from './fixtures/authenticated-api';

// Media review (#417, docs/media-review.md): the staff review page and the
// public client page behind a share link, scanned with axe and driven with
// the keyboard only.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page, screen: string) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)),
  ));
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(violation => ({
    id: violation.id,
    help: violation.help,
    nodes: violation.nodes.slice(0, 8).map(node => ({ target: node.target.join(' '), html: node.html.slice(0, 160) })),
  }));
  expect(summary, `${screen} has WCAG A/AA violations`).toEqual([]);
}

test.describe('Media review accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.afterEach(({ page }) => {
    expect(unmockedRequests(page), 'API requests with no fixture; add them to tests/fixtures/authenticated-api.ts').toEqual([]);
  });

  test.skip(({ browserName }) => browserName !== 'chromium', 'Axe rule results are engine-independent; scan on Chromium desktop and Pixel 5.');

  test('the client review page is axe-clean and fully operable by keyboard', async ({ page }) => {
    const state = await mockPortalReviewApi(page);
    await page.goto(`/portal/review/${portalReviewToken}`);
    await expect(page.getByRole('heading', { name: 'Homepage draft', level: 1 })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Reviewed image: homepage-draft.png' })).toBeVisible();
    await expectNoAxeViolations(page, 'client review page');

    // The pin and its list entry are the same comment.
    const pin = page.getByRole('button', { name: 'Comment 1 by Cameron Admin, pinned at 40% across, 25% down' });
    await pin.focus();
    await page.keyboard.press('Enter');
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('li[aria-labelledby="annotation-annotation-a-heading"]')).toBeFocused();

    // Pin a new comment to a point with the keyboard only.
    await page.getByRole('textbox', { name: 'Your name' }).fill('Dana Rivera');
    await page.getByRole('checkbox', { name: 'Pin this comment to a point on the image' }).focus();
    await page.keyboard.press('Space');
    const across = page.getByRole('spinbutton', { name: 'Across (% from left)' });
    await across.focus();
    await page.keyboard.press('ArrowUp');
    await page.getByRole('textbox', { name: 'Comment' }).fill('Tighten the spacing here.');
    await page.getByRole('button', { name: 'Add comment' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Comment added.' })).toBeAttached();
    await expect(page.getByText('Tighten the spacing here.')).toBeVisible();
    expect(state.posted[0]).toEqual({ name: 'Dana Rivera', body: 'Tighten the spacing here.', region: { x: 0.51, y: 0.5, w: 0, h: 0 } });
    await expectNoAxeViolations(page, 'client review page after commenting');

    await page.getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Approval recorded.' })).toBeAttached();
    expect(state.posted[1]).toEqual({ name: 'Dana Rivera', decision: 'approved' });
  });

  test('the staff review page share-link controls are axe-clean', async ({ page }) => {
    await mockAuthenticatedApi(page);
    await page.goto('/review/review-a');
    await expect(page.getByRole('heading', { name: 'Homepage draft', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke Dana review' }).click();
    await expect(page.getByRole('dialog', { name: 'Revoke share link?' })).toBeVisible();
    await expectNoAxeViolations(page, 'staff review revoke confirmation');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reply to comment 1' }).click();
    await expect(page.getByRole('textbox', { name: 'Reply to Cameron Admin' })).toBeFocused();
    await expectNoAxeViolations(page, 'staff review reply form');
  });
});
