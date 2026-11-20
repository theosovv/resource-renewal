const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MILLISECONDS = 86_400_000;

export function dateOnlyToPrisma(value: string): Date {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error('Date must use YYYY-MM-DD format');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Date must be a valid calendar date');
  }
  return parsed;
}

export function dateOnlyFromPrisma(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Cannot serialize an invalid database date');
  }
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  if (!Number.isSafeInteger(days)) {
    throw new Error('Calendar day offset must be a safe integer');
  }
  const date = dateOnlyToPrisma(value);
  return dateOnlyFromPrisma(new Date(date.getTime() + days * DAY_IN_MILLISECONDS));
}
