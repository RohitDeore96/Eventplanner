import { expect, test, type Page } from '@playwright/test';

/**
 * Core journeys against the production build. The AI endpoints are mocked so the journeys
 * are deterministic and cost nothing; the built-in fallback path is exercised too.
 */

const FUTURE_DATE = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 120);
  return date.toISOString().slice(0, 10);
})();

async function mockAi(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const json = (body: unknown): Promise<void> => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    };
    if (url.includes('parse-intake')) {
      return json({
        name: 'Asha and Dev wedding',
        occasion: 'wedding',
        dateISO: null,
        guests: 150,
        budgetMinor: 80_000_000,
        notes: null,
        source: 'built-in',
      });
    }
    if (url.includes('propose-patch')) {
      return json({
        summary: 'Add a haldi task',
        actions: [
          {
            type: 'task/add',
            id: 'e2e-haldi',
            title: 'Haldi at home',
            dueISO: FUTURE_DATE,
            dependsOn: [],
            assignee: null,
          },
        ],
        source: 'built-in',
      });
    }
    if (url.includes('review-plan')) {
      return json({
        summary: 'Plan looks reasonable.',
        nextSteps: ['Book the caterer.'],
        source: 'built-in',
      });
    }
    if (url.includes('suggest-ideas')) {
      return json({
        themes: ['Marigold evening'],
        activities: ['Sangeet night'],
        foodStyle: ['Live chaat'],
        personalTouches: ['Photo wall'],
        source: 'built-in',
      });
    }
    return json({ error: 'NOT_MOCKED' });
  });
}

async function submit(page: Page, buttonName: string): Promise<void> {
  const form = page.getByRole('button', { name: buttonName }).locator('xpath=ancestor::form[1]');
  await form.evaluate((element) => {
    (element as HTMLFormElement).requestSubmit();
  });
}

async function createPlan(page: Page, budget = '800000'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Asha and Dev wedding');
  await page.getByLabel('Event date').fill(FUTURE_DATE);
  await page.getByLabel('Expected guests').fill('150');
  await page.getByLabel(/Total budget in/).fill(budget);
  await submit(page, 'Create the plan');
  await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
}

test.describe('Journey 1: create an event from a description', () => {
  test('intake fills the form, the plan is created and persisted', async ({ page }) => {
    await mockAi(page);
    await page.goto('/');
    await page
      .getByLabel(/For example: "Shaadi in Pune/)
      .fill('Shaadi in Pune, 150 guests, 8 lakh budget');
    await page.getByRole('button', { name: 'Fill form from description' }).click();
    await expect(page.getByText(/Filled wedding/)).toBeVisible();
    await expect(page.getByLabel('Expected guests')).toHaveValue('150');
    // 8 lakh = 800000 major rupees in the form; the stored budget is 80,000,000 paise.
    await expect(page.getByLabel(/Total budget in/)).toHaveValue('800000');
    // The description had no date, so the family types it (the form is the source of truth).
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await submit(page, 'Create the plan');
    await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    expect(stored).toContain('"budgetMinor":80000000');
  });
});

test.describe('Journey 2: financial integrity', () => {
  test('8 lakh creates correct allocations; moving money keeps the sum exact', async ({ page }) => {
    await createPlan(page);
    await page.getByLabel('From', { exact: true }).selectOption({ index: 0 });
    await page.getByLabel('To', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Amount to move').fill('10000');
    await submit(page, 'Move');
    await expect(page.getByText(/Moved/)).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    const parsed = JSON.parse(stored ?? '{}') as {
      plan: { categories: { plannedMinor: number }[]; budgetMinor: number };
    };
    const sum = parsed.plan.categories.reduce((acc, c) => acc + c.plannedMinor, 0);
    expect(sum).toBe(parsed.plan.budgetMinor);
  });
});

test.describe('Journey 3: vendor payments', () => {
  test('schedule an advance, record it, reload - the balance survives', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Vendors' }).click();
    await page.getByLabel('Vendor name').fill('Sharma Caterers');
    await page.getByLabel('Status').selectOption('booked');
    await page.getByLabel('Agreed price (only for booked)').fill('100000');
    await submit(page, 'Add vendor');
    await expect(page.getByRole('heading', { name: 'Sharma Caterers' })).toBeVisible();

    await page.getByLabel('Due date').fill(FUTURE_DATE);
    await page.getByLabel('Amount', { exact: true }).fill('30000');
    await submit(page, 'Add to schedule');
    const row = page.getByRole('row').filter({ hasText: 'Advance' }).first();
    await expect(row).toBeVisible();

    await row.getByLabel('Amount paid now').fill('30000');
    const payForm = row
      .getByRole('button', { name: 'Record payment' })
      .locator('xpath=ancestor::form[1]');
    await payForm.evaluate((element) => {
      (element as HTMLFormElement).requestSubmit();
    });
    await expect(row.getByText('Paid in full')).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: 'Vendors' }).click();
    await expect(page.getByRole('heading', { name: 'Sharma Caterers' })).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    expect(stored).toContain('"instalmentId"');
  });
});

