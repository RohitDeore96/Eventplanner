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
    if (url.includes('extract-quote')) {
      return json({
        vendorName: 'Sharma Caterers',
        category: null,
        totalPriceMinor: 12_000_000,
        pricePerPlateMinor: null,
        guestMinimum: 100,
        overtimeFeePerHourMinor: null,
        taxIncluded: false,
        advancePercent: 30,
        cancellationPolicy: '14 days notice',
        inclusions: ['staff', 'crockery'],
        exclusions: ['tax', 'flowers'],
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
      activeId: string | null;
      plans: { id: string; categories: { plannedMinor: number }[]; budgetMinor: number }[];
    };
    const active = parsed.plans.find((p) => p.id === parsed.activeId) ?? parsed.plans[0];
    const sum = (active?.categories ?? []).reduce((acc, c) => acc + c.plannedMinor, 0);
    expect(sum).toBe(active?.budgetMinor);
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

interface StoredSnapshot {
  id: string;
  budgetMinor: number;
  currency: string;
  expenses: { note: string }[];
  guests: unknown[];
  vendors: { categoryId: string }[];
}

/** The stored ACTIVE event from the v2 workspace record (R8). */
function storedPlan(page: Page): Promise<StoredSnapshot | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('utsav.plans.v1');
    if (raw === null) return null;
    const record = JSON.parse(raw) as { activeId: string | null; plans: StoredSnapshot[] };
    return record.plans.find((p) => p.id === record.activeId) ?? record.plans[0] ?? null;
  });
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
    expect(stored?.budgetMinor).toBe(80_000_000);
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
    expect(stored?.budgetMinor).toBe(85_000_000);
  });
});

test.describe('Journey 3: currency exponents', () => {
  test('a JPY plan never gains fake decimals', async ({ page }) => {
    await createPlanInCurrency(page, 'JPY', '50000');
    await expect(page.getByText(/50,000/).first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.currency).toBe('JPY');
    expect(stored?.budgetMinor).toBe(50_000);
  });

  test('a KWD plan keeps all three decimals', async ({ page }) => {
    await createPlanInCurrency(page, 'KWD', '100.125');
    await expect(page.getByText('KWD 100.125').first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.currency).toBe('KWD');
    expect(stored?.budgetMinor).toBe(100_125);
  });

  test('a USD plan converts with the dollar exponent', async ({ page }) => {
    await createPlanInCurrency(page, 'USD', '10000');
    await expect(page.getByText('$10,000.00').first()).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.currency).toBe('USD');
    expect(stored?.budgetMinor).toBe(1_000_000);
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
    expect(stored?.expenses).toHaveLength(1);
    expect(stored?.guests).toHaveLength(1);

    // After the reload the undo stack starts fresh: make one more change, undo it,
    // then reload — the restored state must be the UNDONE one.
    await page.getByRole('tab', { name: 'Budget' }).click();
    await recordExpense(page, '3000', 'extra marigold');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.reload();
    stored = await storedPlan(page);
    expect(stored?.expenses).toHaveLength(1);
    expect(stored?.expenses[0]?.note).toBe('venue advance');
    expect(stored?.guests).toHaveLength(1);
  });
});

