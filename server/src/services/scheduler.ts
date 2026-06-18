import type {
  AppSettings,
  CalendarEvent,
  ScheduledSlot,
  SmartEvent,
  TimeSlot,
} from '../types';
import {
  getScheduleEarliestInstant,
  getScheduleRangeStart,
} from './caldav';
import {
  getWeekdayInTimezone,
  isSchedulableDay,
} from './schedule-days';

function partsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const { year, month, day } = partsInTimezone(date, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function makeDateInTimezone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const actual = partsInTimezone(new Date(utc), timezone);
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actualMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0
    );
    const delta = desiredMs - actualMs;
    if (delta === 0) break;
    utc += delta;
  }

  return new Date(utc);
}

function parseTimeOnDate(date: Date, timeStr: string, timezone: string): Date {
  const dateStr = formatDateInTimezone(date, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return makeDateInTimezone(year, month, day, hour, minute, timezone);
}

function startOfDayInTimezone(date: Date, timezone: string): Date {
  return parseTimeOnDate(date, '00:00', timezone);
}

function addDaysInTimezone(date: Date, days: number, timezone: string): Date {
  const dateStr = formatDateInTimezone(date, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  return makeDateInTimezone(year, month, day + days, 12, 0, timezone);
}

function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return a.start < b.end && a.end > b.start;
}

function mergeBusySlots(slots: TimeSlot[], gapMs: number): TimeSlot[] {
  if (slots.length === 0) return [];

  const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeSlot[] = [{ start: sorted[0].start, end: sorted[0].end }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start.getTime() <= last.end.getTime() + gapMs) {
      last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
}

function calendarEventsToBusySlots(
  events: CalendarEvent[],
  settings: AppSettings
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  for (const event of events) {
    if (event.allDay) {
      let day = startOfDayInTimezone(event.start, settings.timezone);
      const endDay = startOfDayInTimezone(event.end, settings.timezone);

      while (day < endDay) {
        slots.push({
          start: parseTimeOnDate(day, settings.working_hours_start, settings.timezone),
          end: parseTimeOnDate(day, settings.working_hours_end, settings.timezone),
        });
        day = addDaysInTimezone(day, 1, settings.timezone);
      }
      continue;
    }

    slots.push({ start: event.start, end: event.end });
  }

  return slots;
}

function indexBusySlotsByDay(
  slots: TimeSlot[],
  rangeStart: Date,
  days: number,
  timezone: string
): Map<string, TimeSlot[]> {
  const busyByDay = new Map<string, TimeSlot[]>();

  for (let d = 0; d < days; d++) {
    const day = addDaysInTimezone(rangeStart, d, timezone);
    busyByDay.set(formatDateInTimezone(day, timezone), []);
  }

  for (const slot of slots) {
    for (let d = 0; d < days; d++) {
      const day = addDaysInTimezone(rangeStart, d, timezone);
      const dayKey = formatDateInTimezone(day, timezone);
      const dayStart = startOfDayInTimezone(day, timezone);
      const nextDayStart = addDaysInTimezone(day, 1, timezone);

      if (slot.end > dayStart && slot.start < nextDayStart) {
        busyByDay.get(dayKey)!.push(slot);
      }
    }
  }

  return busyByDay;
}

function findFreeSlotsForDay(
  day: Date,
  settings: AppSettings,
  busySlots: TimeSlot[]
): TimeSlot[] {
  const dayStart = parseTimeOnDate(day, settings.working_hours_start, settings.timezone);
  const dayEnd = parseTimeOnDate(day, settings.working_hours_end, settings.timezone);

  if (dayEnd <= dayStart) return [];

  const gapMs = settings.min_gap_minutes * 60 * 1000;
  const mergedBusy = mergeBusySlots(
    busySlots.filter((s) => s.end > dayStart && s.start < dayEnd),
    gapMs
  );

  const free: TimeSlot[] = [];
  let cursor = dayStart;

  for (const busy of mergedBusy) {
    const busyStart = new Date(Math.max(busy.start.getTime(), dayStart.getTime()));
    const busyEnd = new Date(Math.min(busy.end.getTime(), dayEnd.getTime()));

    if (busyStart > cursor) {
      free.push({ start: new Date(cursor), end: busyStart });
    }

    cursor = new Date(Math.max(cursor.getTime(), busyEnd.getTime() + gapMs));
  }

  if (cursor < dayEnd) {
    free.push({ start: cursor, end: dayEnd });
  }

  return free;
}

function canPlaceWithoutOverlap(
  candidate: TimeSlot,
  busySlots: TimeSlot[],
  gapMs: number
): boolean {
  return !busySlots.some((busy) => {
    const bufferedBusy: TimeSlot = {
      start: new Date(busy.start.getTime() - gapMs),
      end: new Date(busy.end.getTime() + gapMs),
    };
    return overlaps(candidate, bufferedBusy);
  });
}

function applyClockTime(fromDay: Date, reference: Date, timezone: string): Date {
  const { hour, minute } = partsInTimezone(reference, timezone);
  const dateStr = formatDateInTimezone(fromDay, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  return makeDateInTimezone(year, month, day, hour, minute, timezone);
}

function getRecurringEarliestOnDay(
  day: Date,
  now: Date,
  timezone: string
): Date {
  if (formatDateInTimezone(day, timezone) === formatDateInTimezone(now, timezone)) {
    return now;
  }
  return startOfDayInTimezone(day, timezone);
}

function findFreeSlotsForFullDay(
  day: Date,
  timezone: string,
  busySlots: TimeSlot[],
  gapMs: number
): TimeSlot[] {
  const dayStart = startOfDayInTimezone(day, timezone);
  const dayEnd = addDaysInTimezone(day, 1, timezone);

  if (dayEnd <= dayStart) return [];

  const mergedBusy = mergeBusySlots(
    busySlots.filter((s) => s.end > dayStart && s.start < dayEnd),
    gapMs
  );

  const free: TimeSlot[] = [];
  let cursor = dayStart;

  for (const busy of mergedBusy) {
    const busyStart = new Date(Math.max(busy.start.getTime(), dayStart.getTime()));
    const busyEnd = new Date(Math.min(busy.end.getTime(), dayEnd.getTime()));

    if (busyStart > cursor) {
      free.push({ start: new Date(cursor), end: busyStart });
    }

    cursor = new Date(Math.max(cursor.getTime(), busyEnd.getTime() + gapMs));
  }

  if (cursor < dayEnd) {
    free.push({ start: cursor, end: dayEnd });
  }

  return free;
}

function recurringPatternIsFree(
  anchorStart: Date,
  durationMs: number,
  repeatDays: number[],
  rangeStart: Date,
  rangeEnd: Date,
  placedSlots: TimeSlot[],
  settings: AppSettings,
  gapMs: number
): boolean {
  const timezone = settings.timezone;
  let day = startOfDayInTimezone(rangeStart, timezone);

  while (day <= rangeEnd) {
    const weekday = getWeekdayInTimezone(day, timezone);
    if (repeatDays.includes(weekday)) {
      const start = applyClockTime(day, anchorStart, timezone);
      const end = new Date(start.getTime() + durationMs);
      const candidate = { start, end };
      if (!canPlaceWithoutOverlap(candidate, placedSlots, gapMs)) {
        return false;
      }
    }

    day = addDaysInTimezone(day, 1, timezone);
  }

  return true;
}

function tryPlaceRecurringEventAtFixedTime(
  event: SmartEvent,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
  placedSlots: TimeSlot[],
  settings: AppSettings,
  gapMs: number
): TimeSlot | null {
  const repeatDays = event.repeat_days_of_week ?? [];
  const repeatTime = event.repeat_time_of_day;
  if (repeatDays.length === 0 || !repeatTime?.match(/^\d{2}:\d{2}$/)) {
    return null;
  }

  const timezone = settings.timezone;
  const durationMs = event.duration_minutes * 60 * 1000;

  for (let d = 0; d < settings.schedule_days_ahead; d++) {
    const day = addDaysInTimezone(rangeStart, d, timezone);
    if (!repeatDays.includes(getWeekdayInTimezone(day, timezone))) continue;

    const start = parseTimeOnDate(day, repeatTime, timezone);
    const earliest = getRecurringEarliestOnDay(day, now, timezone);
    if (start < earliest) continue;

    const end = new Date(start.getTime() + durationMs);

    if (
      recurringPatternIsFree(
        start,
        durationMs,
        repeatDays,
        rangeStart,
        rangeEnd,
        placedSlots,
        settings,
        gapMs
      )
    ) {
      return { start, end };
    }
  }

  return null;
}

function tryPlaceRecurringEvent(
  event: SmartEvent,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
  placedSlots: TimeSlot[],
  settings: AppSettings,
  gapMs: number
): TimeSlot | null {
  const repeatDays = event.repeat_days_of_week ?? [];
  if (repeatDays.length === 0) return null;

  if (event.repeat_time_of_day?.match(/^\d{2}:\d{2}$/)) {
    return tryPlaceRecurringEventAtFixedTime(
      event,
      rangeStart,
      rangeEnd,
      now,
      placedSlots,
      settings,
      gapMs
    );
  }

  const durationMs = event.duration_minutes * 60 * 1000;

  for (let d = 0; d < settings.schedule_days_ahead; d++) {
    const day = addDaysInTimezone(rangeStart, d, settings.timezone);
    if (!repeatDays.includes(getWeekdayInTimezone(day, settings.timezone))) {
      continue;
    }

    const freeSlots = findFreeSlotsForFullDay(
      day,
      settings.timezone,
      placedSlots,
      gapMs
    );
    const earliest = getRecurringEarliestOnDay(day, now, settings.timezone);

    for (const free of freeSlots) {
      let slotCursor = new Date(Math.max(free.start.getTime(), earliest.getTime()));
      if (
        formatDateInTimezone(day, settings.timezone) ===
        formatDateInTimezone(now, settings.timezone)
      ) {
        slotCursor = new Date(
          Math.max(slotCursor.getTime(), earliest.getTime() + gapMs)
        );
      }

      while (slotCursor.getTime() + durationMs <= free.end.getTime()) {
        const candidateEnd = new Date(slotCursor.getTime() + durationMs);
        if (
          recurringPatternIsFree(
            slotCursor,
            durationMs,
            repeatDays,
            rangeStart,
            rangeEnd,
            placedSlots,
            settings,
            gapMs
          )
        ) {
          return { start: new Date(slotCursor), end: candidateEnd };
        }

        slotCursor = new Date(slotCursor.getTime() + 15 * 60 * 1000);
      }
    }
  }

  return null;
}

export interface ScheduleResult {
  slots: ScheduledSlot[];
  unscheduled: { id: string; title: string }[];
}

export function scheduleSmartEvents(
  smartEvents: SmartEvent[],
  calendarEvents: CalendarEvent[],
  alreadyScheduled: SmartEvent[],
  settings: AppSettings
): ScheduleResult {
  const pending = [...smartEvents]
    .filter((e) => e.status === 'pending')
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));

  if (pending.length === 0) {
    return { slots: [], unscheduled: [] };
  }

  const now = new Date();
  const rangeStart = getScheduleRangeStart(settings, now);
  const rangeEnd = addDaysInTimezone(
    rangeStart,
    settings.schedule_days_ahead,
    settings.timezone
  );
  const gapMs = settings.min_gap_minutes * 60 * 1000;

  const allBusy: TimeSlot[] = [
    ...calendarEventsToBusySlots(calendarEvents, settings),
    ...alreadyScheduled
      .filter((e) => e.scheduled_start && e.scheduled_end)
      .map((e) => ({
        start: new Date(e.scheduled_start!),
        end: new Date(e.scheduled_end!),
      })),
  ];

  const busyByDay = indexBusySlotsByDay(
    allBusy,
    rangeStart,
    settings.schedule_days_ahead,
    settings.timezone
  );

  const scheduled: ScheduledSlot[] = [];
  const placedSlots: TimeSlot[] = [];
  const unscheduled: { id: string; title: string }[] = [];

  while (pending.length > 0) {
    const pendingBefore = pending.length;
    const event = pending[0];

    if (event.repeat_days_of_week?.length) {
      const slot = tryPlaceRecurringEvent(
        event,
        rangeStart,
        rangeEnd,
        now,
        placedSlots,
        settings,
        gapMs
      );

      if (slot) {
        scheduled.push({
          smartEventId: event.id,
          start: slot.start,
          end: slot.end,
        });
        placedSlots.push(slot);
        pending.shift();
      } else if (pending.length === pendingBefore) {
        const skipped = pending.shift();
        if (skipped) {
          unscheduled.push({ id: skipped.id, title: skipped.title });
        }
      }
      continue;
    }

    for (let d = 0; d < settings.schedule_days_ahead; d++) {
      const day = addDaysInTimezone(rangeStart, d, settings.timezone);
      if (!isSchedulableDay(day, settings)) continue;

      const dayKey = formatDateInTimezone(day, settings.timezone);
      const dayBusy = [...(busyByDay.get(dayKey) || []), ...placedSlots];
      const freeSlots = findFreeSlotsForDay(day, settings, dayBusy);

      for (const free of freeSlots) {
        let slotCursor = free.start;
        const earliest = getScheduleEarliestInstant(settings, day, now);
        if (slotCursor < earliest) {
          slotCursor = new Date(Math.max(slotCursor.getTime(), earliest.getTime()));
          if (
            formatDateInTimezone(day, settings.timezone) ===
            formatDateInTimezone(now, settings.timezone)
          ) {
            slotCursor = new Date(
              Math.max(slotCursor.getTime(), earliest.getTime() + gapMs)
            );
          }
        }

        while (pending.length > 0) {
          const event = pending[0];
          const durationMs = event.duration_minutes * 60 * 1000;

          if (slotCursor.getTime() + durationMs > free.end.getTime()) {
            break;
          }

          const candidate: TimeSlot = {
            start: new Date(slotCursor),
            end: new Date(slotCursor.getTime() + durationMs),
          };

          if (!canPlaceWithoutOverlap(candidate, [...allBusy, ...placedSlots], gapMs)) {
            slotCursor = new Date(slotCursor.getTime() + 15 * 60 * 1000);
            if (slotCursor.getTime() + durationMs > free.end.getTime()) {
              break;
            }
            continue;
          }

          scheduled.push({
            smartEventId: event.id,
            start: candidate.start,
            end: candidate.end,
          });
          placedSlots.push(candidate);
          pending.shift();
          slotCursor = new Date(candidate.end.getTime() + gapMs);
        }
      }
    }

    if (pending.length === pendingBefore) {
      const skipped = pending.shift();
      if (skipped) {
        unscheduled.push({ id: skipped.id, title: skipped.title });
      }
    }
  }

  return { slots: scheduled, unscheduled };
}
