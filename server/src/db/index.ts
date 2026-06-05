import { Pool } from 'pg';
import { config } from '../config';
import type {
  AppSettings,
  CreateSmartEventInput,
  SmartEvent,
  SmartEventStatus,
  UpdateSmartEventInput,
} from '../types';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS smart_events (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  apple_event_uid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export async function initDb(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  await pool.query(SCHEMA);
  await seedDefaultSettings();
  await applyDefaultWorkingHours();
}

async function applyDefaultWorkingHours(): Promise<void> {
  await pool.query(
    `UPDATE settings SET value = $1 WHERE key = 'working_hours_start'`,
    [config.defaults.workingHoursStart]
  );
  await pool.query(
    `UPDATE settings SET value = $1 WHERE key = 'working_hours_end'`,
    [config.defaults.workingHoursEnd]
  );
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

  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

function rowToSmartEvent(row: Record<string, unknown>): SmartEvent {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    duration_minutes: row.duration_minutes as number,
    priority: row.priority as number,
    status: row.status as SmartEventStatus,
    scheduled_start: row.scheduled_start
      ? new Date(row.scheduled_start as string).toISOString()
      : null,
    scheduled_end: row.scheduled_end
      ? new Date(row.scheduled_end as string).toISOString()
      : null,
    apple_event_uid: (row.apple_event_uid as string) ?? null,
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

export async function getSettings(): Promise<AppSettings> {
  const result = await pool.query('SELECT key, value FROM settings');
  const map = Object.fromEntries(
    result.rows.map((r) => [r.key, r.value])
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

export async function updateSettings(
  updates: Partial<AppSettings>
): Promise<AppSettings> {
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(value)]
      );
    }
  }
  return getSettings();
}

export async function listSmartEvents(): Promise<SmartEvent[]> {
  const result = await pool.query(
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
  return result.rows.map(rowToSmartEvent);
}

export async function getSmartEvent(id: string): Promise<SmartEvent | null> {
  const result = await pool.query('SELECT * FROM smart_events WHERE id = $1', [
    id,
  ]);
  return result.rows[0] ? rowToSmartEvent(result.rows[0]) : null;
}

export async function createSmartEvent(
  id: string,
  input: CreateSmartEventInput
): Promise<SmartEvent> {
  const result = await pool.query(
    `INSERT INTO smart_events (id, title, description, duration_minutes, priority)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      id,
      input.title,
      input.description ?? null,
      input.duration_minutes ?? 30,
      input.priority ?? 3,
    ]
  );
  return rowToSmartEvent(result.rows[0]);
}

export async function updateSmartEvent(
  id: string,
  input: UpdateSmartEventInput
): Promise<SmartEvent | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowed: (keyof UpdateSmartEventInput)[] = [
    'title',
    'description',
    'duration_minutes',
    'priority',
    'status',
  ];

  for (const key of allowed) {
    if (input[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(input[key]);
    }
  }

  if (fields.length === 0) return getSmartEvent(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE smart_events SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ? rowToSmartEvent(result.rows[0]) : null;
}

export async function reorderSmartEvents(ids: string[]): Promise<SmartEvent[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE smart_events SET priority = $1, updated_at = NOW() WHERE id = $2`,
        [i + 1, ids[i]]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return listSmartEvents();
}

export async function deleteSmartEvent(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM smart_events WHERE id = $1', [
    id,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function getPendingSmartEvents(): Promise<SmartEvent[]> {
  const result = await pool.query(
    `SELECT * FROM smart_events WHERE status = 'pending'
     ORDER BY priority ASC, created_at ASC`
  );
  return result.rows.map(rowToSmartEvent);
}

export async function getScheduledSmartEvents(): Promise<SmartEvent[]> {
  const result = await pool.query(
    `SELECT * FROM smart_events WHERE status IN ('scheduled', 'synced')
     AND scheduled_start IS NOT NULL`
  );
  return result.rows.map(rowToSmartEvent);
}

export async function markSmartEventScheduled(
  id: string,
  start: Date,
  end: Date
): Promise<void> {
  await pool.query(
    `UPDATE smart_events
     SET status = 'scheduled', scheduled_start = $2, scheduled_end = $3, updated_at = NOW()
     WHERE id = $1`,
    [id, start, end]
  );
}

export async function markSmartEventSynced(
  id: string,
  appleEventUid: string
): Promise<void> {
  await pool.query(
    `UPDATE smart_events
     SET status = 'synced', apple_event_uid = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, appleEventUid]
  );
}

export async function resetScheduledSmartEvents(): Promise<void> {
  await pool.query(
    `UPDATE smart_events
     SET status = 'pending', scheduled_start = NULL, scheduled_end = NULL,
         apple_event_uid = NULL, updated_at = NOW()
     WHERE status IN ('scheduled', 'synced')`
  );
}