test.describe('Journey 5: currency mutation protection', () => {
  test('a plan with payments refuses a silent denomination change', async ({ page }) => {
    await createPlan(page);
    await recordExpense(page, '5000', 'booking advance');
    await page.getByRole('tab', { name: 'Event', exact: true }).click();
    await page.getByLabel('Currency').selectOption('USD');
    // Changing currency clears the budget field by design (amounts are never converted),
    // so the browser first demands a fresh budget entry; the engine then still refuses.
    await page.getByLabel(/Total budget in/).fill('500000');
    await submit(page, 'Save changes');
    await expect(page.getByText(/currency is locked/)).toBeVisible();
    const stored = await storedPlan(page);
    expect(stored?.currency).toBe('INR');
    expect(stored?.expenses).toHaveLength(1);
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

  test('a structurally invalid event is dropped alone, with a spoken notice', async ({ page }) => {
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
    await expect(page.getByRole('status').first()).toContainText('failed their safety checks');
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
      const record = JSON.parse(raw) as { savedAtISO: string; plans: { id: string }[] };
      localStorage.setItem(
        'utsav.plans.v1',
        JSON.stringify({ savedAtISO: record.savedAtISO, plan: record.plans[0] }),
      );
    });
    await page.reload();
    // The migrated plan is live and editable; the workspace saves forward as version 2.
    await recordExpense(page, '3000', 'extra marigold');
    const rawRecord = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    const stored = JSON.parse(rawRecord ?? 'null') as {
      schemaVersion: number;
      plans: { expenses: { note: string }[] }[];
    };
    expect(stored.schemaVersion).toBe(3);
    expect(stored.plans[0]?.expenses.map((e) => e.note)).toContain('extra marigold');
    await page.reload();
    const after = await storedPlan(page);
    expect(after?.expenses).toHaveLength(2);
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
    expect(stored?.budgetMinor).toBe(80_000_000);
  });
});

test.describe('Journey 9: differentiators on the real build', () => {
  test('multi-event: create a second event, switch between them, delete one', async ({ page }) => {
    await createPlan(page);
    // A second event joins the workspace through the All-events manager.
    await page.getByRole('tab', { name: 'All events' }).click();
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByLabel('Event name').fill('Diwali party');
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await page.getByLabel('Expected guests').fill('40');
    await page.getByLabel(/Total budget in/).fill('200000');
    await page.getByRole('button', { name: 'Create the plan' }).click();
    await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Both events persist with the new one active.
    let stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    let record = JSON.parse(stored ?? '{}') as {
      activeId: string;
      plans: { id: string; name: string; guestTarget: number }[];
    };
    expect(record.plans).toHaveLength(2);
    expect(record.plans.map((p) => p.name)).toContain('Diwali party');

    // Switch back to the first event; its data is untouched.
    await page.getByRole('tab', { name: 'All events' }).click();
    await page
      .locator('li', { hasText: 'Asha and Dev wedding' })
      .getByRole('button', { name: 'Open' })
      .click();
    await page.getByRole('tab', { name: 'Guests' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Meera');
    await submit(page, 'Add guest');
    await page.getByRole('tab', { name: 'All events' }).click();
    await expect(page.locator('li', { hasText: 'Diwali party' })).not.toContainText('Meera');
    stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    record = JSON.parse(stored ?? '{}') as typeof record;
    const wedding = record.plans.find((p) => p.name === 'Asha and Dev wedding');
    expect(wedding?.guestTarget).toBe(150);

    // Deleting the other event needs a second, explicit confirmation.
    await page
      .locator('li', { hasText: 'Diwali party' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByRole('button', { name: /Really delete “Diwali party”/ }).click();
    await expect(page.locator('li', { hasText: 'Diwali party' })).toHaveCount(0);
  });

  test('stress test, payments calendar and activity log are one click away', async ({ page }) => {
    await createPlan(page);
    await recordExpense(page, '20000', 'venue advance');

    // X6: the combined shocks preview without changing the plan. Keyboard-driven on
    // purpose: focus + Enter works on every viewport (also evidence for the keyboard walk).
    const stress = page.getByRole('button', { name: 'Run stress test' });
    await stress.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/The plan (survives|breaks)/)).toBeVisible();

    // X8: the payments calendar renders its honest empty state.
    await page.getByRole('tab', { name: 'Payments' }).click();
    await expect(page.getByText(/No scheduled payments yet/)).toBeVisible();

    // X9: the activity log names the expense and marks Undo.
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText(/venue advance/)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('undone')).toBeVisible();
  });

  test('the chrome speaks Hindi and Marathi on demand (X10)', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('combobox', { name: 'Language' }).selectOption('hi');
    await expect(page.getByRole('tab', { name: 'बजट' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'पूर्ववत' })).toBeDisabled(); // nothing to undo yet
    await page.getByRole('combobox', { name: 'भाषा' }).selectOption('mr');
    await expect(page.getByRole('tab', { name: 'वेळापत्रक' })).toBeVisible();
    // The choice persists for the next visit.
    expect(await page.evaluate(() => localStorage.getItem('utsav.lang.v1'))).toBe('mr');
  });
});

