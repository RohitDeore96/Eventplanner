import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Token-level WCAG contrast gate (A1): parses the REAL tokens.css and asserts every
 * text/background pair the UI uses reaches 4.5:1 (3:1 for large text and borders) in BOTH
 * themes. Changing a token without re-checking contrast fails the build.
 */

interface Theme {
  readonly name: string;
  readonly vars: Readonly<Record<string, string>>;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) throw new Error(`unsupported colour: ${hex}`);
  const value = Number.parseInt(clean, 16);
  const tuple: [number, number, number] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return tuple;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function parseThemes(css: string): Theme[] {
  const themes: Theme[] = [];
  const light = /:root\s*\{([^}]*)\}/.exec(css);
  if (light?.[1] === undefined) throw new Error('light theme block not found');
  const dark = /:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(css);
  if (dark?.[1] === undefined) throw new Error('dark theme block not found');
  themes.push({ name: 'light', vars: parseVars(light[1]) });
  themes.push({ name: 'dark', vars: parseVars(dark[1]) });
  return themes;
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const match of block.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    vars[match[1] ?? ''] = match[2] ?? '';
  }
  return vars;
}

const css = readFileSync(
  fileURLToPath(new URL('../../src/ui/tokens.css', import.meta.url)),
  'utf8',
);
const themes = parseThemes(css);

/** [foreground, background, minimum ratio, why] */
const PAIRS: readonly [string, string, number, string][] = [
  ['--text', '--bg', 4.5, 'body text on page'],
  ['--text', '--surface', 4.5, 'body text on cards'],
  ['--text-muted', '--bg', 4.5, 'secondary text on page'],
  ['--text-muted', '--surface', 4.5, 'secondary text on cards'],
  ['--primary', '--bg', 4.5, 'links and primary text on page'],
  ['--primary-text', '--primary', 4.5, 'text on primary buttons'],
  ['--on-accent', '--accent-saffron', 4.5, 'dark text on saffron fills'],
  ['--on-accent', '--marigold', 4.5, 'dark text on marigold fills'],
  ['--on-danger', '--danger', 4.5, 'text on error badges'],
  ['--on-maroon', '--maroon', 4.5, 'header text'],
  ['--on-success', '--success', 4.5, 'text on success badges'],
  ['--danger', '--bg', 4.5, 'error text on page'],
  ['--success', '--bg', 4.5, 'success text on page'],
  ['--border', '--bg', 3, 'visible UI borders'],
  ['--border', '--surface', 3, 'borders on cards'],
  ['--focus', '--bg', 3, 'focus ring against page'],
];

describe('design tokens meet WCAG contrast in both themes', () => {
  for (const theme of themes) {
    describe(`theme: ${theme.name}`, () => {
      for (const [fg, bg, min, why] of PAIRS) {
        it(`${why}: ${fg} on ${bg} >= ${min}:1`, () => {
          const foreground = theme.vars[fg];
          const background = theme.vars[bg];
          expect(foreground, `${fg} must exist in ${theme.name}`).toBeDefined();
          expect(background, `${bg} must exist in ${theme.name}`).toBeDefined();
          const ratio = contrastRatio(foreground ?? '', background ?? '');
          expect(ratio).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }

  it('saffron is never a text colour on light backgrounds (spec rule)', () => {
    const light = themes[0]?.vars ?? {};
    expect(contrastRatio(light['--accent-saffron'] ?? '', light['--bg'] ?? '')).toBeLessThan(4.5);
  });
});
