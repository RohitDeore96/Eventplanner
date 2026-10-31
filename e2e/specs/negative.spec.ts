import { expect, test, type Page } from '@playwright/test';

/**
 * Negative and adversarial browser tests (Phase 3, Milestone 4 §8.4): over-budget
 * visibility, malformed AI responses, rapid successive actions, navigation away with
 * pending changes, and the guest RSVP/plus-one/catering workflow that Test E requires.
 */

const FUTURE_DATE = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 120);
  return date.toISOString().slice(0, 10);
})();

async function createPlan(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Negative-path wedding');
  await page.getByLabel('Currency').selectOption('INR');
  await page.getByLabel('Event date').fill(FUTURE_DATE);
  await page.getByLabel('Expected guests').fill('120');
  await page.getByLabel(/Total budget in/).fill('800000');
  await page.getByRole('button', { name: 'Create the plan' }).click();
  await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
}

test.describe('Negative testing', () => {
  test('over-allocating a category is allowed but never silent', async ({ page }) => {
    await createPlan(page);
    // Set one allocation far above its share: planned total exceeds the budget.
    const allocSection = page.locator('section[aria-labelledby="editalloc-title"]');
    const venueRow = allocSection.getByRole('row').filter({ hasText: 'Venue' }).first();
    await venueRow.getByLabel(/Allocation for Venue in/).fill('900000');
    await venueRow.getByRole('button', { name: 'Set', exact: true }).click();
    await expect(
      page.getByText(/exceed the budget by|exceeds the budget by/i).first(),
    ).toBeVisible();
    // The stored plan is consistent and the over-allocation is engine-computed, not hidden.
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    const parsed = JSON.parse(stored ?? '{}') as {
      plans: { budgetMinor: number; categories: { plannedMinor: number }[] }[];
    };
    const planned = parsed.plans[0]?.categories.reduce((a, c) => a + c.plannedMinor, 0) ?? 0;
    expect(planned).toBeGreaterThan(parsed.plans[0]?.budgetMinor ?? 0);
  });

  test('a malformed AI response is rejected and nothing is invented', async ({ page }) => {
    await createPlan(page);
    // The patch endpoint answers with a body that violates the client schema.
    await page.route('**/api/propose-patch**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"summary":"Add a task","actions":"not-an-array"}',
      }),
    );
    await page.getByRole('tab', { name: 'Assistant' }).click();
    await page.getByLabel('What would you like to change?').fill('Add a sangeet task');
    await page.getByRole('button', { name: 'Suggest changes' }).click();
    // The client-side schema validation refuses the body; the notice is honest.
    await expect(
      page.getByText(/service is unavailable|could not be applied|offline/i),
    ).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    expect(stored).not.toContain('sangeet');
  });

  test('rapid successive actions all land and keep storage consistent', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Guests' }).click();
    for (const name of ['Aman', 'Bina', 'Chetan']) {
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Add guest' }).click();
    }
    await expect(page.getByRole('row').filter({ hasText: 'Aman' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Chetan' })).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    const parsed = JSON.parse(stored ?? '{}') as { plans: { guests: { name: string }[] }[] };
    const names = parsed.plans[0]?.guests.map((g) => g.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['Aman', 'Bina', 'Chetan']));
  });

  test('navigation away during pending changes: applied work autosaves, the form is not lost silently', async ({
    page,
  }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Vendors' }).click();
    await page.getByLabel('Vendor name').fill('Kumar Decor');
    await page.getByLabel('Status').selectOption('booked');
    await page.getByLabel('Agreed price (only for booked)').fill('120000');
    // Submit (applies), then immediately navigate away, then reload.
    await page.getByRole('button', { name: 'Add vendor' }).click();
    await expect(page.getByRole('heading', { name: 'Kumar Decor' })).toBeVisible();
    await page.getByRole('tab', { name: 'Guests' }).click();
    await page.reload();
    await page.getByRole('tab', { name: 'Vendors' }).click();
    await expect(page.getByRole('heading', { name: 'Kumar Decor' })).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    expect(stored).toContain('Kumar Decor');
  });

  test('guest RSVP, plus-ones and the catering summary stay in step (Test E)', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Guests' }).click();
    // Guest 1: added pending, edited to confirmed with a plus-one and a dietary need.
    await page.getByLabel('Name', { exact: true }).fill('Meera');
    await page.getByRole('button', { name: 'Add guest' }).click();
    const meeraRow = page.getByRole('row').filter({ hasText: 'Meera' });
    await meeraRow.getByRole('button', { name: 'Edit' }).click();
    const meeraForm = page.getByRole('form', { name: 'Edit Meera' });
    await meeraForm.getByLabel('RSVP').selectOption({ label: 'Coming' });
    await meeraForm.getByLabel('Plus-ones').fill('2');
    await meeraForm.getByRole('checkbox', { name: 'Vegan' }).check();
    await meeraForm.getByRole('button', { name: 'Save', exact: true }).click();
    // Guest 2: added pending, then edited to declined.
    await page.getByLabel('Name', { exact: true }).fill('Rahul');
    await page.getByRole('button', { name: 'Add guest' }).click();
    const rahulRow = page.getByRole('row').filter({ hasText: 'Rahul' });
    await rahulRow.getByRole('button', { name: 'Edit' }).click();
    const rahulForm = page.getByRole('form', { name: 'Edit Rahul' });
    await rahulForm.getByLabel('RSVP').selectOption({ label: 'Not coming' });
    await rahulForm.getByRole('button', { name: 'Save', exact: true }).click();
    // Catering follows the confirmed count: Meera (1) + plus-ones (2) = 3.
    const cateringSection = page
      .locator('section')
      .filter({ hasText: 'Catering requirement' })
      .first();
    await expect(cateringSection).toContainText('3 people to cater for');
    // Filter shows the state without colour-only signalling.
    await page.getByLabel('RSVP', { exact: true }).selectOption({ label: 'Not coming' });
    await expect(page.getByRole('row').filter({ hasText: 'Rahul' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Meera' })).toBeHidden();
    // Reload: everything survives.
    await page.reload();
    await page.getByRole('tab', { name: 'Guests' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Meera' })).toContainText('Vegan');
  });
});