test.describe('Journey 11 (Phase 2 B): expenses link to vendors and instalments', () => {
  test.setTimeout(90_000);
  test('link an expense to a vendor instalment, reassign it, keep the summaries honest', async ({
    page,
  }) => {
    await createPlan(page);
    // A booked catering vendor with one scheduled instalment.
    await page.getByRole('tab', { name: 'Vendors' }).click();
    await page.getByLabel('Vendor name').fill('Annapurna Caterers');
    await page.getByLabel('Status').selectOption('booked');
    await page.getByLabel('Agreed price (only for booked)').fill('100000');
    await submit(page, 'Add vendor');
    await page.getByLabel('Due date').fill(FUTURE_DATE);
    await page.getByLabel('Amount', { exact: true }).fill('40000');
    await submit(page, 'Add to schedule');
    await expect(page.getByRole('row').filter({ hasText: 'Advance' }).first()).toBeVisible();

    // Journey B step: create an expense linked to that vendor and instalment.
    await page.getByRole('tab', { name: 'Budget' }).click();
    await page.getByLabel('Vendor (optional)').selectOption({ label: 'Annapurna Caterers' });
    await page.getByLabel('Payment instalment (optional)').selectOption({ index: 1 });
    await page.getByLabel('Amount spent').fill('25000');
    await page.getByLabel('Date', { exact: true }).fill(FUTURE_DATE);
    await page.getByLabel('Note (optional)').fill('advance part one');
    await submit(page, 'Add expense');
    await expect(page.getByText('settles a scheduled payment')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    expect(stored).toContain('"instalmentId":"i-');

    // Re-link the expense back to direct spend; the summaries must follow.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel(/Vendor \(this expense's category/).selectOption('');
    await submit(page, 'Save');
    await expect(page.getByText('Expense updated.')).toBeVisible();
    const relinkedRow = page.getByRole('row').filter({ hasText: 'advance part one' });
    await expect(relinkedRow).toContainText('Direct spend');
  });
});

test.describe('Journey 12 (Phase 2 C): quotations captured, corrected, accepted', () => {
  test.setTimeout(90_000);
  test('extract, correct, save, compare and accept — the vendor is booked once', async ({
    page,
  }) => {
    await createPlan(page);
    await mockAi(page);
    await page.getByRole('tab', { name: 'Vendors' }).click();
    await page
      .getByLabel('Quote text')
      .fill('Sharma Caterers: total 120000, advance 30%, tax excluded, min 100 plates');
    await page.getByRole('button', { name: 'Read the quote' }).click();
    await expect(page.getByText(/Correct anything the reader got wrong/)).toBeVisible();
    // Correct the total before saving (M7.2): 120000 -> 110000.
    await page.getByLabel('Stated total (blank = not stated)').fill('110000');
    await page.getByRole('button', { name: 'Save quotation' }).click();
    await expect(page.getByText(/Quotation saved/)).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('utsav.quotes.v1'));
    expect(saved).toContain('"totalPriceMinor":11000000');

    // Save a second, cheaper quote; the mock reads the same text, so the family renames
    // the draft before saving — exactly what the correction form is for.
    await page.getByLabel('Quote text').fill('Bhagwati Foods: total 95000, advance 25%');
    await page.getByRole('button', { name: 'Read the quote' }).click();
    await expect(page.getByText(/Correct anything the reader got wrong/)).toBeVisible();
    const vendorField = page.locator('#q-vendor');
    await vendorField.fill('Bhagwati Foods');
    await page.getByLabel('Stated total (blank = not stated)').fill('95000');
    await page.getByRole('button', { name: 'Save quotation' }).click();
    await expect(page.getByText(/Quotation saved/)).toBeVisible();
    await expect(page.getByText(/Compare saved quotations/)).toBeVisible();
    const compare = page.locator('section').filter({ hasText: 'Compare saved quotations' });
    await expect(compare.getByRole('heading', { name: 'Bhagwati Foods' })).toBeVisible();
    await expect(compare.getByRole('heading', { name: 'Sharma Caterers' })).toBeVisible();

    // Accept the cheaper one; the vendor appears booked at the effective price.
    const card = compare
      .locator('div.card')
      .filter({ has: page.getByRole('heading', { name: 'Bhagwati Foods' }) })
      .first();
    await card.getByRole('button', { name: 'Accept this quotation' }).click();
    await expect(page.getByText(/the vendor is booked at the effective price/)).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Vendors' }).click();
    // After acceptance the name appears twice: the booked vendor card and the quote card.
    await expect(page.getByRole('heading', { name: 'Bhagwati Foods' }).first()).toBeVisible();
    const afterReload = await page.evaluate(() => localStorage.getItem('utsav.quotes.v1'));
    expect(afterReload).toContain('"status":"accepted"');
    // The accepted quote cannot be accepted twice — its button is disabled after reload.
    const acceptedCard = page.locator('div.card').filter({ hasText: 'Bhagwati Foods' }).first();
    await expect(acceptedCard.getByRole('button', { name: 'Accepted' })).toBeDisabled();
  });
});

