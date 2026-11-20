import { describe, expect, it } from 'vitest';
import { addCalendarDays, dateOnlyFromPrisma, dateOnlyToPrisma } from './date-only.js';

describe('date-only Prisma adapters', () => {
  it.each([
    ['2027-03-01', '2027-03-31'],
    ['2027-01-31', '2027-03-02'],
    ['2028-02-29', '2028-03-30'],
  ])('adds 30 UTC calendar days to %s', (value, expected) => {
    expect(addCalendarDays(value, 30)).toBe(expected);
  });

  it('round-trips an exact calendar date', () => {
    const value = dateOnlyToPrisma('2027-05-20');
    expect(value.toISOString()).toBe('2027-05-20T00:00:00.000Z');
    expect(dateOnlyFromPrisma(value)).toBe('2027-05-20');
  });

  it('rejects impossible dates', () => {
    expect(() => dateOnlyToPrisma('2027-02-29')).toThrow('valid calendar date');
  });
});
