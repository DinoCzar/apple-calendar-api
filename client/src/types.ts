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
  icloud_configured?: boolean;
}

export interface SyncResult {
  appleEventsFetched: number;
  smartEventsCleared: number;
  smartEventsScheduled: number;
  smartEventsSynced: number;
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
