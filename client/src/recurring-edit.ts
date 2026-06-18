import type { SmartEvent } from './types';

export interface RecurringEventUpdate {
  title: string;
  description: string | null;
  duration_minutes: number;
  repeat_days_of_week: number[];
  repeat_time_of_day: string;
}

export function toRecurringEventUpdate(event: SmartEvent): RecurringEventUpdate {
  return {
    title: event.title,
    description: event.description,
    duration_minutes: event.duration_minutes,
    repeat_days_of_week: event.repeat_days_of_week ?? [],
    repeat_time_of_day: event.repeat_time_of_day ?? '09:00',
  };
}

export function normalizeRecurringEventUpdate(
  draft: RecurringEventUpdate
): RecurringEventUpdate {
  return {
    title: draft.title.trim(),
    description: draft.description?.trim() || null,
    duration_minutes: draft.duration_minutes,
    repeat_days_of_week: [...new Set(draft.repeat_days_of_week)]
      .filter((day) => day >= 0 && day <= 6)
      .sort((a, b) => a - b),
    repeat_time_of_day: draft.repeat_time_of_day,
  };
}
