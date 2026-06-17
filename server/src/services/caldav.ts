import { RRule, RRuleSet } from 'rrule';
import { createDAVClient, DAVCalendar, DAVNamespaceShort } from 'tsdav';
import { v4 as uuidv4 } from 'uuid';
import { config, isICloudConfigured } from '../config';
import type { AppSettings, CalendarEvent } from '../types';

interface ParsedVEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  rrule?: string;
  exdates: Date[];
  recurrenceId?: Date;
  status?: string;
  transp?: string;
  lastModified?: Date;
}

type CaldavClient = Awaited<ReturnType<typeof createDAVClient>>;

let clientPromise: Promise<CaldavClient> | null = null;

export function resetCaldavClient(): void {
  clientPromise = null;
}

function calendarDisplayName(cal: DAVCalendar): string {
  if (typeof cal.displayName === 'string') return cal.displayName;
  if (cal.displayName && typeof cal.displayName === 'object') {
    const text = (cal.displayName as { _text?: string })._text;
    if (text) return text;
  }
  return '';
}

async function getClient() {
  if (!isICloudConfigured()) {
    throw new Error(
      'iCloud credentials not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.'
    );
  }

  if (!clientPromise) {
    clientPromise = createDAVClient({
      serverUrl: config.icloud.serverUrl,
      credentials: {
        username: config.icloud.username,
        password: config.icloud.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  }

  return clientPromise;
}

function findCalendarByName(
  calendars: DAVCalendar[],
  name: string
): DAVCalendar | undefined {
  const normalized = name.trim().toLowerCase();
  return calendars.find((cal) => {
    const name = calendarDisplayName(cal).trim().toLowerCase();
    return (
      name === normalized ||
      (cal.url || '').toLowerCase().includes(normalized.replace(/\s+/g, ''))
    );
  });
}

function unfoldIcsLines(icsData: string): string[] {
  const raw = icsData.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];

  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function parseIcsProperty(line: string): {
  name: string;
  value: string;
  tzid?: string;
  dateOnly: boolean;
} | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;

  const namePart = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1).trim();
  const name = namePart.split(';')[0].toUpperCase();
  const dateOnly =
    namePart.includes('VALUE=DATE') && !namePart.includes('VALUE=DATE-TIME');
  const tzMatch = namePart.match(/TZID=([^;:]+)/i);

  return {
    name,
    value,
    tzid: tzMatch?.[1],
    dateOnly,
  };
}

function parseIcsDate(
  value: string,
  isDateOnly: boolean,
  tzid?: string,
  defaultTimezone?: string
): Date {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));

  if (isDateOnly) {
    const zone = tzid || defaultTimezone;
    if (zone) {
      return makeDateInTimezone(year, month, day, 0, 0, zone);
    }
    return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`);
  }

  const hour = Number(value.slice(9, 11) || '0');
  const minute = Number(value.slice(11, 13) || '0');
  const second = Number(value.slice(13, 15) || '0');

  if (value.endsWith('Z')) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  const zone = tzid || defaultTimezone;
  if (zone) {
    return makeDateInTimezone(year, month, day, hour, minute, zone);
  }

  return new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  );
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

function formatDateInTimezone(date: Date, timezone: string): string {
  const { year, month, day } = partsInTimezone(date, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysInTimezone(date: Date, days: number, timezone: string): Date {
  const dateStr = formatDateInTimezone(date, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  return makeDateInTimezone(year, month, day + days, 0, 0, timezone);
}

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

function extractVeventBlocks(icsData: string): string[][] {
  const lines = unfoldIcsLines(icsData);
  const events: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  return events;
}

function parseExdateValues(
  value: string,
  dateOnly: boolean,
  tzid: string | undefined,
  defaultTimezone?: string
): Date[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseIcsDate(part, dateOnly, tzid, defaultTimezone));
}

function parseVeventLines(
  lines: string[],
  defaultTimezone?: string
): ParsedVEvent | null {
  let uid = '';
  let title = '';
  let startValue = '';
  let endValue = '';
  let startTzid: string | undefined;
  let endTzid: string | undefined;
  let allDay = false;
  let rrule: string | undefined;
  const exdates: Date[] = [];
  let recurrenceId: Date | undefined;
  let status: string | undefined;
  let transp: string | undefined;
  let lastModified: Date | undefined;

  for (const line of lines) {
    const prop = parseIcsProperty(line);
    if (!prop) continue;

    if (prop.name === 'UID') uid = prop.value;
    if (prop.name === 'SUMMARY') title = prop.value;
    if (prop.name === 'STATUS') status = prop.value.toUpperCase();
    if (prop.name === 'TRANSP') transp = prop.value.toUpperCase();
    if (prop.name === 'RRULE') rrule = prop.value;
    if (prop.name === 'DTSTART') {
      startValue = prop.value;
      startTzid = prop.tzid;
      allDay = prop.dateOnly;
    }
    if (prop.name === 'DTEND') {
      endValue = prop.value;
      endTzid = prop.tzid;
    }
    if (prop.name === 'RECURRENCE-ID') {
      recurrenceId = parseIcsDate(
        prop.value,
        prop.dateOnly,
        prop.tzid || startTzid,
        defaultTimezone
      );
    }
    if (prop.name === 'EXDATE') {
      exdates.push(
        ...parseExdateValues(
          prop.value,
          prop.dateOnly || allDay,
          prop.tzid || startTzid,
          defaultTimezone
        )
      );
    }
    if (prop.name === 'LAST-MODIFIED' || prop.name === 'DTSTAMP') {
      const parsed = parseIcsDate(
        prop.value,
        prop.dateOnly,
        prop.tzid,
        defaultTimezone
      );
      if (!lastModified || parsed > lastModified) {
        lastModified = parsed;
      }
    }
  }

  if (!uid || !startValue) return null;

  const start = parseIcsDate(startValue, allDay, startTzid, defaultTimezone);
  let end: Date;

  if (endValue) {
    end = parseIcsDate(endValue, allDay, endTzid || startTzid, defaultTimezone);
  } else if (allDay) {
    const zone = defaultTimezone || 'UTC';
    end = addDaysInTimezone(start, 1, zone);
  } else {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  if (end <= start) {
    end = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
  }

  return {
    uid,
    title,
    start,
    end,
    allDay,
    rrule,
    exdates,
    recurrenceId,
    status,
    transp,
    lastModified,
  };
}

function eventToCalendarEvents(
  event: ParsedVEvent,
  rangeStart: Date,
  rangeEnd: Date,
  meta?: { isRecurrenceInstance?: boolean }
): CalendarEvent[] {
  if (event.end <= rangeStart || event.start >= rangeEnd) return [];

  return [
    {
      uid: event.uid,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      lastModified: event.lastModified,
      isRecurrenceInstance: meta?.isRecurrenceInstance,
    },
  ];
}

function expandRecurringEvent(
  event: ParsedVEvent,
  rangeStart: Date,
  rangeEnd: Date
): CalendarEvent[] {
  if (!event.rrule) {
    return eventToCalendarEvents(event, rangeStart, rangeEnd);
  }

  try {
    const set = new RRuleSet();
    const options = RRule.parseString(event.rrule);
    options.dtstart = event.start;
    set.rrule(new RRule(options));

    for (const exdate of event.exdates) {
      set.exdate(exdate);
    }

    const durationMs = event.end.getTime() - event.start.getTime();
    const occurrences = set.between(rangeStart, rangeEnd, true);

    return occurrences.map((start) => ({
      uid: `${event.uid}:${start.toISOString()}`,
      title: event.title,
      start,
      end: new Date(start.getTime() + durationMs),
      allDay: event.allDay,
      lastModified: event.lastModified,
      isRecurrenceInstance: true,
    }));
  } catch (err) {
    console.warn(
      `Failed to expand recurring event "${event.title}": ${(err as Error).message}`
    );
    return eventToCalendarEvents(event, rangeStart, rangeEnd);
  }
}

function parseIcsEvents(
  icsData: string,
  defaultTimezone: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  options: { serverExpanded?: boolean } = {}
): CalendarEvent[] {
  const parsed = extractVeventBlocks(icsData)
    .map((lines) => parseVeventLines(lines, defaultTimezone))
    .filter((event): event is ParsedVEvent => event !== null)
    .filter(
      (event) =>
        event.status !== 'CANCELLED' && event.transp !== 'TRANSPARENT'
    );

  const expanded: CalendarEvent[] = [];

  for (const event of parsed) {
    if (options.serverExpanded) {
      if (event.recurrenceId) {
        expanded.push(
          ...eventToCalendarEvents(event, rangeStart, rangeEnd, {
            isRecurrenceInstance: true,
          })
        );
      } else if (event.rrule) {
        expanded.push(...expandRecurringEvent(event, rangeStart, rangeEnd));
      } else {
        expanded.push(...eventToCalendarEvents(event, rangeStart, rangeEnd));
      }
      continue;
    }

    if (event.recurrenceId) {
      expanded.push(
        ...eventToCalendarEvents(event, rangeStart, rangeEnd, {
          isRecurrenceInstance: true,
        })
      );
      continue;
    }

    if (event.rrule) {
      expanded.push(...expandRecurringEvent(event, rangeStart, rangeEnd));
      continue;
    }

    expanded.push(...eventToCalendarEvents(event, rangeStart, rangeEnd));
  }

  return expanded;
}

function eventInstanceKey(event: CalendarEvent): string {
  return `${event.uid}::${event.start.toISOString()}`;
}

function removeStaleUidVersions(events: CalendarEvent[]): CalendarEvent[] {
  const singles = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    if (event.isRecurrenceInstance) continue;
    const list = singles.get(event.uid) ?? [];
    list.push(event);
    singles.set(event.uid, list);
  }

  const drop = new Set<string>();

  for (const list of singles.values()) {
    if (list.length <= 1) continue;

    let latest = list[0];
    for (const event of list) {
      const latestTime = latest.lastModified?.getTime() ?? 0;
      const eventTime = event.lastModified?.getTime() ?? 0;
      if (eventTime > latestTime) {
        latest = event;
      }
    }

    if (!latest.lastModified) continue;

    for (const event of list) {
      if (event !== latest) {
        drop.add(eventInstanceKey(event));
      }
    }
  }

  return events.filter((event) => !drop.has(eventInstanceKey(event)));
}

function hasCalendarData(
  objects: Awaited<ReturnType<CaldavClient['fetchCalendarObjects']>>
): boolean {
  return objects.some((obj) => Boolean(obj.data));
}

async function fetchBusyCalendarObjects(
  client: CaldavClient,
  calendar: DAVCalendar,
  timeRange: { start: string; end: string },
  refresh: boolean
): Promise<{
  objects: Awaited<ReturnType<CaldavClient['fetchCalendarObjects']>>;
  serverExpanded: boolean;
}> {
  const common = {
    calendar,
    timeRange,
    fetchOptions: { cache: 'no-store' } as RequestInit,
  };

  const standard = await client.fetchCalendarObjects(common);
  if (hasCalendarData(standard)) {
    return { objects: standard, serverExpanded: false };
  }

  if (refresh) {
    try {
      const expanded = await client.fetchCalendarObjects({
        ...common,
        expand: true,
      });
      if (hasCalendarData(expanded)) {
        return { objects: expanded, serverExpanded: true };
      }
    } catch (err) {
      console.warn(
        `Expanded CalDAV fetch returned no data: ${(err as Error).message}`
      );
    }
  }

  return { objects: standard, serverExpanded: false };
}

function startOfDayInTimezone(date: Date, timezone: string): Date {
  const dateStr = formatDateInTimezone(date, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  return makeDateInTimezone(year, month, day, 0, 0, timezone);
}

function parseTimeOnDate(date: Date, timeStr: string, timezone: string): Date {
  const dateStr = formatDateInTimezone(date, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return makeDateInTimezone(year, month, day, hour, minute, timezone);
}

export function getSchedulingWindow(settings: AppSettings): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  const rangeStart = startOfDayInTimezone(now, settings.timezone);
  const lastDay = addDaysInTimezone(
    rangeStart,
    Math.max(settings.schedule_days_ahead - 1, 0),
    settings.timezone
  );
  const windowStart = parseTimeOnDate(
    rangeStart,
    settings.working_hours_start,
    settings.timezone
  );
  const windowEnd = parseTimeOnDate(
    lastDay,
    settings.working_hours_end,
    settings.timezone
  );

  return {
    start: windowStart > now ? windowStart : now,
    end: windowEnd,
  };
}

export function filterEventsToSchedulingWindow(
  events: CalendarEvent[],
  settings: AppSettings,
  now = new Date()
): CalendarEvent[] {
  const rangeStart = startOfDayInTimezone(now, settings.timezone);
  const lastSchedulableDay = addDaysInTimezone(
    rangeStart,
    Math.max(settings.schedule_days_ahead - 1, 0),
    settings.timezone
  );
  const filtered: CalendarEvent[] = [];

  for (const event of events) {
    if (event.allDay) {
      let day = startOfDayInTimezone(event.start, settings.timezone);
      const endDay = startOfDayInTimezone(event.end, settings.timezone);
      let included = false;

      while (day < endDay) {
        if (day >= rangeStart && day <= lastSchedulableDay) {
          included = true;
          break;
        }
        day = addDaysInTimezone(day, 1, settings.timezone);
      }

      if (included) {
        filtered.push(event);
      }
      continue;
    }

    for (let d = 0; d < settings.schedule_days_ahead; d++) {
      const day = addDaysInTimezone(rangeStart, d, settings.timezone);
      const dayWorkStart = parseTimeOnDate(
        day,
        settings.working_hours_start,
        settings.timezone
      );
      const dayWorkEnd = parseTimeOnDate(
        day,
        settings.working_hours_end,
        settings.timezone
      );
      const effectiveStart = dayWorkStart > now ? dayWorkStart : now;
      const overlapStart = new Date(
        Math.max(event.start.getTime(), effectiveStart.getTime())
      );
      const overlapEnd = new Date(
        Math.min(event.end.getTime(), dayWorkEnd.getTime())
      );

      if (overlapEnd > overlapStart) {
        filtered.push({
          ...event,
          uid: `${event.uid}::${overlapStart.toISOString()}`,
          start: overlapStart,
          end: overlapEnd,
          isRecurrenceInstance: event.isRecurrenceInstance,
        });
      }
    }
  }

  return filtered.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function getScheduleFetchRange(settings: AppSettings): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  const start = startOfDayInTimezone(now, settings.timezone);
  const end = addDaysInTimezone(start, settings.schedule_days_ahead, settings.timezone);
  return { start, end };
}

function formatIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function buildIcsEvent(params: {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Smart Events//EN',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(params.start)}`,
    `DTEND:${formatIcsDate(params.end)}`,
    `SUMMARY:${params.title}`,
  ];

  if (params.description) {
    lines.push(`DESCRIPTION:${params.description.replace(/\n/g, '\\n')}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export async function listCalendars(): Promise<{ name: string; url: string }[]> {
  const client = await getClient();
  const calendars = await client.fetchCalendars();
  return calendars.map((cal) => ({
    name: calendarDisplayName(cal) || 'Unnamed',
    url: cal.url,
  }));
}

export async function fetchAllBusyEvents(
  settings: AppSettings,
  rangeStart: Date,
  rangeEnd: Date,
  options: { refresh?: boolean; excludeCalendarNames?: string[] } = {}
): Promise<CalendarEvent[]> {
  if (options.refresh) {
    resetCaldavClient();
  }

  const client = await getClient();
  const calendars = await client.fetchCalendars();
  const excludeNames = new Set(
    options.excludeCalendarNames ?? [settings.smart_calendar_name]
  );
  const excludeUrls = new Set(
    calendars
      .filter((cal) => excludeNames.has(calendarDisplayName(cal) || ''))
      .map((cal) => cal.url)
  );

  const busyCalendars = calendars.filter((cal) => !excludeUrls.has(cal.url));

  const eventMap = new Map<string, CalendarEvent>();

  const timeRange = {
    start: rangeStart.toISOString(),
    end: rangeEnd.toISOString(),
  };

  for (const calendar of busyCalendars) {
    const name = calendarDisplayName(calendar) || 'Unnamed';

    try {
      const { objects, serverExpanded } = await fetchBusyCalendarObjects(
        client,
        calendar,
        timeRange,
        Boolean(options.refresh)
      );

      for (const obj of objects) {
        if (!obj.data) continue;

        for (const parsed of parseIcsEvents(
          obj.data,
          settings.timezone,
          rangeStart,
          rangeEnd,
          { serverExpanded }
        )) {
          const key = eventInstanceKey(parsed);
          const existing = eventMap.get(key);
          if (existing) {
            const existingTime = existing.lastModified?.getTime() ?? 0;
            const parsedTime = parsed.lastModified?.getTime() ?? 0;
            if (parsedTime > existingTime) {
              eventMap.set(key, parsed);
            }
            continue;
          }

          eventMap.set(key, parsed);
        }
      }
    } catch (err) {
      console.warn(`Skipped calendar "${name}": ${(err as Error).message}`);
    }
  }

  const events = [...eventMap.values()];
  return filterEventsToSchedulingWindow(
    removeStaleUidVersions(events),
    settings
  );
}

function calendarHomeUrl(calendar: DAVCalendar): string {
  const url = calendar.url.endsWith('/') ? calendar.url : `${calendar.url}/`;
  const parts = url.split('/');
  parts.pop();
  return `${parts.join('/')}/`;
}

function isMkCalendarSuccess(status: number | string | undefined): boolean {
  const code = typeof status === 'string' ? parseInt(status, 10) : status;
  return code !== undefined && code >= 200 && code < 300;
}

async function getSmartCalendar(
  client: CaldavClient,
  settings: AppSettings
): Promise<DAVCalendar | null> {
  const calendars = await client.fetchCalendars();
  return findCalendarByName(calendars, settings.smart_calendar_name) ?? null;
}

export async function clearSmartEventsCalendar(
  settings: AppSettings
): Promise<number> {
  const client = await getClient();
  const smartCalendar = await getSmartCalendar(client, settings);
  if (!smartCalendar) return 0;

  const objects = await client.fetchCalendarObjects({
    calendar: smartCalendar,
  });

  let deleted = 0;
  for (const obj of objects) {
    if (!obj.url) continue;
    await client.deleteCalendarObject({ calendarObject: obj });
    deleted++;
  }

  return deleted;
}

async function getOrCreateSmartCalendar(
  client: CaldavClient,
  settings: AppSettings
): Promise<DAVCalendar> {
  const existing = await getSmartCalendar(client, settings);
  if (existing) return existing;

  const calendars = await client.fetchCalendars();
  const reference = calendars[0];

  if (!reference) {
    throw new Error('No calendars found on iCloud account');
  }

  const calendarId = uuidv4().toUpperCase();
  const homeUrl = calendarHomeUrl(reference);
  const newUrl = `${homeUrl}${calendarId}/`;

  let createResponses;
  try {
    createResponses = await client.makeCalendar({
      url: newUrl,
      props: {
        [`${DAVNamespaceShort.DAV}:displayname`]: settings.smart_calendar_name,
        [`${DAVNamespaceShort.CALDAV_APPLE}:calendar-color`]: '#5B8DEFFF',
        [`${DAVNamespaceShort.CALDAV}:supported-calendar-component-set`]: {
          [`${DAVNamespaceShort.CALDAV}:comp`]: [
            { _attributes: { name: 'VEVENT' } },
          ],
        },
      },
    });
  } catch (err) {
    throw new Error(
      `Could not create "${settings.smart_calendar_name}" calendar on iCloud. ` +
        `Open Apple Calendar on your Mac or iPhone, create a new calendar named ` +
        `"${settings.smart_calendar_name}", wait a minute, then sync again. ` +
        `(${(err as Error).message})`
    );
  }

  const createdOk =
    createResponses?.some((r) => isMkCalendarSuccess(r.status)) ?? false;

  const refreshed = await client.fetchCalendars();
  const created =
    findCalendarByName(refreshed, settings.smart_calendar_name) ??
    refreshed.find(
      (cal) =>
        cal.url === newUrl ||
        cal.url === newUrl.replace(/\/$/, '') ||
        cal.url.replace(/\/$/, '') === newUrl.replace(/\/$/, '')
    );

  if (created) return created;

  if (createdOk) {
    return {
      url: newUrl,
      displayName: settings.smart_calendar_name,
    };
  }

  throw new Error(
    `Could not create "${settings.smart_calendar_name}" calendar on iCloud. ` +
      `Open Apple Calendar on your Mac or iPhone, create a new calendar named ` +
      `"${settings.smart_calendar_name}", wait a minute, then sync again.`
  );
}

export async function pushSmartEventToCalendar(params: {
  settings: AppSettings;
  uid: string;
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
}): Promise<string> {
  const client = await getClient();
  const smartCalendar = await getOrCreateSmartCalendar(client, params.settings);
  const icsData = buildIcsEvent({
    uid: params.uid,
    title: params.title,
    description: params.description ?? undefined,
    start: params.start,
    end: params.end,
  });

  await client.createCalendarObject({
    calendar: smartCalendar,
    filename: `${params.uid}.ics`,
    iCalString: icsData,
  });

  return params.uid;
}

export async function deleteSmartEventFromCalendar(
  settings: AppSettings,
  uid: string
): Promise<void> {
  const client = await getClient();
  const smartCalendar = await getSmartCalendar(client, settings);
  if (!smartCalendar) return;

  const objects = await client.fetchCalendarObjects({
    calendar: smartCalendar,
  });

  const match = objects.find((obj) => obj.url?.includes(uid));
  if (match?.url) {
    await client.deleteCalendarObject({ calendarObject: match });
  }
}

export function generateEventUid(): string {
  return `${uuidv4()}@smart-events`;
}
