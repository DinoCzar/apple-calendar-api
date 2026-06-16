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
} from './caldav';
import { scheduleSmartEvents } from './scheduler';
import type { RecallResult, SyncResult } from '../types';

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
    errors: [],
  };

  const settings = await getSettings();
  const { start: rangeStart, end: rangeEnd } = getScheduleFetchRange(settings);
  const shouldReschedule = options.reschedule !== false;

  if (shouldReschedule) {
    const recallResult = await runRecall();
    result.smartEventsRecalled = recallResult.smartEventsRecalled;
    result.smartEventsCleared = recallResult.calendarEventsRemoved;
    result.errors.push(...recallResult.errors);
    if (recallResult.errors.length > 0) {
      return result;
    }
  }

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

  const pending = await getPendingSmartEvents();
  const alreadyScheduled = shouldReschedule ? [] : await getScheduledSmartEvents();
  const schedulableEvents = shouldReschedule
    ? (await listSmartEvents()).filter((e) => e.status !== 'completed')
    : pending;

  const slots = scheduleSmartEvents(
    schedulableEvents,
    appleEvents,
    alreadyScheduled,
    settings
  );

  for (const slot of slots) {
    try {
      await markSmartEventScheduled(slot.smartEventId, slot.start, slot.end);
      result.smartEventsScheduled++;

      const event = await getSmartEvent(slot.smartEventId);
      if (!event?.scheduled_start || !event.scheduled_end) {
        result.errors.push(`Failed to load schedule for smart event ${slot.smartEventId}`);
        continue;
      }

      const uid = generateEventUid();
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
        `Failed to sync smart event ${slot.smartEventId}: ${(err as Error).message}`
      );
    }
  }

  return result;
}