test.describe('Journey 13 (Phase 2 E): budget trade-offs and locks', () => {
  test.setTimeout(90_000);
  test('lock a category, fund another from the free money, verify the totals', async ({ page }) => {
    await createPlan(page);
    // Lock the venue category through the allocation editor.
    const venueRow = page
      .getByRole('row')
      .filter({ hasText: 'Venue' })
      .filter({ has: page.getByRole('checkbox') })
      .first();
    await venueRow.getByRole('checkbox').check();
    await expect(page.getByText('Venue locked.')).toBeVisible();
    await expect(page.getByText('🔒 locked').first()).toBeVisible();

    // Fund decor by an amount covered by unallocated/slack money, then apply.
    await page.getByLabel('Category to fund').selectOption({ label: 'Decor and flowers' });
    await page.getByLabel('Extra money needed').fill('50000');
    await submit(page, 'Show the trade-off');
    await expect(page.getByText(/Proposed: Decor and flowers/)).toBeVisible();
    await page.getByRole('button', { name: 'Apply this trade-off' }).click();
    await expect(page.getByText(/Trade-off applied as one undo step/)).toBeVisible();

    // The budget is still whole: allocations sum to the budget after the trade-off.
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    const parsed = JSON.parse(stored ?? '{}') as {
      plans: { categories: { plannedMinor: number }[]; budgetMinor: number }[];
    };
    const active = parsed.plans[0] ?? { categories: [], budgetMinor: 0 };
    const sum = active.categories.reduce((acc, c) => acc + c.plannedMinor, 0);
    expect(sum).toBe(active.budgetMinor);
  });
});

test.describe('Journey 14 (Phase 2 F): event-day run sheet', () => {
  test.setTimeout(90_000);
  test('add activities, see the conflict, fix it, and print only the sheet', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Run sheet' }).click();
    await page.getByLabel('Activity', { exact: true }).fill('Venue setup');
    await page.getByLabel('Where (optional)').fill('Lawn');
    await submit(page, 'Add activity');
    await expect(page.getByText('Venue setup')).toBeVisible();

    // An overlapping activity raises the conflict, never silently moves anything.
    await page.getByLabel('Activity', { exact: true }).fill('Decoration check');
    await page.getByLabel('Where (optional)').fill('Lawn');
    await submit(page, 'Add activity');
    await expect(page.getByText(/scheduling conflict/)).toBeVisible();
    expect(await page.getByText('Venue setup overlaps Decoration check').count()).toBeGreaterThan(
      0,
    );

    // Correct the conflict by moving the second activity later.
    const entryRow = page.getByRole('row').filter({ hasText: 'Decoration check' }).first();
    await entryRow.getByRole('button', { name: 'Edit' }).click();
    const editForm = page.getByRole('form', { name: 'Edit Decoration check' });
    await editForm.getByLabel('Start').fill('13:00');
    await editForm.getByLabel('End').fill('14:30');
    await submit(page, 'Save');
    await expect(page.getByText('Activity updated.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Decoration check' })).toContainText(
      '13:00',
    );

    // Print emulation: only the run sheet survives on paper, with the event header.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-only h1')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Budget' })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await page.reload();
    await page.getByRole('tab', { name: 'Run sheet' }).click();
    await expect(page.getByText('Venue setup')).toBeVisible();
  });
});

