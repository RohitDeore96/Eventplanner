// One-off probe: which elements overflow the page horizontally at 320 px on Budget?
// Usage: node scripts/probe-reflow.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const server = spawn('npx', ['vite', 'preview', '--port', '4199', '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
await page.goto('http://localhost:4199/');
await page.getByLabel('Event name').fill('Reflow probe');
await page.getByLabel('Event date').fill('2027-02-20');
await page.getByLabel('Expected guests').fill('150');
await page.getByLabel(/Total budget in/).fill('800000');
await page.getByRole('button', { name: 'Create the plan' }).click();
await page.getByRole('tab', { name: 'Budget' }).click();
await page.waitForTimeout(400);
const offenders = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 8) {
      const chain = [];
      let node = el;
      while (node !== null && node !== document.body) {
        chain.push(`${node.tagName}.${String(node.className).slice(0, 40)}`);
        node = node.parentElement;
      }
      out.push({
        el: `${el.tagName}.${String(el.className).slice(0, 40)}`,
        right: Math.round(r.right),
        width: Math.round(r.width),
        chain: chain.slice(0, 6).join(' < '),
      });
    }
  }
  // Sort widest-first; the page-level overflow source is at the top.
  out.sort((a, b) => b.right - a.right);
  const nonTable = out.filter(
    (o) => !['THEAD', 'TBODY', 'TR', 'TH', 'TD', 'TABLE'].includes(o.el.split('.')[0]),
  );
  return { vw, out: nonTable };
});
console.log(JSON.stringify(offenders, null, 2));
const scrollSources = await page.evaluate(() => {
  const doc = document.documentElement;
  const sources = [];
  for (const el of document.querySelectorAll('body, body *')) {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' || cs.overflowX === 'clip') continue; // propagates up
      sources.push({
        el: `${el.tagName}.${String(el.className).slice(0, 40)}`,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: cs.overflowX,
      });
    }
  }
  return {
    docScrollWidth: doc.scrollWidth,
    docClientWidth: doc.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    sources: sources.slice(0, 15),
  };
});
console.log(JSON.stringify(scrollSources, null, 2));
const bisect = await page.evaluate(() => {
  const doc = document.documentElement;
  const steps = [];
  const measure = () => doc.scrollWidth;
  steps.push({ step: 'initial', w: measure() });
  const tables = document.querySelectorAll('table');
  tables.forEach((t) => {
    t.style.display = 'none';
  });
  steps.push({ step: 'tables hidden', w: measure() });
  tables.forEach((t) => {
    t.style.display = '';
  });
  const cards = document.querySelectorAll('section.card');
  const hidden = [];
  for (const card of cards) {
    card.style.display = 'none';
    hidden.push(card);
    if (measure() <= doc.clientWidth + 1) {
      steps.push({ step: 'after hiding card ' + (hidden.length - 1), w: measure() });
      const label = card.querySelector('h2,h3');
      steps.push({ step: 'card title: ' + (label ? label.textContent : '?'), w: measure() });
      break;
    }
  }
  hidden.forEach((c) => {
    c.style.display = '';
  });
  return steps;
});
console.log(JSON.stringify(bisect, null, 1));
await browser.close();
server.kill();
