import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'crypto';
import type { AppSettings, SmartEvent, SmartEventStatus } from '../types';
import {
  defaultCalendarName,
  settingsStorageKey,
  WORKSPACE_IDS,
  type WorkspaceId,
} from '../workspace';
import {
  ALL_SCHEDULE_WEEKDAYS,
  formatScheduleDaysOfWeek,
  parseScheduleDaysOfWeek,
} from '../services/schedule-days';

let client: Client | null = null;

const DEFAULT_SETTINGS: Omit<AppSettings, 'smart_calendar_name'> & {
  smart_calendar_name?: string;
} = {
  apple_calendar_name: '',
  working_hours_start: '09:00',
  working_hours_end: '17:00',
  schedule_days_ahead: 30,
  min_gap_minutes: 0,
  timezone: 'America/Los_Angeles',
  schedule_start_use_default: true,
  schedule_start_date: null,
  schedule_days_of_week: [...ALL_SCHEDULE_WEEKDAYS],
};

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error('TURSO_DATABASE_URL is required');
    }

    client = createClient({
      url,
      authToken: authToken || undefined,
    });
  }
  return client;
}

function rowToSmartEvent(row: Record<string, unknown>): SmartEvent {
  const uid =
    row.apple_event_uid != null
      ? String(row.apple_event_uid)
      : row.calendar_uid != null
        ? String(row.calendar_uid)
        : null;

  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description != null ? String(row.description) : null,
    duration_minutes: Number(row.duration_minutes),
    priority: Number(row.priority),
    status: row.status as SmartEventStatus,
    scheduled_start: row.scheduled_start
      ? String(row.scheduled_start)
      : null,
    scheduled_end: row.scheduled_end ? String(row.scheduled_end) : null,
    apple_event_uid: uid,
    repeat_days_of_week: row.repeat_days_of_week
      ? parseScheduleDaysOfWeek(String(row.repeat_days_of_week))
      : null,
    repeat_time_of_day:
      row.repeat_time_of_day != null ? String(row.repeat_time_of_day) : null,
    grocery_sides:
      row.grocery_sides != null ? String(row.grocery_sides) : null,
    grocery_recipe:
      row.grocery_recipe != null ? String(row.grocery_recipe) : null,
    grocery_ingredients:
      row.grocery_ingredients != null ? String(row.grocery_ingredients) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function migrateSmartEventsSchema(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(smart_events)');
  const columns = new Set(info.rows.map((row) => String(row.name)));

  if (!columns.has('workspace')) {
    try {
      await db.execute(
        `ALTER TABLE smart_events ADD COLUMN workspace TEXT NOT NULL DEFAULT 'smart'`
      );
    } catch {
      // Column already exists
    }
  }

  const hasAppleUid = columns.has('apple_event_uid');
  const hasCalendarUid = columns.has('calendar_uid');

  if (!hasAppleUid && !hasCalendarUid) {
    try {
      await db.execute(
        `ALTER TABLE smart_events ADD COLUMN apple_event_uid TEXT`
      );
    } catch {
      // Column already exists
    }
  } else if (!hasAppleUid && hasCalendarUid) {
    try {
      await db.execute(
        `ALTER TABLE smart_events ADD COLUMN apple_event_uid TEXT`
      );
    } catch {
      // Column already exists
    }
    try {
      await db.execute(
        `UPDATE smart_events SET apple_event_uid = calendar_uid WHERE calendar_uid IS NOT NULL`
      );
    } catch {
      // Best-effort copy from legacy column name
    }
  }

  if (!columns.has('repeat_days_of_week')) {
    try {
      await db.execute(
        `ALTER TABLE smart_events ADD COLUMN repeat_days_of_week TEXT`
      );
    } catch {
      // Column already exists
    }
  }

  if (!columns.has('repeat_time_of_day')) {
    try {
      await db.execute(
        `ALTER TABLE smart_events ADD COLUMN repeat_time_of_day TEXT`
      );
    } catch {
      // Column already exists
    }
  }

  for (const column of [
    'grocery_sides',
    'grocery_recipe',
    'grocery_ingredients',
  ]) {
    if (!columns.has(column)) {
      try {
        await db.execute(`ALTER TABLE smart_events ADD COLUMN ${column} TEXT`);
      } catch {
        // Column already exists
      }
    }
  }
}

function workspaceDefaults(workspace: WorkspaceId): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    smart_calendar_name: defaultCalendarName(workspace),
  };
}

async function migrateLegacySettings(db: Client): Promise<void> {
  const legacy = await db.execute('SELECT key, value FROM settings');
  for (const row of legacy.rows) {
    const key = String(row.key);
    if (key.includes(':')) continue;

    const scoped = settingsStorageKey('smart', key);
    await db.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [scoped, String(row.value)],
    });
    await db.execute({
      sql: 'DELETE FROM settings WHERE key = ?',
      args: [key],
    });
  }
}

