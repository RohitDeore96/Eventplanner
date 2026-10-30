/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { loadLang, storeLang, translate, LANGS } from '../../src/lib/i18n';
import { makePlan } from '../helpers';

/**
 * X10 acceptance: the chrome speaks Hindi or Marathi on demand, the choice persists, the
 * document language follows for screen readers, and every key in one dictionary exists in
 * all of them — no label may vanish when the language changes.
 */

afterEach(() => {
  localStorage.clear();
});

describe('i18n dictionaries', () => {
  it('every English key is really translated in Hindi and Marathi — no silent fallback', () => {
    for (const key of EN_KEYS) {
      expect(translate('hi', key)).not.toBe(translate('en', key));
      expect(translate('mr', key)).not.toBe(translate('en', key));
    }
  });

  it('falls back to English for unknown keys instead of showing a gap', () => {
    expect(translate('hi', 'no.such.key')).toBe('no.such.key');
  });

  it('the language list labels itself in its own script', () => {
    expect(LANGS.map((l) => l.label)).toEqual(['English', 'हिन्दी', 'मराठी']);
  });
});

describe('language toggle (X10 UI)', () => {
  it('switches the chrome to Hindi, persists the choice, and updates <html lang>', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 2,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        activeId: 'ev1',
        plans: [makePlan({ id: 'ev1', name: 'Asha & Dev wedding' })],
      }),
    );
    const first = render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hi');
    expect(screen.getByRole('tab', { name: 'बजट' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'सभी कार्यक्रम' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'पूर्ववत' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
    expect(localStorage.getItem('utsav.lang.v1')).toBe('hi');
    first.unmount();

    // The stored choice survives a fresh mount (what a reload does).
    const second = render(<App />);
    expect(screen.getByRole('tab', { name: 'बजट' })).toBeInTheDocument();
    second.unmount();
  });

  it('starts in English when nothing is stored and unknown stored values are ignored', () => {
    expect(loadLang()).toBe('en');
    localStorage.setItem('utsav.lang.v1', 'fr');
    expect(loadLang()).toBe('en');
    storeLang('mr');
    expect(loadLang()).toBe('mr');
  });
});

const EN_KEYS: readonly string[] = [
  'tab.events',
  'tab.setup',
  'tab.budget',
  'tab.timeline',
  'tab.guests',
  'tab.vendors',
  'tab.cashflow',
  'tab.activity',
  'tab.assistant',
  'header.undo',
  'header.redo',
  'header.reset',
  'header.exportJson',
  'header.exportCsv',
  'header.loadDemo',
  'header.resetConfirm',
  'header.resetCancel',
  'header.language',
  'readiness.onTrack',
  'readiness.atRisk',
  'readiness.needsAttention',
  'readiness.aria',
  'a11y.skip',
];
