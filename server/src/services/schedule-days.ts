import type { AppSettings } from '../types';

export const ALL_SCHEDULE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getWeekdayInTimezone(date: Date, timezone: string): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date);
  return WEEKDAY_TO_INDEX[label] ?? 0;
}

export function parseScheduleDaysOfWeek(value: string | undefined): number[] {
  if (!value) return [...ALL_SCHEDULE_WEEKDAYS];

  const parsed = value
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter((day) => day >= 0 && day <= 6);

  return parsed.length > 0
    ? [...new Set(parsed)].sort((a, b) => a - b)
    : [...ALL_SCHEDULE_WEEKDAYS];
}

export function formatScheduleDaysOfWeek(days: number[]): string {
  const normalized = [...new Set(days.filter((day) => day >= 0 && day <= 6))].sort(
    (a, b) => a - b
  );
  return normalized.length > 0
    ? normalized.join(',')
    : ALL_SCHEDULE_WEEKDAYS.join(',');
}

export function isSchedulableDay(day: Date, settings: AppSettings): boolean {
  const allowed = settings.schedule_days_of_week;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(getWeekdayInTimezone(day, settings.timezone));
}