async function seedDefaultSettings(): Promise<void> {
  const db = getClient();
  for (const workspace of WORKSPACE_IDS) {
    const defaults = workspaceDefaults(workspace);
    for (const [key, value] of Object.entries(defaults)) {
      const storageKey = settingsStorageKey(workspace, key);
      await db.execute({
        sql: `INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO NOTHING`,
        args: [storageKey, String(value)],
      });
    }
  }
}

export async function initDb(): Promise<void> {
  const db = getClient();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS smart_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_start TEXT,
      scheduled_end TEXT,
      apple_event_uid TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await migrateSmartEventsSchema(db);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await migrateLegacySettings(db);
  await seedDefaultSettings();
}

export async function listSmartEvents(
  workspace: WorkspaceId
): Promise<SmartEvent[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT * FROM smart_events
          WHERE workspace = ?
          ORDER BY priority ASC, created_at ASC`,
    args: [workspace],
  });
  return result.rows.map((row) => rowToSmartEvent(row as Record<string, unknown>));
}

export async function getSmartEvent(
  id: string,
  workspace: WorkspaceId
): Promise<SmartEvent | null> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM smart_events WHERE id = ? AND workspace = ?',
    args: [id, workspace],
  });
  if (result.rows.length === 0) return null;
  return rowToSmartEvent(result.rows[0] as Record<string, unknown>);
}

export async function createSmartEvent(
  workspace: WorkspaceId,
  data: {
    title: string;
    description?: string;
    duration_minutes?: number;
    priority?: number;
    repeat_days_of_week?: number[] | null;
    repeat_time_of_day?: string | null;
    grocery_sides?: string | null;
    grocery_recipe?: string | null;
    grocery_ingredients?: string | null;
  }
): Promise<SmartEvent> {
  const db = getClient();
  const id = randomUUID();
  const now = new Date().toISOString();

  const maxPriority = await db.execute({
    sql: 'SELECT COALESCE(MAX(priority), -1) + 1 AS next FROM smart_events WHERE workspace = ?',
    args: [workspace],
  });
  const priority =
    data.priority ??
    Number((maxPriority.rows[0] as Record<string, unknown>).next ?? 0);

  await db.execute({
    sql: `INSERT INTO smart_events
          (id, title, description, duration_minutes, priority, status, workspace, repeat_days_of_week, repeat_time_of_day, grocery_sides, grocery_recipe, grocery_ingredients, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      data.title,
      data.description ?? null,
      data.duration_minutes ?? 30,
      priority,
      workspace,
      data.repeat_days_of_week?.length
        ? formatScheduleDaysOfWeek(data.repeat_days_of_week)
        : null,
      data.repeat_time_of_day ?? null,
      data.grocery_sides ?? null,
      data.grocery_recipe ?? null,
      data.grocery_ingredients ?? null,
      now,
      now,
    ],
  });

  const created = await getSmartEvent(id, workspace);
  if (!created) throw new Error('Failed to create smart event');
  return created;
}

type SmartEventUpdate = Partial<
  Pick<
    SmartEvent,
    | 'title'
    | 'description'
    | 'duration_minutes'
    | 'priority'
    | 'status'
    | 'scheduled_start'
    | 'scheduled_end'
    | 'grocery_sides'
    | 'grocery_recipe'
    | 'grocery_ingredients'
    | 'repeat_time_of_day'
  >
> & {
  apple_event_uid?: string | null;
  repeat_days_of_week?: number[] | null;
};

export async function updateSmartEvent(
  id: string,
  workspace: WorkspaceId,
  updates: SmartEventUpdate
): Promise<SmartEvent | null> {
  const db = getClient();
  const existing = await getSmartEvent(id, workspace);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      if (key === 'repeat_days_of_week') {
        fields.push(`${key} = ?`);
        values.push(
          Array.isArray(value) && value.length
            ? formatScheduleDaysOfWeek(value)
            : null
        );
        continue;
      }

      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = datetime('now')");
  values.push(id, workspace);

  await db.execute({
    sql: `UPDATE smart_events SET ${fields.join(', ')} WHERE id = ? AND workspace = ?`,
    args: values,
  });

  return getSmartEvent(id, workspace);
}

