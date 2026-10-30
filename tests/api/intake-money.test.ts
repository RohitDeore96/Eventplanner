import { describe, expect, it } from 'vitest';
import { fallbackIntake, parseMajorAmountLoose } from '../../api/_lib/fallbacks.js';
import { currencyExponent, majorToMinor, parseMajorAmount } from '../../src/engine/money.js';

/**
 * Regression suite for the one monetary-unit contract: readers state amounts in MAJOR
 * units exactly as a human wrote them; conversion to minor units happens exactly once,
 * with the currency's exponent. These cases reproduce CRITICAL DEFECT 1 (₹8,00,000 being
 * read as ₹8,000) and pin the required currency list: INR, USD, EUR, GBP, AED, JPY, KWD.
 */
describe('money: majorToMinor is the single conversion', () => {
  it('converts ₹8 lakh to 80,000,000 paise — the defect case', () => {
    expect(majorToMinor(800000, 'INR')).toBe(80_000_000);
  });

  it('converts ₹8.5 lakh exactly', () => {
    expect(majorToMinor(850000, 'INR')).toBe(85_000_000);
  });

  it('converts ₹2 crore and respects the cap arithmetic', () => {
    expect(majorToMinor(20_000_000, 'INR')).toBe(2_000_000_000);
  });

  it('handles zero-decimal JPY without inventing paise', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(majorToMinor(50000, 'JPY')).toBe(50000);
  });

  it('handles US dollars', () => {
    expect(majorToMinor(10000, 'USD')).toBe(1_000_000);
  });

  it('handles 3-decimal KWD without losing a fils', () => {
    expect(currencyExponent('KWD')).toBe(3);
    expect(majorToMinor(100.125, 'KWD')).toBe(100_125);
    expect(parseMajorAmount('100.125', 'KWD')).toBe(100_125);
    expect(parseMajorAmount('100.1255', 'KWD')).toBeNull(); // more decimals than the exponent
  });

  it('rejects negatives, non-finite values and unknown currencies', () => {
    expect(majorToMinor(-1, 'INR')).toBeNull();
    expect(majorToMinor(Number.NaN, 'INR')).toBeNull();
    expect(majorToMinor(Number.POSITIVE_INFINITY, 'INR')).toBeNull();
    expect(majorToMinor(1000, 'XYZ')).toBeNull();
  });

  it('rejects amounts over the engine cap', () => {
    expect(majorToMinor(1_000_000_000_001, 'JPY')).toBeNull();
  });

  it('keeps parseMajorAmount (typed form input) on the same contract', () => {
    expect(parseMajorAmount('800000', 'INR')).toBe(80_000_000);
    expect(parseMajorAmount('800000.50', 'INR')).toBe(80_000_050);
    expect(parseMajorAmount('50000', 'JPY')).toBe(50000);
    expect(parseMajorAmount('800000.555', 'INR')).toBeNull(); // more decimals than the exponent
  });

  it('accepts Indian comma grouping in the typed form (M1: one canonical path)', () => {
    expect(parseMajorAmount('8,00,000', 'INR')).toBe(80_000_000);
    expect(parseMajorAmount('80,000', 'INR')).toBe(8_000_000);
    expect(parseMajorAmount('1,23,456.78', 'INR')).toBe(12_345_678);
    expect(parseMajorAmount('1,000', 'INR')).toBe(100_000);
    // Commas must sit between digits: leading, trailing and doubled commas stay invalid.
    expect(parseMajorAmount(',800', 'INR')).toBeNull();
    expect(parseMajorAmount('800,', 'INR')).toBeNull();
    expect(parseMajorAmount('8,,00', 'INR')).toBeNull();
  });
});

describe('intake fallback: the amount reader returns MAJOR units', () => {
  it('reads "8 lakh"', () => {
    expect(parseMajorAmountLoose('Shaadi in Pune, 200 guests, 8 lakh budget')).toBe(800000);
  });

  it('reads "8.5 lakh"', () => {
    expect(parseMajorAmountLoose('budget 8.5 lakh')).toBe(850000);
  });

  it('reads Indian grouping "8,00,000" and "₹80,000"', () => {
    expect(parseMajorAmountLoose('total 8,00,000 please')).toBe(800000);
    expect(parseMajorAmountLoose('₹80,000 for everything')).toBe(80000);
  });

  it('reads "2 crore"', () => {
    expect(parseMajorAmountLoose('budget is 2 crore')).toBe(20_000_000);
  });

  it('reads plain 4+ digit amounts', () => {
    expect(parseMajorAmountLoose('we have 450000 to spend')).toBe(450000);
  });

  it('never reads the guest count or a date as the budget', () => {
    expect(parseMajorAmountLoose('200 guests on 2026-12-10')).toBeNull();
    expect(fallbackIntake('200 guests on 2026-12-10').budgetMinor).toBeNull();
  });

  it('returns null for invalid or ambiguous amounts', () => {
    expect(parseMajorAmountLoose('budget whatever')).toBeNull();
    expect(parseMajorAmountLoose('small budget of abc lakh')).toBeNull();
    expect(parseMajorAmountLoose('')).toBeNull();
  });

  it('does not read amounts under 1000 as budgets', () => {
    expect(parseMajorAmountLoose('200 guests coming')).toBeNull();
  });

  it('reads a decimal-fraction amount from 100 up so 3-decimal currencies work', () => {
    expect(parseMajorAmountLoose('Total KWD 100.125')).toBe(100.125);
    expect(fallbackIntake('Total KWD 100.125', 'KWD').budgetMinor).toBe(100_125);
    expect(parseMajorAmountLoose('party of 40.5 people')).toBeNull();
  });
});

describe('fallbackIntake: end-to-end minor-unit contract per currency', () => {
  it('₹8 lakh becomes exactly ₹8,00,000 in minor units (INR default)', () => {
    const parsed = fallbackIntake('Shaadi in Pune, 200 guests, 8 lakh budget');
    expect(parsed.budgetMinor).toBe(80_000_000);
    expect(parsed.occasion).toBe('wedding');
    expect(parsed.guests).toBe(200);
  });

  it('USD request converts with the dollar exponent', () => {
    const parsed = fallbackIntake('Party for 40 guests, budget 10000', 'USD');
    expect(parsed.budgetMinor).toBe(1_000_000);
  });

  it('JPY request has no paise-style multiplication', () => {
    const parsed = fallbackIntake('Party for 30 guests, budget 50000', 'JPY');
    expect(parsed.budgetMinor).toBe(50000);
  });

  it('an unstated budget stays null instead of being guessed', () => {
    expect(fallbackIntake('wedding in Pune next february').budgetMinor).toBeNull();
  });
});

describe('milestone occasion detection in intake', () => {
  it('detects anniversaries, retirement and jubilees as milestone occasions', () => {
    expect(fallbackIntake('Silver jubilee party for 80 people').occasion).toBe('milestone');
    expect(fallbackIntake('retirement celebration next march').occasion).toBe('milestone');
    expect(fallbackIntake('graduation party at home').occasion).toBe('milestone');
    expect(fallbackIntake('shaadi in pune').occasion).toBe('wedding');
  });
});
