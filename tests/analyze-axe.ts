import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Playwright 1.65 Firefox crashes during axe-core evaluate() on documents that
 * contain an aria-labelledby region (https://github.com/microsoft/playwright/issues/44135).
 * Chromium and WebKit still run the audit. Returns null when the Firefox scan is skipped.
 */
export async function analyzeAxe(
  page: Page,
  configure?: (builder: AxeBuilder) => AxeBuilder,
): Promise<{ violations: unknown[] } | null> {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName === 'firefox' && (await page.locator('[aria-labelledby]').count()) > 0) {
    return null;
  }
  const builder = configure
    ? configure(new AxeBuilder({ page }))
    : new AxeBuilder({ page }).withTags([...WCAG_TAGS]);
  return builder.analyze();
}
