import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility evidence, automated.
 *
 * - axe-core scans (WCAG 2.x A/AA tags) of every major view in light AND dark themes,
 *   against a plan with real content (vendor with a paid instalment, guests, tasks).
 *   Critical/serious violations fail the run; the full raw result of every scan is
 *   written to e2e/evidence/accessibility/ and cited by docs/ACCESSIBILITY_REPORT.md.
 * - A keyboard-only journey: skip link, form completion, tablist arrow keys, a
 *   destructive action, visible focus, and a trap check.
 * - Reflow at 320 px and a reduced-motion check.
 */

const EVIDENCE_DIR = join(import.meta.dirname, '..', 'evidence', 'accessibility');
const FUTURE_DATE = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 120);
  return date.toISOString().slice(0, 10);
})();

const VIEW_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Build a plan with realistic content by driving the real UI, so scans see real states. */
async function preparePlan(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Asha and Dev wedding');
  await page.getByLabel('Occasion').selectOption('wedding');
  await page.getByLabel('Event date').fill(FUTURE_DATE);
  await page.getByLabel('Expected guests').fill('150');
  await page.getByLabel(/Total budget in/).fill('800000');
  await page.getByRole('button', { name: 'Create the plan' }).click();
  await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');

  // A booked vendor with a scheduled, paid instalment (Vendors view shows its richest state).
  await page.getByRole('tab', { name: 'Vendors' }).click();
  await page.getByLabel('Vendor name').fill('Sharma Caterers');
  await page.getByLabel('Status').selectOption('booked');
  await page.getByLabel('Agreed price (only for booked)').fill('400000');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await expect(page.getByRole('heading', { name: 'Sharma Caterers' })).toBeVisible();
  await page.getByLabel('Due date').fill(FUTURE_DATE);
  await page.getByLabel('Amount', { exact: true }).fill('150000');
  await page.getByRole('button', { name: 'Add to schedule' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Advance' }).first();
  await expect(row).toBeVisible();
  await row.getByLabel('Amount paid now').fill('150000');
  await row
    .getByRole('button', { name: 'Record payment' })
    .locator('xpath=ancestor::form[1]')
    .evaluate((element) => {
      (element as HTMLFormElement).requestSubmit();
    });
  await expect(row.getByText('Paid in full')).toBeVisible();

  // Guests with dietary needs so the catering summary has content.
  await page.getByRole('tab', { name: 'Guests' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Meera');
  await page.getByRole('checkbox', { name: 'Vegan' }).check();
  await page.getByRole('button', { name: 'Add guest' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Meera' })).toBeVisible();
}

async function openView(page: Page, view: string): Promise<void> {
  const label = VIEW_LABEL[view] ?? view;
  await page.getByRole('tab', { name: label, exact: true }).click();
  await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

const VIEW_LABEL: Record<string, string> = {
  events: 'All events',
  setup: 'Event',
  budget: 'Budget',
  timeline: 'Timeline',
  runsheet: 'Run sheet',
  guests: 'Guests',
  vendors: 'Vendors',
  cashflow: 'Payments',
  activity: 'Activity',
  assistant: 'Assistant',
};

interface AxeResult {
  violations: {
    id: string;
    impact: string | null;
    description: string;
    nodes: { target: string[]; failureSummary?: string }[];
  }[];
}

async function scan(page: Page, view: string, theme: 'light' | 'dark'): Promise<AxeResult> {
  const builder = new AxeBuilder({ page }).withTags(VIEW_TAGS);
  const result = (await builder.analyze()) as unknown as AxeResult;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, `${view}-${theme}.json`),
    JSON.stringify(
      {
        view,
        theme,
        url: page.url(),
        tags: VIEW_TAGS,
        timestamp: new Date().toISOString(),
        violations: result.violations,
      },
      null,
      2,
    ),
  );
  return result;
}

test.describe('Automated accessibility: axe scans of every view', () => {
  const views = [
    'budget',
    'timeline',
    'runsheet',
    'guests',
    'vendors',
    'cashflow',
    'activity',
    'assistant',
  ] as const;

  test('light theme: no serious or critical violations on any populated view', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await preparePlan(page);
    const problems: string[] = [];
    for (const view of views) {
      await openView(page, view);
      const result = await scan(page, view, 'light');
      for (const violation of result.violations) {
        const impact = violation.impact ?? 'unknown';
        const line = `${view}: ${violation.id} (${impact}) — ${violation.description}`;
        await testInfo.attach(`${view}-light`, {
          body: JSON.stringify(violation, null, 2),
          contentType: 'application/json',
        });
        if (impact === 'critical' || impact === 'serious') problems.push(line);
      }
    }
    expect(problems, `serious/critical violations:\n${problems.join('\n')}`).toEqual([]);
  });

  test('dark theme: no serious or critical violations on any populated view', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await preparePlan(page);
    const problems: string[] = [];
    for (const view of views) {
      await openView(page, view);
      const result = await scan(page, view, 'dark');
      for (const violation of result.violations) {
        const impact = violation.impact ?? 'unknown';
        const line = `${view}: ${violation.id} (${impact}) — ${violation.description}`;
        await testInfo.attach(`${view}-dark`, {
          body: JSON.stringify(violation, null, 2),
          contentType: 'application/json',
        });
        if (impact === 'critical' || impact === 'serious') problems.push(line);
      }
    }
    expect(problems, `serious/critical violations:\n${problems.join('\n')}`).toEqual([]);
  });

  test('first-run states: setup and events library scan clean in both themes', async ({ page }) => {
    const problems: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      for (const view of ['setup', 'events'] as const) {
        await openView(page, view);
        const result = await scan(page, view, theme);
        for (const violation of result.violations) {
          const impact = violation.impact ?? 'unknown';
          if (impact === 'critical' || impact === 'serious') {
            problems.push(
              `${view}/${theme}: ${violation.id} (${impact}) — ${violation.description}`,
            );
          }
        }
      }
    }
    expect(problems, `serious/critical violations:\n${problems.join('\n')}`).toEqual([]);
  });
});

test.describe('Keyboard-only operation', () => {
  test('skip link, form completion, tablist arrows, destructive action, visible focus', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. The skip link is the first stop and moves focus to main.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip/i })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();

    // 2. Complete the setup form with the keyboard alone.
    await page.getByLabel('Event name').fill('Keyboard journey wedding');
    await page.getByLabel('Occasion').selectOption('wedding');
    await page.getByLabel('Event date').fill(FUTURE_DATE);
    await page.getByLabel('Expected guests').fill('120');
    await page.getByLabel(/Total budget in/).fill('600000');
    await page.getByRole('button', { name: 'Create the plan' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // 3. Arrow keys move and activate tabs (APG tabs pattern).
    await page.getByRole('tab', { name: 'Budget' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Timeline' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Assistant' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // 4. No keyboard trap: twenty presses of Tab always advance focus.
    const seen = new Set<string>();
    await page.getByRole('tab', { name: 'Budget' }).focus();
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null) return 'none';
        return `${el.tagName}:${el.textContent.slice(0, 24)}:${el.getAttribute('aria-label') ?? ''}`;
      });
      seen.add(id);
    }
    expect(seen.size, 'focus should land on many different stops').toBeGreaterThan(6);

    // 5. Visible focus indication after keyboard focus (focus-visible outline).
    await page.getByRole('tab', { name: 'Budget' }).focus();
    const outline = await page.getByRole('tab', { name: 'Budget' }).evaluate((el) => {
      el.focus();
      return getComputedStyle(el).outlineStyle;
    });
    expect(outline, 'keyboard focus must be visible').not.toBe('none');

    // 6. A destructive action (reset plan) is fully keyboard operable and confirmed.
    await page.getByRole('button', { name: 'Reset', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Delete every saved event' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Event name')).toBeVisible();
  });
});

test.describe('Reflow and reduced motion', () => {
  test('320 px viewport: content reflows without horizontal page scroll', async ({ page }) => {
    await preparePlan(page);
    await page.setViewportSize({ width: 320, height: 700 });
    for (const view of ['budget', 'vendors', 'guests'] as const) {
      await openView(page, view);
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scroll.scrollWidth - scroll.clientWidth,
        `page must not scroll horizontally on ${view} at 320 px (tables scroll inside their own box)`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('prefers-reduced-motion: reduce is honoured', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preparePlan(page);
    const duration = await page
      .getByRole('tab', { name: 'Guests' })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // Chromium reports 0.01ms as "1e-05s"; both notations are the same duration.
    const seconds = Number.parseFloat(duration) * (duration.endsWith('ms') ? 0.001 : 1);
    expect(seconds, 'transitions collapse under reduced motion').toBeLessThanOrEqual(0.00002);
  });
});
