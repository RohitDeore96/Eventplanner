#!/usr/bin/env node
/**
 * Captures the accessibility evidence screenshots cited by docs/ACCESSIBILITY_REPORT.md
 * from the production build served by `vite preview` on :4198. Run `npm run build` first,
 * then:  node scripts/capture-a11y-evidence.mjs
 * Writes PNGs into e2e/evidence/accessibility/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4198';
const OUT = 'e2e/evidence/accessibility';
mkdirSync(OUT, { recursive: true });

const FUTURE_DATE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 120);
  return d.toISOString().slice(0, 10);
})();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE);

// A small but complete plan so views have real content.
await page.getByLabel('Event name').fill('Asha & Dev wedding');
await page.getByLabel('Event date').fill(FUTURE_DATE);
await page.getByLabel('Expected guests').fill('150');
await page.getByLabel(/Total budget in/).fill('800000');
await page.getByRole('button', { name: 'Create the plan' }).click();
await page.getByRole('tab', { name: 'Budget' }).click();

// 1. Visible keyboard focus: Tab into the tablist, focus a tab, capture the ring.
await page.getByRole('tab', { name: 'Budget' }).focus();
await page.keyboard.press('ArrowRight'); // Timeline becomes selected AND focused
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/keyboard-focus-tablist.png` });

// 2. Dark theme Budget view (system-preference dark).
await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('tab', { name: 'Budget' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/budget-dark-theme.png` });
await page.emulateMedia({ colorScheme: 'light' });

// 3. 320 px reflow: tables scroll within their own box, page does not scroll.
await page.setViewportSize({ width: 320, height: 700 });
await page.getByRole('tab', { name: 'Vendors' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/reflow-320px-vendors.png` });

await browser.close();
console.log(
  'captured: keyboard-focus-tablist.png, budget-dark-theme.png, reflow-320px-vendors.png',
);
