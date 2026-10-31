#!/usr/bin/env node
/**
 * Captures real screenshots of the new R8/X6/X8/X9/X10 surfaces from the production
 * build served by `vite preview` on :4173. Run `npm run build` first, then:
 *   node scripts/capture-screenshots.mjs
 * Writes PNGs into docs/screenshots/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const FUTURE_DATE = '2027-03-15';

/** Seeds a workspace with one rich plan (expenses, vendor schedule) and one plain event. */
async function seed(page, { hindi = false } = {}) {
  const planA = {
    id: 'ev1',
    name: 'Asha & Dev wedding',
    occasion: 'wedding',
    dateISO: FUTURE_DATE,
    currency: 'INR',
    locale: 'en-IN',
    budgetMinor: 800_000_00,
    guestTarget: 150,
    categories: [
      { id: 'cat-venue', key: 'venue', name: 'Venue', plannedMinor: 240_000_00, locked: false },
      {
        id: 'cat-catering',
        key: 'catering',
        name: 'Catering',
        plannedMinor: 320_000_00,
        locked: false,
      },
      { id: 'cat-decor', key: 'decor', name: 'Decor', plannedMinor: 120_000_00, locked: false },
      {
        id: 'cat-photo',
        key: 'photo',
        name: 'Photography',
        plannedMinor: 80_000_00,
        locked: false,
      },
      {
        id: 'cat-contingency',
        key: 'contingency',
        name: 'Contingency',
        plannedMinor: 40_000_00,
        locked: true,
      },
    ],
    vendors: [
      {
        id: 'v1',
        categoryId: 'cat-venue',
        name: 'Grand Hall Pune',
        contactNote: 'Ask for the February rate',
        contactPerson: 'Meenal Joshi',
        phone: '+91 98220 11223',
        email: 'events@grandhallpune.in',
        status: 'booked',
        committedMinor: 240_000_00,
        schedule: [
          {
            id: 'i1',
            kind: 'advance',
            dueISO: '2026-11-10',
            amountMinor: 96_000_00,
            note: 'UTR ref 4471',
          },
          { id: 'i2', kind: 'final', dueISO: '2027-03-10', amountMinor: 144_000_00, note: '' },
        ],
      },
    ],
    expenses: [
      {
        id: 'e1',
        categoryId: 'cat-catering',
        vendorId: null,
        instalmentId: null,
        dateISO: '2026-10-20',
        amountMinor: 25_000_00,
        note: 'tasting advance',
      },
    ],
    tasks: [
      {
        id: 't1',
        title: 'Book the band',
        dueISO: '2026-12-01',
        dependsOn: [],
        assignee: null,
        done: false,
      },
      {
        id: 't2',
        title: 'Send invitations',
        dueISO: '2027-01-15',
        dependsOn: ['t1'],
        assignee: null,
        done: true,
      },
    ],
    guests: [
      {
        id: 'g1',
        name: 'Meera',
        rsvp: 'yes',
        plusOnes: 1,
        dietary: ['vegetarian'],
        group: 'Family',
      },
      {
        id: 'g2',
        name: 'Ravi',
        rsvp: 'pending',
        plusOnes: 0,
        dietary: [],
        group: 'Friends',
        contact: '',
        note: '',
      },
    ],
    runSheet: [
      {
        id: 'r1',
        title: 'Haldi at home',
        dateISO: '2027-03-14',
        startTime: '10:00',
        endTime: '13:00',
        ownerId: null,
        location: 'Family home, courtyard',
        note: 'Marigold decor; elders arrive by 09:30',
        done: true,
      },
      {
        id: 'r2',
        title: 'Baraat arrival',
        dateISO: '2027-03-15',
        startTime: '19:00',
        endTime: '20:00',
        ownerId: null,
        location: 'Main gate',
        note: '',
        done: false,
      },
      {
        id: 'r3',
        title: 'Dinner service',
        dateISO: '2027-03-15',
        startTime: '20:30',
        endTime: '23:00',
        ownerId: 'v1',
        location: 'Lawn buffet',
        note: 'Keep the jain counter separate',
        done: false,
      },
    ],
  };
  const planB = {
    ...planA,
    id: 'ev2',
    name: 'Diwali party',
    occasion: 'community',
    dateISO: '2026-11-08',
    budgetMinor: 200_000_00,
    guestTarget: 40,
    vendors: [],
  };
  await page.addInitScript(
    ([a, b, lang]) => {
      const store = globalThis.localStorage;
      store.setItem(
        'utsav.plans.v1',
        JSON.stringify({
          schemaVersion: 2,
          savedAtISO: '2026-10-30T00:00:00.000Z',
          activeId: a.id,
          plans: [a, b],
        }),
      );
      store.setItem(
        'utsav.quotes.v1',
        JSON.stringify({
          schemaVersion: 2,
          quotes: [
            {
              id: 'q1',
              planId: a.id,
              categoryId: 'cat-catering',
              savedAtISO: '2026-10-30T09:00:00.000Z',
              status: 'shortlisted',
              validityDate: '2026-12-31',
              note: 'Holds 2027 rates until year end',
              fields: {
                vendorName: 'Annapurna Caterers',
                category: null,
                totalPriceMinor: 32_000_00,
                pricePerPlateMinor: null,
                guestMinimum: 120,
                overtimeFeePerHourMinor: null,
                taxIncluded: false,
                advancePercent: 25,
                cancellationPolicy: '14 days notice',
                inclusions: ['live counters', 'staff'],
                exclusions: ['GST'],
              },
            },
          ],
        }),
      );
      if (lang !== null) store.setItem('utsav.lang.v1', lang);
    },
    [planA, planB, hindi ? 'hi' : null],
  );
}

