import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockAuthenticatedApi, mockClientPortalApi, unmockedRequests } from './fixtures/authenticated-api';

// Issue #305: keyboard-only journeys through the signed-in app and the CLIENT
// portal. Every step is driven with Tab / Shift+Tab / Enter / Escape and typed
// text — never pointer clicks — and checks that the focused control shows a
// visible focus indicator, that dialogs trap focus, and that Escape returns
// focus to the control that opened the dialog.

test.skip(
  ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
  'Keyboard journeys target the desktop layout. WebKit does not Tab to links by default, and touch layouts are covered by mobile-navigation.spec.ts.',
);

test.afterEach(({ page }) => {
  expect(unmockedRequests(page), 'API requests with no fixture; add them to tests/fixtures/authenticated-api.ts').toEqual([]);
});

async function isFocused(locator: Locator) {
  return locator.evaluate(element => element === document.activeElement).catch(() => false);
}

type FocusState = { html: string; box: boolean; indicator: boolean; focusVisible: boolean };

/** Describes the focused element: is it on screen, and does it draw an outline or ring? */
async function activeFocus(page: Page): Promise<FocusState | null> {
  return page.evaluate(async () => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    // Let focus-ring transitions (e.g. `transition: all`) settle before reading styles.
    await Promise.race([
      Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 500)),
    ]);
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      html: element.outerHTML.slice(0, 400),
      box: rect.width > 1 && rect.height > 1,
      indicator: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none',
      focusVisible: element.matches(':focus-visible'),
    };
  });
}

/**
 * Presses Tab (or Shift+Tab) until `target` holds focus, like a keyboard user
 * would, and requires every stop on the way to be visibly focused (2.4.7).
 */
async function tabTo(page: Page, target: Locator, { backwards = false, max = 120 } = {}) {
  const invisibleStops: string[] = [];
  for (let presses = 0; presses < max; presses += 1) {
    if (await isFocused(target)) {
      expect(invisibleStops, `Tab stops without a visible focus indicator on the way to ${target}`).toEqual([]);
      return;
    }
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const focus = await activeFocus(page);
    if (focus && !(focus.box && focus.indicator && focus.focusVisible)) invisibleStops.push(focus.html);
  }
  const active = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200));
  throw new Error(`Could not reach ${target} with the keyboard; focus is on ${active}`);
}

/** The focused element must draw a visible indicator: an outline or a ring (box-shadow). */
async function expectVisibleFocus(target: Locator) {
  await expect(target).toBeFocused();
  const focus = await activeFocus(target.page());
  expect(focus, 'focus was lost').not.toBeNull();
  expect(focus!.focusVisible, `keyboard focus should match :focus-visible: ${focus!.html}`).toBe(true);
  expect(focus!.box && focus!.indicator, `focused control has no visible focus indicator: ${focus!.html}`).toBe(true);
}

/** Tabbing forwards and backwards from inside `dialog` must never leave it. */
async function expectFocusTrapped(page: Page, dialog: Locator) {
  const focusables = await dialog.evaluate(element => element.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ).length);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let presses = 0; presses < focusables + 2; presses += 1) {
      await page.keyboard.press(key);
      expect(
        await dialog.evaluate(element => element.contains(document.activeElement)),
        `${key} moved focus outside the dialog`,
      ).toBe(true);
    }
  }
}

