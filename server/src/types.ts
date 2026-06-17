export interface SmartEvent {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  priority: number;
  status: SmartEventStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  apple_event_uid: string | null;
  repeat_days_of_week: number[] | null;
  created_at: string;
  updated_at: string;
}

export type SmartEventStatus = 'pending' | 'scheduled' | 'synced' | 'completed';

export interface CreateSmartEventInput {
  title: string;
  description?: string;
  duration_minutes?: number;
  priority?: number;
  repeat_days_of_week?: number[];
}

export interface UpdateSmartEventInput {
  title?: string;
  description?: string | null;
  duration_minutes?: number;
  priority?: number;
  status?: SmartEventStatus;
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
}

export interface CalendarEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  lastModified?: Date;
  isRecurrenceInstance?: boolean;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface ScheduledSlot {
  smartEventId: string;
  start: Date;
  end: Date;
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

export type { WorkspaceId } from './workspace';
export { WORKSPACE_IDS } from './workspace';