test.describe('Journey 15 (Phase 2 G): scenarios reject then apply', () => {
  test.setTimeout(90_000);
  test('reject leaves the plan untouched; apply changes it and undo reverses', async ({ page }) => {
    await createPlan(page);
    await page.getByRole('tab', { name: 'Budget' }).click();
    const before = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));

    // REJECT: preview the guest growth and discard it.
    await page.getByRole('radio', { name: /Guests \+20%/ }).check();
    await page.getByRole('button', { name: 'Preview impact' }).click();
    await expect(page.getByText(/Preview: Guests \+20%/)).toBeVisible();
    await page.getByRole('button', { name: 'Discard preview' }).click();
    expect(await page.evaluate(() => localStorage.getItem('utsav.plans.v1'))).toBe(before);

    // APPLY: the family's own assumptions change the plan as one undoable step.
    await page.getByLabel('Guests', { exact: true }).fill('200');
    await page.getByRole('button', { name: 'Preview my scenario' }).click();
    await expect(page.getByText(/Guest target: 150 → 200/)).toBeVisible();
    await page.getByRole('button', { name: 'Apply my scenario' }).click();
    await expect(page.getByText(/Scenario applied as one undo step/)).toBeVisible();
    const applied = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    expect(applied).toContain('"guestTarget":200');
    expect(applied).not.toBe(before);

    // Undo from the header restores the exact pre-scenario state.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  });
});

test.describe('Journey 16 (Phase 2 H): duplicate, archive, restore, delete', () => {
  test.setTimeout(90_000);
  test('the full event-library lifecycle keeps every surviving event intact', async ({ page }) => {
    // Event A with a distinctive guest count.
    await createPlan(page, '800000');
    // Event B with different data.
    await page.getByRole('tab', { name: 'All events' }).click();
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByLabel('Event name').fill('Diwali party');
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await page.getByLabel('Expected guests').fill('40');
    await page.getByLabel(/Total budget in/).fill('150000');
    await submit(page, 'Create the plan');

    // Switch back to A; B's data must not leak.
    await page.getByRole('tab', { name: 'All events' }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Asha and Dev wedding' })
      .getByRole('button', { name: 'Open' })
      .click();
    await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Duplicate A; the copy joins the library under its own name.
    await page.getByRole('tab', { name: 'All events' }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Asha and Dev wedding' })
      .getByRole('button', { name: 'Duplicate' })
      .click();
    await expect(page.getByText(/Created “Copy of Asha and Dev wedding”/)).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Copy of Asha and Dev wedding' }),
    ).toBeVisible();

    // Archive B, verify it leaves the working list, restore it.
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Diwali party' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('utsav.plans.v1'));
    const workspace = JSON.parse(stored ?? '{}') as {
      archivedIds: string[];
      plans: { id: string; name: string }[];
    };
    const diwali = workspace.plans.find((p) => p.name === 'Diwali party');
    expect(diwali).toBeDefined();
    expect(workspace.archivedIds).toEqual([diwali?.id]);
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Diwali party' })).toBeVisible();

    // Refresh restores the correct active event and library.
    await page.reload();
    await page.getByRole('tab', { name: 'All events' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Diwali party' })).toBeVisible();

    // Delete B with confirmation; A and the copy survive untouched.
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Diwali party' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByRole('button', { name: /Really delete “Diwali party”/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Diwali party' })).toHaveCount(0);
    await expect(
      page.getByRole('listitem').filter({ hasText: /^Asha and Dev wedding/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Copy of Asha and Dev wedding' }),
    ).toBeVisible();
  });
});
