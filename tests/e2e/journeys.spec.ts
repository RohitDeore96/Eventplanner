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

async function createPlan(page: Page, budget = '800000', currency = 'INR'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Asha and Dev wedding');
  await page.getByLabel('Event date').fill(FUTURE_DATE);
  await page.getByLabel('Expected guests').fill('150');
  // Headless browser locales default to USD; the INR journeys pin the currency explicitly.
  // The budget field clears on currency change, so currency is chosen before the budget.
  await page.getByLabel('Currency').selectOption(currency);
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

/**
 * Milestone 9 journeys 2-8: Indian amounts, currency exponents, the autosave lifecycle,
 * currency-mutation protection, corrupt-storage recovery, existing-plan migration and the
 * honest no-key AI path. The API-mocked intake tests mirror the deterministic fallback's
 * exact answers (unit-tested in tests/api/intake-money.test.ts); every form-typed amount
 * below is a real end-to-end path with no API involved.
 */

function storedPlan(
  page: Page,
): Promise<{
  plan: {
    budgetMinor: number;
    currency: string;
    expenses: unknown[];
    guests: unknown[];
    vendors: { categoryId: string }[];
  };
} | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('utsav.plans.v1');
    return raw === null ? null : (JSON.parse(raw) as Record<string, never>);
  }) as Promise<{
    plan: {
      budgetMinor: number;
      currency: string;
      expenses: unknown[];
      guests: unknown[];
      vendors: { categoryId: string }[];
    };
  } | null>;
}

async function recordExpense(page: Page, amount: string, note: string): Promise<void> {
  await page.getByLabel('Amount spent').fill(amount);
  // exact: the Budget page also holds scenario radios whose names contain "Date".
  await page.getByLabel('Date', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Note (optional)').fill(note);
  await submit(page, 'Add expense');
  await expect(page.getByText('Expense recorded.')).toBeVisible();
}

async function createPlanInCurrency(page: Page, currency: string, budget: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Exponent check');
  // The budget field clears on currency change, so currency is chosen first.
  await page.getByLabel('Currency').selectOption(currency);
  await page.getByLabel('Event date').fill(FUTURE_DATE);
  await page.getByLabel('Expected guests').fill('50');
  await page.getByLabel(/Total budget in/).fill(budget);
  await submit(page, 'Create the plan');
  await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
}

test.describe('Journey 2: Indian number formatting', () => {
  test('typing 8,00,000 stores exactly 80,000,000 minor units', async ({ page }) => {
    await createPlan(page, '8,00,000');
    // ICU data differs per browser build (Indian vs western grouping), so the display
    // assertion is grouping-agnostic; the EXACT stored minor units are the real contract.
    await expect(page.getByText(/₹8,?00,?000\.00/).first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.plan.budgetMinor).toBe(80_000_000);
  });

  test('8.5 lakh from the description stores exactly 85,000,000 minor units', async ({ page }) => {
    await mockAi(page);
    await page.route('**/api/parse-intake', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        // The deterministic fallback's exact answer for this text (see intake-money tests).
        body: JSON.stringify({
          name: null,
          occasion: 'wedding',
          dateISO: null,
          guests: null,
          budgetMinor: 85_000_000,
          notes: null,
          source: 'built-in',
        }),
      }),
    );
    await page.goto('/');
    await page.getByLabel(/For example: "Shaadi in Pune/).fill('Wedding with budget 8.5 lakh');
    await page.getByRole('button', { name: 'Fill form from description' }).click();
    await expect(page.getByLabel(/Total budget in/)).toHaveValue('850000');
    await page.getByLabel('Event name').fill('Asha and Dev wedding');
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await page.getByLabel('Expected guests').fill('150');
    await submit(page, 'Create the plan');
    const stored = await storedPlan(page);
    expect(stored?.plan.budgetMinor).toBe(85_000_000);
  });
});

test.describe('Journey 3: currency exponents', () => {
  test('a JPY plan never gains fake decimals', async ({ page }) => {
    await createPlanInCurrency(page, 'JPY', '50000');
    await expect(page.getByText(/50,000/).first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.plan.currency).toBe('JPY');
    expect(stored?.plan.budgetMinor).toBe(50_000);
  });

  test('a KWD plan keeps all three decimals', async ({ page }) => {
    await createPlanInCurrency(page, 'KWD', '100.125');
    await expect(page.getByText('KWD 100.125').first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.plan.currency).toBe('KWD');
    expect(stored?.plan.budgetMinor).toBe(100_125);
  });

  test('a USD plan converts with the dollar exponent', async ({ page }) => {
    await createPlanInCurrency(page, 'USD', '10000');
    await expect(page.getByText('$10,000.00').first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.plan.currency).toBe('USD');
    expect(stored?.plan.budgetMinor).toBe(1_000_000);
  });
});