export async function deleteSmartEvent(
  id: string,
  workspace: WorkspaceId
): Promise<boolean> {
  const db = getClient();
  const result = await db.execute({
    sql: 'DELETE FROM smart_events WHERE id = ? AND workspace = ?',
    args: [id, workspace],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export async function reorderSmartEvents(
  workspace: WorkspaceId,
  orderedIds: string[]
): Promise<SmartEvent[]> {
  const db = getClient();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute({
      sql: `UPDATE smart_events SET priority = ?, updated_at = datetime('now')
            WHERE id = ? AND workspace = ?`,
      args: [i, orderedIds[i], workspace],
    });
  }
  return listSmartEvents(workspace);
}

export async function getPendingSmartEvents(
  workspace: WorkspaceId
): Promise<SmartEvent[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT * FROM smart_events
          WHERE workspace = ? AND status = 'pending'
          ORDER BY priority ASC, created_at ASC`,
    args: [workspace],
  });
  return result.rows.map((row) => rowToSmartEvent(row as Record<string, unknown>));
}

export async function getScheduledSmartEvents(
  workspace: WorkspaceId
): Promise<SmartEvent[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT * FROM smart_events
          WHERE workspace = ? AND status IN ('scheduled', 'synced')
          ORDER BY scheduled_start ASC`,
    args: [workspace],
  });
  return result.rows.map((row) => rowToSmartEvent(row as Record<string, unknown>));
}

export async function resetScheduledSmartEvents(
  workspace: WorkspaceId
): Promise<number> {
  const db = getClient();
  const result = await db.execute({
    sql: `UPDATE smart_events
          SET status = 'pending',
              scheduled_start = NULL,
              scheduled_end = NULL,
              apple_event_uid = NULL,
              updated_at = datetime('now')
          WHERE workspace = ? AND status IN ('scheduled', 'synced')`,
    args: [workspace],
  });
  return result.rowsAffected ?? 0;
}

export async function markSmartEventScheduled(
  id: string,
  workspace: WorkspaceId,
  start: string,
  end: string,
  calendarUid: string
): Promise<void> {
  await updateSmartEvent(id, workspace, {
    status: 'scheduled',
    scheduled_start: start,
    scheduled_end: end,
    apple_event_uid: calendarUid,
  });
}

export async function markSmartEventSynced(
  id: string,
  workspace: WorkspaceId
): Promise<void> {
  await updateSmartEvent(id, workspace, { status: 'synced' });
}

export async function getSettings(
  workspace: WorkspaceId
): Promise<AppSettings> {
  const db = getClient();
  const prefix = `${workspace}:`;
  const result = await db.execute({
    sql: 'SELECT key, value FROM settings WHERE key LIKE ?',
    args: [`${prefix}%`],
  });

  const settings: Record<string, string> = {};
  for (const row of result.rows) {
    const key = String(row.key).slice(prefix.length);
    settings[key] = String(row.value);
  }

  const defaults = workspaceDefaults(workspace);
  return {
    apple_calendar_name: settings.apple_calendar_name ?? '',
    working_hours_start:
      settings.working_hours_start ?? defaults.working_hours_start,
    working_hours_end:
      settings.working_hours_end ?? defaults.working_hours_end,
    schedule_days_ahead: settings.schedule_days_ahead
      ? parseInt(settings.schedule_days_ahead, 10)
      : defaults.schedule_days_ahead,
    min_gap_minutes: settings.min_gap_minutes
      ? parseInt(settings.min_gap_minutes, 10)
      : defaults.min_gap_minutes,
    timezone: settings.timezone ?? defaults.timezone,
    smart_calendar_name:
      settings.smart_calendar_name ?? defaults.smart_calendar_name,
    schedule_start_use_default:
      settings.schedule_start_use_default !== undefined
        ? settings.schedule_start_use_default !== 'false'
        : defaults.schedule_start_use_default,
    schedule_start_date:
      settings.schedule_start_date && settings.schedule_start_date.length > 0
        ? settings.schedule_start_date
        : defaults.schedule_start_date,
    schedule_days_of_week: parseScheduleDaysOfWeek(
      settings.schedule_days_of_week
    ),
  };
}

export async function updateSettings(
  workspace: WorkspaceId,
  updates: Partial<AppSettings>
): Promise<AppSettings> {
  const db = getClient();
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const storageKey = settingsStorageKey(workspace, key);
    const storedValue = Array.isArray(value)
      ? formatScheduleDaysOfWeek(value)
      : String(value);
    await db.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [storageKey, storedValue],
    });
  }
  return getSettings(workspace);
}

export async function applyDefaultWorkingHours(
  workspace: WorkspaceId
): Promise<void> {
  const db = getClient();
  const keys = ['working_hours_start', 'working_hours_end'] as const;
  for (const key of keys) {
    const storageKey = settingsStorageKey(workspace, key);
    const existing = await db.execute({
      sql: 'SELECT 1 FROM settings WHERE key = ?',
      args: [storageKey],
    });
    if (existing.rows.length === 0) {
      await db.execute({
        sql: 'INSERT INTO settings (key, value) VALUES (?, ?)',
        args: [storageKey, DEFAULT_SETTINGS[key]],
      });
    }
  }
}

export async function closeDb(): Promise<void> {
  if (client) {
    client.close();
    client = null;
  }
}