async function shoot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();
try {
  // 1. All-events manager (R8), light theme.
  let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await seed(page);
  await page.goto(BASE);
  await page.getByRole('tab', { name: 'All events' }).click();
  await shoot(page, 'events-light');

  // 2. Cash-flow calendar (X8) with a real schedule.
  await page.getByRole('tab', { name: 'Payments' }).click();
  await shoot(page, 'payments-light');

  // 3. Activity log (X9) with a real change recorded in this session.
  await page.getByRole('tab', { name: 'Budget' }).click();
  await page.getByLabel('Amount spent').fill('25000');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-30');
  await page.getByLabel('Note (optional)').fill('marigold garlands');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await shoot(page, 'activity-light');

  // 4. Stress test (X6) with the verdict and its numbers on screen.
  await page.getByRole('tab', { name: 'Budget' }).click();
  const stress = page.getByRole('button', { name: 'Run stress test' });
  await stress.scrollIntoViewIfNeeded();
  await stress.click();
  await page.getByText(/The plan (survives|breaks)/).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await shoot(page, 'stress-light');
  await page.close();

  // 5. Hindi chrome (X10) on the budget view, light theme.
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await seed(page, { hindi: true });
  await page.goto(BASE);
  await shoot(page, 'hindi-light');
  await page.close();

  // 6. Quotation compare with the saved lifecycle (M7).
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await seed(page);
  await page.goto(BASE);
  await page.getByRole('tab', { name: 'Vendors' }).click();
  const compareHeading = page.getByText('Compare saved quotations');
  await compareHeading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await shoot(page, 'quotes-light');
  await page.close();

  // 7. Event-day run sheet (M7).
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await seed(page);
  await page.goto(BASE);
  await page.getByRole('tab', { name: 'Run sheet' }).click();
  await shoot(page, 'runsheet-light');
  await page.close();

  // 8. Mobile All events (R8 on a phone).
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await seed(page);
  await page.goto(BASE);
  await page.getByRole('tab', { name: 'All events' }).click();
  await shoot(page, 'events-mobile');
  await page.close();
} finally {
  await browser.close();
}
