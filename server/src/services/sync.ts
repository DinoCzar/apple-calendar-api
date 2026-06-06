import {
  getPendingSmartEvents,
  getScheduledSmartEvents,
  getSettings,
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
} from './caldav';
import { scheduleSmartEvents } from './scheduler';
import type { RecallResult, SyncResult } from '../types';

export async function runFullSync(
  options: { reschedule?: boolean } = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    appleEventsFetched: 0,
    smartEventsCleared: 0,
    smartEventsScheduled: 0,
    smartEventsSynced: 0,
    errors: [],
  };

  const settings = await getSettings();
  const { start: rangeStart, end: rangeEnd } = getScheduleFetchRange(settings);

  let appleEvents = [];
  try {
    appleEvents = await fetchAllBusyEvents(settings, rangeStart, rangeEnd, {
      refresh: true,
    });
    result.appleEventsFetched = appleEvents.length;
  } catch (err) {
    result.errors.push(`Failed to fetch calendar events: ${(err as Error).message}`);
    return result;
  }

  const shouldReschedule = options.reschedule !== false;

  if (shouldReschedule) {
    try {
      result.smartEventsCleared = await clearSmartEventsCalendar(settings);
    } catch (err) {
      result.errors.push(
        `Failed to clear old events from Smart Events calendar: ${(err as Error).message}`
      );
    }
    await resetScheduledSmartEvents();
  }

  const pending = await getPendingSmartEvents();
  const alreadyScheduled = shouldReschedule ? [] : await getScheduledSmartEvents();

  const slots = scheduleSmartEvents(
    pending,
    appleEvents,
    alreadyScheduled,
    settings
  );

  for (const slot of slots) {
    try {
      await markSmartEventScheduled(slot.smartEventId, slot.start, slot.end);
      result.smartEventsScheduled++;
    } catch (err) {
      result.errors.push(
        `Failed to save schedule for ${slot.smartEventId}: ${(err as Error).message}`
      );
    }
  }

  const toSync = await getScheduledSmartEvents();
  const unsynced = toSync.filter((e) => e.status === 'scheduled');

  for (const event of unsynced) {
    if (!event.scheduled_start || !event.scheduled_end) continue;

    const uid = generateEventUid();
    try {
      await pushSmartEventToCalendar({
        settings,
        uid,
        title: event.title,
        description: event.description,
        start: new Date(event.scheduled_start),
        end: new Date(event.scheduled_end),
      });
      await markSmartEventSynced(event.id, uid);
      result.smartEventsSynced++;
    } catch (err) {
      result.errors.push(
        `Failed to sync "${event.title}" to Apple Calendar: ${(err as Error).message}`
      );
    }
  }

  return result;
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
