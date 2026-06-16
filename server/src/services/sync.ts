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

export async function runRecall(): Promise<RecallResult> {
  const result: RecallResult = {
    calendarEventsRemoved: 0,
    smartEventsRecalled: 0,
    errors: [],
  };

  const settings = await getSettings();
  const scheduled = await getScheduledSmartEvents();
  result.smartEventsRecalled = scheduled.length;

  try {
    result.calendarEventsRemoved = await clearSmartEventsCalendar(settings);
  } catch (err) {
    result.errors.push(
      `Failed to remove events from Smart Events calendar: ${(err as Error).message}`
    );
    return result;
  }

  try {
    await resetScheduledSmartEvents();
  } catch (err) {
    result.errors.push(
      `Failed to reset smart events in database: ${(err as Error).message}`
    );
  }

  return result;
}

export async function runFullSync(
  options: { reschedule?: boolean } = {}
): Promise<SyncResult> {
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

  const settings = await getSettings();
  const shouldReschedule = options.reschedule !== false;

  if (shouldReschedule) {
    const recallResult = await runRecall();
    result.smartEventsRecalled = recallResult.smartEventsRecalled;
    result.smartEventsCleared = recallResult.calendarEventsRemoved;
    result.errors.push(...recallResult.errors);
    if (recallResult.errors.length > 0) {
      return result;
    }

    await resetScheduledSmartEvents();
  }

  const pending = await getPendingSmartEvents();
  const schedulableEvents = shouldReschedule
    ? (await listSmartEvents()).filter((e) => e.status !== 'completed')
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
    appleEvents = await fetchAllBusyEvents(settings, rangeStart, rangeEnd, {
      refresh: true,
    });
    result.appleEventsFetched = appleEvents.length;
  } catch (err) {
    result.errors.push(
      `Failed to refresh busy calendar events: ${(err as Error).message}`
    );
    return result;
  }

  const alreadyScheduled = shouldReschedule ? [] : await getScheduledSmartEvents();

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
      await markSmartEventScheduled(slot.smartEventId, slot.start, slot.end);
      result.smartEventsScheduled++;

      const saved = await getSmartEvent(slot.smartEventId);
      if (!saved?.scheduled_start || !saved.scheduled_end) {
        result.errors.push(`Failed to load schedule for "${title}"`);
        continue;
      }

      const uid = generateEventUid();
      await pushSmartEventWithRetry({
        settings,
        uid,
        title: saved.title,
        description: saved.description,
        start: new Date(saved.scheduled_start),
        end: new Date(saved.scheduled_end),
      });
      await markSmartEventSynced(saved.id, uid);
      result.smartEventsSynced++;
    } catch (err) {
      result.errors.push(
        `Failed to sync "${title}" to Apple Calendar: ${(err as Error).message}`
      );
    }
  }

  return result;
}
