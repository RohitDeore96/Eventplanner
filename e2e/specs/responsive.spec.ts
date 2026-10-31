import { expect, test, type Page } from '@playwright/test';

/**
 * Test J (Phase 3, Milestone 4): representative workflows at the tablet size between the
 * desktop and mobile profiles. The full suite already runs desktop (1280) and mobile
 * (Pixel 7); this spec repeats a core walk at 768×1024 and asserts the WCAG reflow
 * invariant: no unintended horizontal page scroll, and dialogs/forms stay operable.
 */

const FUTURE_DATE = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 120);
  return date.toISOString().slice(0, 10);
})();

async function noHorizontalPageScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth - overflow.clientWidth,
    `${label}: page must not scroll horizontally at tablet size`,
  ).toBeLessThanOrEqual(1);
}

test.describe('Responsive behavior: tablet walk (768×1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('create, budget, vendor, run sheet and dialog all work at tablet size', async ({ page }) => {
    // The viewport is overridden explicitly here, so a single project run suffices.
    test.skip(test.info().project.name !== 'desktop', 'tablet viewport is explicit');
    await page.goto('/');
    await noHorizontalPageScroll(page, 'setup');

    await page.getByLabel('Event name').fill('Tablet walk wedding');
    await page.getByLabel('Currency').selectOption('INR');
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await page.getByLabel('Expected guests').fill('150');
    await page.getByLabel(/Total budget in/).fill('800000');
    await page.getByRole('button', { name: 'Create the plan' }).click();
    await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await noHorizontalPageScroll(page, 'budget');

    await page.getByRole('tab', { name: 'Vendors' }).click();
    await page.getByLabel('Vendor name').fill('Sharma Caterers');
    await page.getByLabel('Status').selectOption('booked');
    await page.getByLabel('Agreed price (only for booked)').fill('400000');
    await page.getByRole('button', { name: 'Add vendor' }).click();
    await expect(page.getByRole('heading', { name: 'Sharma Caterers' })).toBeVisible();
    await noHorizontalPageScroll(page, 'vendors');

    await page.getByRole('tab', { name: 'Run sheet' }).click();
    await page.getByRole('textbox', { name: 'Activity' }).fill('Baraat assembly');
    await page.getByLabel('Start', { exact: true }).fill('09:00');
    await page.getByRole('button', { name: 'Add activity' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Baraat assembly' })).toBeVisible();
    await noHorizontalPageScroll(page, 'run sheet');

    // A destructive-action confirmation stays reachable and operable at tablet size.
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete every saved event' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep my events' }).click();
    // Keeping the events means the plan is untouched and the walk continues where it was.
    await expect(page.getByRole('tab', { name: 'Run sheet' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