test.describe('Journey 4: autosave and restoration', () => {
  test('every change survives a reload, and undo survives a reload too', async ({ page }) => {
    await createPlan(page);
    await recordExpense(page, '20000', 'venue advance');
    await page.getByRole('tab', { name: 'Guests' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Meera');
    await submit(page, 'Add guest');
    await expect(page.getByRole('row').filter({ hasText: 'Meera' })).toBeVisible();

    // Reload: both changes must come back.
    await page.reload();
    await page.getByRole('tab', { name: 'Guests' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Meera' })).toBeVisible();
    let stored = await storedPlan(page);
    expect(stored?.plan.expenses).toHaveLength(1);
    expect(stored?.plan.guests).toHaveLength(1);

    // After the reload the undo stack starts fresh: make one more change, undo it,
    // then reload — the restored state must be the UNDONE one.
    await page.getByRole('tab', { name: 'Budget' }).click();
    await recordExpense(page, '3000', 'extra marigold');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.reload();
    stored = await storedPlan(page);
    expect(stored?.plan.expenses).toHaveLength(1);
    expect(stored?.plan.expenses[0]?.note).toBe('venue advance');
    expect(stored?.plan.guests).toHaveLength(1);
  });
});

test.describe('Journey 5: currency mutation protection', () => {
  test('a plan with payments refuses a silent denomination change', async ({ page }) => {
    await createPlan(page);
    await recordExpense(page, '5000', 'booking advance');
    await page.getByRole('tab', { name: 'Event' }).click();
    await page.getByLabel('Currency').selectOption('USD');
    // Changing currency clears the budget field by design (amounts are never converted),
    // so the browser first demands a fresh budget entry; the engine then still refuses.
    await page.getByLabel(/Total budget in/).fill('500000');
    await submit(page, 'Save changes');
    await expect(page.getByText(/currency is locked/)).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.plan.currency).toBe('INR');
    expect(stored?.plan.expenses).toHaveLength(1);
  });
});

test.describe('Journey 6: invalid persisted state', () => {
  test('malformed JSON triggers the recovery path and start fresh clears it', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('utsav.plans.v1', '{not json at all');
    });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('not readable');
    await expect(page.getByRole('tab', { name: 'Budget' })).toBeDisabled();
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => localStorage.getItem('utsav.plans.v1'))).toBeNull();
    await expect(page.getByRole('alert')).toBeHidden();
  });

  test('a structurally invalid vendor fails its safety checks instead of loading', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const plan = {
        id: 'ev1',
        name: 'Broken vendor plan',
        occasion: 'wedding',
        dateISO: '2027-03-15',
        currency: 'INR',
        locale: 'en-IN',
        budgetMinor: 100_000_000,
        guestTarget: 120,
        categories: [{ id: 'cat-venue', key: 'venue', name: 'Venue', plannedMinor: 40_000_000 }],
        vendors: [
          {
            id: 'v1',
            categoryId: 'ghost-category',
            name: 'X',
            contactNote: '',
            status: 'booked',
            committedMinor: null,
            schedule: [],
          },
        ],
        expenses: [],
        tasks: [],
        guests: [],
      };
      localStorage.setItem(
        'utsav.plans.v1',
        JSON.stringify({ schemaVersion: 1, savedAtISO: '2026-10-30T00:00:00.000Z', plan }),
      );
    });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('failed its safety checks');
    await expect(page.getByRole('tab', { name: 'Budget' })).toBeDisabled();
  });
});

test.describe('Journey 7: existing-plan migration', () => {
  test('a version-0 record loads, saves forward and survives a change and reload', async ({
    page,
  }) => {
    await createPlan(page);
    await recordExpense(page, '12000', 'mehndi supplies');
    // Rewrite the stored record WITHOUT schemaVersion: exactly what the first release wrote.
    await page.evaluate(() => {
      const raw = localStorage.getItem('utsav.plans.v1');
      if (raw === null) throw new Error('no stored plan');
      const record = JSON.parse(raw) as { savedAtISO: string; plan: unknown };
      localStorage.setItem(
        'utsav.plans.v1',
        JSON.stringify({ savedAtISO: record.savedAtISO, plan: record.plan }),
      );
    });
    await page.reload();
    // The migrated plan is live and editable.
    await recordExpense(page, '3000', 'extra marigold');
    const stored = (await storedPlan(page)) as unknown as {
      schemaVersion: number;
      plan: { expenses: { note: string }[] };
    };
    expect(stored.schemaVersion).toBe(1);
    expect(stored.plan.expenses.map((e) => e.note)).toContain('extra marigold');
    await page.reload();
    const after = (await storedPlan(page)) as unknown as {
      plan: { expenses: { note: string }[] };
    };
    expect(after.plan.expenses).toHaveLength(2);
  });
});

test.describe('Journey 8: no-key AI fallback honesty', () => {
  test('with the AI endpoint down, the reader says so and nothing is invented', async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/');
    await page
      .getByLabel(/For example: "Shaadi in Pune/)
      .fill('Shaadi in Pune, 150 guests, 8 lakh budget');
    await page.getByRole('button', { name: 'Fill form from description' }).click();
    await expect(page.getByText(/unavailable/i)).toBeVisible();
    // No fake success: the form was not filled by anyone.
    await expect(page.getByLabel('Expected guests')).toHaveValue('');
    // The family plans by hand and the app works fully.
    await page.getByLabel('Event name').fill('Asha and Dev wedding');
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await page.getByLabel('Expected guests').fill('150');
    await page.getByLabel(/Total budget in/).fill('800000');
    await submit(page, 'Create the plan');
    const stored = await storedPlan(page);
    expect(stored?.plan.budgetMinor).toBe(80_000_000);
  });
});
