import type { JobStatus, RequestStatus } from '../api/client';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

const numberFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const requestStatusLabels: Record<RequestStatus, string> = {
  PENDING_APPROVAL: 'На согласовании',
  REJECTED: 'Отклонена',
  PROCESSING: 'Выполняется',
  COMPLETED: 'Завершена',
  NEEDS_ATTENTION: 'Требует внимания',
};

export const jobStatusLabels: Record<JobStatus, string> = {
  PENDING: 'Ожидает обработки',
  RUNNING: 'Выполняется worker',
  WAITING_MANUAL: 'Ожидает ручного повтора',
  SUCCEEDED: 'Задача завершена',
};

export function formatDate(value: string): string {
  const parsed = parseDateOnly(value);
  return parsed ? dateFormatter.format(parsed) : value;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormatter.format(parsed);
}

export function formatMoney(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor)) {
    return 'Некорректная сумма';
  }
  return `${numberFormatter.format(amountMinor / 100)} ${currency}`;
}

export function addCalendarDays(value: string, days: number): string | null {
  const parsed = parseDateOnly(value);
  if (!parsed || !Number.isInteger(days)) {
    return null;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}