test.describe('Journey 5: guests and dietary', () => {
  test('add a guest with dietary needs, and persist across reload', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Guests' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Meera');
    await page.getByRole('checkbox', { name: 'Vegan' }).check();
    await page.getByRole('checkbox', { name: 'Nut allergy' }).check();
    await submit(page, 'Add guest');
    const row = page.getByRole('row').filter({ hasText: 'Meera' });
    await expect(row).toContainText('Vegan');
    await expect(row).toContainText('Nut allergy');
    await page.reload();
    await page.getByRole('tab', { name: 'Guests' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Meera' })).toContainText('Vegan');
  });
});

test.describe('Journey 8: AI patch safety', () => {
  test('reject changes nothing; apply then undo restores exactly', async ({ page }) => {
    await mockAi(page);
    await createPlan(page);
    const storedBefore = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    await page.getByRole('tab', { name: 'Assistant' }).click();
    await page.getByLabel('What would you like to change?').fill('add a haldi task at home');
    await page.getByRole('button', { name: 'Suggest changes' }).click();
    await expect(page.getByText('Add a haldi task')).toBeVisible();

    await page.getByRole('button', { name: 'Reject' }).click();
    const afterReject = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('utsav.plans.v1'))) ?? '{}',
    ) as { plan: unknown };
    expect(afterReject.plan).toEqual((JSON.parse(storedBefore ?? '{}') as { plan: unknown }).plan);

    await page.getByRole('button', { name: 'Suggest changes' }).click();
    await page.getByRole('button', { name: 'Apply these changes' }).click();
    await expect(page.getByText(/Applied\. One undo step/)).toBeVisible();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByText('Haldi at home')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Haldi at home')).toBeHidden();
    // The plan content must match exactly (the savedAt wrapper timestamp may differ).
    const after = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('utsav.plans.v1'))) ?? '{}',
    ) as { plan: unknown };
    expect(after.plan).toEqual((JSON.parse(storedBefore ?? '{}') as { plan: unknown }).plan);
  });
});

test.describe('Journey 10: production quality', () => {
  test('no console errors on the main walk', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await createPlan(page);
    for (const tab of ['Timeline', 'Guests', 'Vendors', 'Assistant', 'Budget']) {
      await page.getByRole('tab', { name: tab }).click();
    }
    await expect(page.getByRole('heading', { name: 'What-if scenarios' })).toBeVisible();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('offline AI: with routes failing, the built-in path keeps the app usable', async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.abort());
    await createPlan(page);
    await page.getByRole('tab', { name: 'Assistant' }).click();
    await page.getByRole('button', { name: 'Ask AI for a plan review' }).click();
    await expect(page.getByText(/unavailable/i)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Budget' })).toBeEnabled();
  });
});
