import { createClient, type Client, type InValue } from '@libsql/client';
import { config } from '../config';
import type {
  AppSettings,
  CreateSmartEventInput,
  SmartEvent,
  SmartEventStatus,
  UpdateSmartEventInput,
} from '../types';

let db: Client | null = null;

function getDb(): Client {
  if (!db) {
    if (!config.turso.url) {
      throw new Error(
        'TURSO_DATABASE_URL is required (e.g. libsql://your-db.turso.io or file:local.db for dev)'
      );
    }

    db = createClient({
      url: config.turso.url,
      authToken: config.turso.authToken || undefined,
    });
  }

  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}

const SMART_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS smart_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_start TEXT,
  scheduled_end TEXT,
  apple_event_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const SETTINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

export async function initDb(): Promise<void> {
  const client = getDb();
  await client.execute(SMART_EVENTS_SCHEMA);
  await client.execute(SETTINGS_SCHEMA);
  await seedDefaultSettings();
}

async function seedDefaultSettings(): Promise<void> {
  const defaults: Record<string, string> = {
    apple_calendar_name: config.defaults.appleCalendarName,
    smart_calendar_name: config.defaults.smartCalendarName,
    working_hours_start: config.defaults.workingHoursStart,
    working_hours_end: config.defaults.workingHoursEnd,
    schedule_days_ahead: String(config.defaults.scheduleDaysAhead),
    min_gap_minutes: String(config.defaults.minGapMinutes),
    timezone: config.defaults.timezone,
  };

  const client = getDb();
  for (const [key, value] of Object.entries(defaults)) {
    await client.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
      args: [key, value],
    });
  }
}

function rowToSmartEvent(row: Record<string, unknown>): SmartEvent {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description != null ? String(row.description) : null,
    duration_minutes: Number(row.duration_minutes),
    priority: Number(row.priority),
    status: row.status as SmartEventStatus,
    scheduled_start: row.scheduled_start
      ? new Date(String(row.scheduled_start)).toISOString()
      : null,
    scheduled_end: row.scheduled_end
      ? new Date(String(row.scheduled_end)).toISOString()
      : null,
    apple_event_uid:
      row.apple_event_uid != null ? String(row.apple_event_uid) : null,
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getSettings(): Promise<AppSettings> {
  const result = await getDb().execute('SELECT key, value FROM settings');
  const map = Object.fromEntries(
    result.rows.map((r) => [String(r.key), String(r.value)])
  ) as Record<string, string>;

  return {
    apple_calendar_name: map.apple_calendar_name || config.defaults.appleCalendarName,
    smart_calendar_name: map.smart_calendar_name || config.defaults.smartCalendarName,
    working_hours_start: map.working_hours_start || config.defaults.workingHoursStart,
    working_hours_end: map.working_hours_end || config.defaults.workingHoursEnd,
    schedule_days_ahead: parseInt(map.schedule_days_ahead || '7', 10),
    min_gap_minutes: parseInt(map.min_gap_minutes || '15', 10),
    timezone: map.timezone || config.defaults.timezone,
  };
}

const SETTINGS_KEYS: (keyof AppSettings)[] = [
  'apple_calendar_name',
  'smart_calendar_name',
  'working_hours_start',
  'working_hours_end',
  'schedule_days_ahead',
  'min_gap_minutes',
  'timezone',
];

export async function updateSettings(
  updates: Partial<AppSettings>
): Promise<AppSettings> {
  const client = getDb();
  for (const key of SETTINGS_KEYS) {
    const value = updates[key];
    if (value !== undefined) {
      await client.execute({
        sql: `INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, String(value)],
      });
    }
  }
  return getSettings();
}

export async function listSmartEvents(): Promise<SmartEvent[]> {
  const result = await getDb().execute(
    `SELECT * FROM smart_events ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'scheduled' THEN 1
        WHEN 'synced' THEN 2
        ELSE 3
      END,
      priority ASC,
      created_at ASC`
  );
  return result.rows.map((row) => rowToSmartEvent(row as Record<string, unknown>));
}

export async function getSmartEvent(id: string): Promise<SmartEvent | null> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM smart_events WHERE id = ?',
    args: [id],
  });
  return result.rows[0]
    ? rowToSmartEvent(result.rows[0] as Record<string, unknown>)
    : null;
}

export async function createSmartEvent(
  id: string,
  input: CreateSmartEventInput
): Promise<SmartEvent> {
  const result = await getDb().execute({
    sql: `INSERT INTO smart_events (id, title, description, duration_minutes, priority)
          VALUES (?, ?, ?, ?, ?)
          RETURNING *`,
    args: [
      id,
      input.title,
      input.description ?? null,
      input.duration_minutes ?? 30,
      input.priority ?? 3,
    ],
  });
  return rowToSmartEvent(result.rows[0] as Record<string, unknown>);
}

export async function updateSmartEvent(
  id: string,
  input: UpdateSmartEventInput
): Promise<SmartEvent | null> {
  const fields: string[] = [];
  const values: InValue[] = [];

  const allowed: (keyof UpdateSmartEventInput)[] = [
    'title',
    'description',
    'duration_minutes',
    'priority',
    'status',
  ];

  for (const key of allowed) {
    if (input[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(input[key]);
    }
  }

  if (fields.length === 0) return getSmartEvent(id);

  fields.push(`updated_at = datetime('now')`);
  values.push(id);

  const result = await getDb().execute({
    sql: `UPDATE smart_events SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
    args: values,
  });
  return result.rows[0]
    ? rowToSmartEvent(result.rows[0] as Record<string, unknown>)
    : null;
}

export async function reorderSmartEvents(ids: string[]): Promise<SmartEvent[]> {
  const client = getDb();
  const tx = await client.transaction('write');

  try {
    for (let i = 0; i < ids.length; i++) {
      await tx.execute({
        sql: `UPDATE smart_events SET priority = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [i + 1, ids[i]],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return listSmartEvents();
}

export async function deleteSmartEvent(id: string): Promise<boolean> {
  const result = await getDb().execute({
    sql: 'DELETE FROM smart_events WHERE id = ?',
    args: [id],
  });
  return result.rowsAffected > 0;
}

export async function getPendingSmartEvents(): Promise<SmartEvent[]> {
  const result = await getDb().execute(
    `SELECT * FROM smart_events WHERE status = 'pending'
     ORDER BY priority ASC, created_at ASC`
  );
  return result.rows.map((row) => rowToSmartEvent(row as Record<string, unknown>));
}

export async function getScheduledSmartEvents(): Promise<SmartEvent[]> {
  const result = await getDb().execute(
    `SELECT * FROM smart_events WHERE status IN ('scheduled', 'synced')
     AND scheduled_start IS NOT NULL`
  );
  return result.rows.map((row) => rowToSmartEvent(row as Record<string, unknown>));
}

export async function markSmartEventScheduled(
  id: string,
  start: Date,
  end: Date
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE smart_events
          SET status = 'scheduled', scheduled_start = ?, scheduled_end = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [start.toISOString(), end.toISOString(), id],
  });
}

export async function markSmartEventSynced(
  id: string,
  appleEventUid: string
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE smart_events
          SET status = 'synced', apple_event_uid = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [appleEventUid, id],
  });
}

export async function resetScheduledSmartEvents(): Promise<void> {
  await getDb().execute(
    `UPDATE smart_events
     SET status = 'pending', scheduled_start = NULL, scheduled_end = NULL,
         apple_event_uid = NULL, updated_at = datetime('now')
     WHERE status IN ('scheduled', 'synced')`
  );
}
