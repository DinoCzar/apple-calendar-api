export interface SmartEvent {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  priority: number;
  status: 'pending' | 'scheduled' | 'synced' | 'completed';
  scheduled_start: string | null;
  scheduled_end: string | null;
  apple_event_uid: string | null;
  repeat_days_of_week: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  apple_calendar_name: string;
  smart_calendar_name: string;
  working_hours_start: string;
  working_hours_end: string;
  schedule_days_ahead: number;
  min_gap_minutes: number;
  timezone: string;
  schedule_start_use_default: boolean;
  schedule_start_date: string | null;
  schedule_days_of_week: number[];
  icloud_configured?: boolean;
}

export type PersistedAppSettings = Omit<AppSettings, 'icloud_configured'>;

export function toPersistedSettings(
  settings: Partial<AppSettings>
): Partial<PersistedAppSettings> {
  const {
    apple_calendar_name,
    smart_calendar_name,
    working_hours_start,
    working_hours_end,
    schedule_days_ahead,
    min_gap_minutes,
    timezone,
    schedule_start_use_default,
    schedule_start_date,
    schedule_days_of_week,
  } = settings;

  return {
    ...(apple_calendar_name !== undefined ? { apple_calendar_name } : {}),
    ...(smart_calendar_name !== undefined ? { smart_calendar_name } : {}),
    ...(working_hours_start !== undefined ? { working_hours_start } : {}),
    ...(working_hours_end !== undefined ? { working_hours_end } : {}),
    ...(schedule_days_ahead !== undefined ? { schedule_days_ahead } : {}),
    ...(min_gap_minutes !== undefined ? { min_gap_minutes } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(schedule_start_use_default !== undefined
      ? { schedule_start_use_default }
      : {}),
    ...(schedule_start_date !== undefined ? { schedule_start_date } : {}),
    ...(schedule_days_of_week !== undefined
      ? { schedule_days_of_week }
      : {}),
  };
}

export interface SyncResult {
  appleEventsFetched: number;
  smartEventsRecalled: number;
  smartEventsCleared: number;
  smartEventsScheduled: number;
  smartEventsSynced: number;
  smartEventsUnscheduled: number;
  unscheduled_titles: string[];
  errors: string[];
}

export interface RecallResult {
  calendarEventsRemoved: number;
  smartEventsRecalled: number;
  errors: string[];
}

export interface AppleEventPreview {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
}
