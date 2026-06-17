import {
  getPendingSmartEvents,
  getScheduledSmartEvents,
  getSettings,
  getSmartEvent,
  listSmartEvents,
  markSmartEventScheduled,
  markSmartEventSynced,
  resetScheduledSmartEvents,
} from '../db';
import {
  clearSmartEventsCalendar,
  fetchAllBusyEvents,
  generateEventUid,
  getScheduleFetchRange,
  pushSmartEventToCalendar,
  resetCaldavClient,
} from './caldav';
import { scheduleSmartEvents } from './scheduler';
import type { AppSettings, RecallResult, SmartEvent, SyncResult } from '../types';
import { WORKSPACE_IDS, type WorkspaceId } from '../workspace';

const MAX_SCHEDULE_DAYS = 30;

function effectiveScheduleDays(
  settings: AppSettings,
  pendingEvents: SmartEvent[]
): number {
  const configured = settings.schedule_days_ahead;
  const pendingCount = pendingEvents.filter((e) => e.status === 'pending').length;
  if (pendingCount <= 5) return configured;

  return Math.min(
    MAX_SCHEDULE_DAYS,
    Math.max(configured, configured + Math.ceil(pendingCount / 2))
  );
}

async function outputCalendarNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const workspace of WORKSPACE_IDS) {
    const settings = await getSettings(workspace);
    names.add(settings.smart_calendar_name);
  }
  return [...names];
}

async function pushSmartEventWithRetry(params: {
  settings: AppSettings;
  uid: string;
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
}): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        resetCaldavClient();
      }
      await pushSmartEventToCalendar(params);
      return;
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error('Failed to push smart event to Apple Calendar');
}

export async function runRecall(workspace: WorkspaceId): Promise<RecallResult> {
  const result: RecallResult = {
    calendarEventsRemoved: 0,
    smartEventsRecalled: 0,
    errors: [],
  };

  const settings = await getSettings(workspace);
  const scheduled = await getScheduledSmartEvents(workspace);
  result.smartEventsRecalled = scheduled.length;

  try {
    result.calendarEventsRemoved = await clearSmartEventsCalendar(settings);
  } catch (err) {
    result.errors.push(
      `Failed to remove events from ${settings.smart_calendar_name} calendar: ${(err as Error).message}`
    );
    return result;
  }

  try {
    await resetScheduledSmartEvents(workspace);
  } catch (err) {
    result.errors.push(
      `Failed to reset smart events in database: ${(err as Error).message}`
    );
  }

  return result;
}

export async function runFullSync(
  options: { workspace?: WorkspaceId; reschedule?: boolean } = {}
): Promise<SyncResult> {
  const workspace = options.workspace ?? 'smart';
  const result: SyncResult = {
    appleEventsFetched: 0,
    smartEventsRecalled: 0,
    smartEventsCleared: 0,
    smartEventsScheduled: 0,
    smartEventsSynced: 0,
    smartEventsUnscheduled: 0,
    unscheduled_titles: [],
    errors: [],
  };

  const settings = await getSettings(workspace);
  const shouldReschedule = options.reschedule !== false;
  const excludeCalendarNames = await outputCalendarNames();

  if (shouldReschedule) {
    const recallResult = await runRecall(workspace);
    result.smartEventsRecalled = recallResult.smartEventsRecalled;
    result.smartEventsCleared = recallResult.calendarEventsRemoved;
    result.errors.push(...recallResult.errors);
    if (recallResult.errors.length > 0) {
      return result;
    }
  }

  const pending = await getPendingSmartEvents(workspace);
  const schedulableEvents = shouldReschedule
    ? (await listSmartEvents(workspace)).filter((e) => e.status !== 'completed')
    : pending;
  const scheduleDays = effectiveScheduleDays(settings, schedulableEvents);
  const scheduleSettings: AppSettings = {
    ...settings,
    schedule_days_ahead: scheduleDays,
  };
  const { start: rangeStart, end: rangeEnd } =
    getScheduleFetchRange(scheduleSettings);

  let appleEvents = [];
  try {
    appleEvents = await fetchAllBusyEvents(scheduleSettings, rangeStart, rangeEnd, {
      refresh: true,
      excludeCalendarNames,
    });
    result.appleEventsFetched = appleEvents.length;
  } catch (err) {
    result.errors.push(
      `Failed to refresh busy calendar events: ${(err as Error).message}`
    );
    return result;
  }

  const alreadyScheduled = shouldReschedule
    ? []
    : await getScheduledSmartEvents(workspace);

  const { slots, unscheduled } = scheduleSmartEvents(
    schedulableEvents,
    appleEvents,
    alreadyScheduled,
    scheduleSettings
  );

  result.smartEventsUnscheduled = unscheduled.length;
  result.unscheduled_titles = unscheduled.map((event) => event.title);
  if (unscheduled.length > 0) {
    result.errors.push(
      `${unscheduled.length} smart event${unscheduled.length === 1 ? '' : 's'} could not fit in the next ${scheduleDays} day${scheduleDays === 1 ? '' : 's'}: ${result.unscheduled_titles.join(', ')}`
    );
  }

  for (const slot of slots) {
    const event = schedulableEvents.find((item) => item.id === slot.smartEventId);
    const title = event?.title ?? slot.smartEventId;

    try {
      const uid = generateEventUid();
      await markSmartEventScheduled(
        slot.smartEventId,
        workspace,
        slot.start.toISOString(),
        slot.end.toISOString(),
        uid
      );
      result.smartEventsScheduled++;

      const saved = await getSmartEvent(slot.smartEventId, workspace);
      if (!saved?.scheduled_start || !saved.scheduled_end) {
        result.errors.push(`Failed to load schedule for "${title}"`);
        continue;
      }

      await pushSmartEventWithRetry({
        settings,
        uid,
        title: saved.title,
        description: saved.description,
        start: new Date(saved.scheduled_start),
        end: new Date(saved.scheduled_end),
      });
      await markSmartEventSynced(slot.smartEventId, workspace);
      result.smartEventsSynced++;
    } catch (err) {
      result.errors.push(
        `Failed to sync "${title}" to Apple Calendar: ${(err as Error).message}`
      );
    }
  }

  return result;
}
