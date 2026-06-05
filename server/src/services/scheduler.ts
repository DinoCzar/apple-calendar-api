import type {
  AppSettings,
  CalendarEvent,
  ScheduledSlot,
  SmartEvent,
  TimeSlot,
} from '../types';

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

export function scheduleSmartEvents(
  smartEvents: SmartEvent[],
  calendarEvents: CalendarEvent[],
  alreadyScheduled: SmartEvent[],
  settings: AppSettings
): ScheduledSlot[] {
  const pending = [...smartEvents]
    .filter((e) => e.status === 'pending')
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));

  if (pending.length === 0) return [];

  const now = new Date();
  const rangeStart = startOfDayInTimezone(now, settings.timezone);
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

  for (let d = 0; d < settings.schedule_days_ahead; d++) {
    const day = addDaysInTimezone(rangeStart, d, settings.timezone);
    const dayKey = formatDateInTimezone(day, settings.timezone);
    const dayBusy = [...(busyByDay.get(dayKey) || []), ...placedSlots];
    const freeSlots = findFreeSlotsForDay(day, settings, dayBusy);

    for (const free of freeSlots) {
      if (pending.length === 0) break;

      let slotCursor = free.start;

      while (pending.length > 0) {
        const event = pending[0];
        const durationMs = event.duration_minutes * 60 * 1000;

        if (slotCursor < now) {
          slotCursor = new Date(now.getTime() + gapMs);
        }

        const candidate: TimeSlot = {
          start: new Date(slotCursor),
          end: new Date(slotCursor.getTime() + durationMs),
        };

        if (candidate.end > free.end) break;

        if (!canPlaceWithoutOverlap(candidate, [...allBusy, ...placedSlots], gapMs)) {
          slotCursor = new Date(slotCursor.getTime() + 15 * 60 * 1000);
          if (slotCursor >= free.end) break;
          continue;
        }

        const assignment: ScheduledSlot = {
          smartEventId: event.id,
          start: candidate.start,
          end: candidate.end,
        };

        scheduled.push(assignment);
        placedSlots.push(candidate);
        pending.shift();

        slotCursor = new Date(candidate.end.getTime() + gapMs);
      }
    }

    if (pending.length === 0) break;
  }

  return scheduled;
}