test('staff user signs in, navigates, uses dialogs and creates a note with the keyboard only', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await mockAuthenticatedApi(page, { signedIn: false });
  await page.goto('/login');

  // Sign in.
  const email = page.getByLabel('Email');
  await tabTo(page, email);
  await expectVisibleFocus(email);
  await page.keyboard.type('admin@example.com');
  const password = page.getByLabel('Password', { exact: true });
  await tabTo(page, password);
  await page.keyboard.type('correct horse battery staple');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Cameron/, level: 1 })).toBeVisible();

  // The skip link is the first stop, becomes visible on focus and moves
  // focus past the navigation into the main content.
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await expectVisibleFocus(skipLink);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  // Reach the project through the primary navigation.
  await page.keyboard.press('Shift+Tab');
  const projectsNav = page.getByRole('navigation').getByRole('link', { name: 'Projects', exact: true });
  await tabTo(page, projectsNav, { backwards: true });
  await expectVisibleFocus(projectsNav);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
  const projectCard = page.locator('#main-content').getByRole('link', { name: /Website Redesign/ });
  await tabTo(page, projectCard);
  await expectVisibleFocus(projectCard);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/project\/project-a$/);
  await expect(page.getByRole('heading', { name: 'Website Redesign', level: 1 })).toBeVisible();

  // Open a modal, type in it, check the focus trap, close with Escape.
  const draftUpdate = page.getByRole('button', { name: 'Draft project update' });
  await tabTo(page, draftUpdate);
  await expectVisibleFocus(draftUpdate);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Draft client update' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const notes = dialog.getByLabel('Raw notes / talking points');
  await tabTo(page, notes);
  await page.keyboard.type('Homepage approved');
  // Typing re-renders the page; focus must stay in the field being edited.
  await expect(notes).toBeFocused();
  await expect(notes).toHaveValue('Homepage approved');
  await expectFocusTrapped(page, dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(draftUpdate).toBeFocused();

  // Create a project note.
  const newNote = page.getByRole('button', { name: 'Create new note' });
  await tabTo(page, newNote);
  await expectVisibleFocus(newNote);
  await page.keyboard.press('Enter');
  const noteForm = page.getByRole('form', { name: 'New note' });
  const title = noteForm.getByLabel('Note title');
  await tabTo(page, title);
  await expectVisibleFocus(title);
  await page.keyboard.type('Launch checklist');
  const noteType = noteForm.getByLabel('Note type');
  await tabTo(page, noteType);
  await expectVisibleFocus(noteType);
  const content = noteForm.getByLabel('Note content');
  await tabTo(page, content);
  await page.keyboard.type('Confirm DNS cut-over time with the client.');
  const save = noteForm.getByRole('button', { name: 'Save', exact: true });
  await tabTo(page, save);
  await expectVisibleFocus(save);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Expand note Launch checklist' })).toBeVisible();
  expect(api.createdNotes).toEqual([
    expect.objectContaining({ title: 'Launch checklist', content: 'Confirm DNS cut-over time with the client.', type: 'NOTE' }),
  ]);
});

test('client contact navigates portal tabs, uploads, chats and cancels a delete with the keyboard only', async ({ page }) => {
  test.setTimeout(90_000);
  const portal = await mockClientPortalApi(page);
  await page.goto('/client-portal/verify?token=portal-keyboard-token');
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

  // Tabs.
  const documentsTab = page.getByRole('tab', { name: 'Documents' });
  await tabTo(page, documentsTab);
  await expectVisibleFocus(documentsTab);
  await page.keyboard.press('Enter');
  await expect(documentsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('brand-guidelines.pdf')).toBeVisible();

  // Upload through the keyboard-operable upload button.
  const upload = page.getByRole('button', { name: /Drop files here or click to upload/ });
  await tabTo(page, upload);
  await expectVisibleFocus(upload);
  const fileChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await fileChooser).setFiles({ name: 'uploaded-brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Project brief') });
  await expect(page.getByText('uploaded-brief.txt')).toBeVisible();
  expect(portal.uploads).toBe(1);

  // Delete confirmation: focus moves into the dialog, is trapped there, and
  // Escape cancels and returns focus to the delete button.
  const deleteButton = page.getByRole('button', { name: 'Delete brand-guidelines.pdf' });
  await tabTo(page, deleteButton, { backwards: true });
  await expectVisibleFocus(deleteButton);
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Delete document?' });
  await expect(confirm).toBeVisible();
  await expect.poll(() => confirm.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expectFocusTrapped(page, confirm);
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(deleteButton).toBeFocused();
  expect(portal.deleted).toEqual([]);

  // Confirming with the keyboard deletes the document.
  await page.keyboard.press('Enter');
  await expect(confirm).toBeVisible();
  const permanentlyDelete = confirm.getByRole('button', { name: 'Permanently delete' });
  await tabTo(page, permanentlyDelete);
  await expectVisibleFocus(permanentlyDelete);
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(page.getByText('brand-guidelines.pdf')).toHaveCount(0);
  expect(portal.deleted).toEqual(['document-a']);

  // Chat.
  const chatTab = page.getByRole('tab', { name: 'Chat' });
  await tabTo(page, chatTab, { backwards: true });
  await expectVisibleFocus(chatTab);
  await page.keyboard.press('Enter');
  await expect(chatTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Homepage draft is ready for review.')).toBeVisible();
  const message = page.getByRole('textbox', { name: 'Message to project team' });
  await tabTo(page, message);
  await expectVisibleFocus(message);
  await page.keyboard.type('Looks great, approved!');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Looks great, approved!')).toBeVisible();
  await expect(message).toHaveValue('');
});
