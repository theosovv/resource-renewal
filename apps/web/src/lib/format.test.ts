import { describe, expect, it } from 'vitest';
import { addCalendarDays, formatDate, formatMoney } from './format';

describe('formatting and date-only calculations', () => {
  it('formats minor units and calendar dates for the reference list', () => {
    expect(formatMoney(128000, 'RUB')).toBe('1 280,00 RUB');
    expect(formatDate('2027-03-01')).toBe('01.03.2027');
  });

  it('adds calendar days without local timezone or DST shifts', () => {
    expect(addCalendarDays('2027-03-01', 30)).toBe('2027-03-31');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addCalendarDays('2027-02-30', 1)).toBeNull();
  });
});
