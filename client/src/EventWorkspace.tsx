import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, createWorkspaceApi } from './api';
import PriorityQueue from './PriorityQueue';
import type { AppSettings, SmartEvent, SyncResult } from './types';
import { toPersistedSettings } from './types';
import { getWorkspaceConfig, type WorkspaceId } from './workspaces';
import { ALL_SCHEDULE_WEEKDAYS, SCHEDULE_WEEKDAYS, formatRepeatDaysLabel } from './weekdays';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function todayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface EventWorkspaceProps {
  workspace: WorkspaceId;
}

export default function EventWorkspace({ workspace }: EventWorkspaceProps) {
  const config = getWorkspaceConfig(workspace);
  const workspaceApi = useMemo(
    () => createWorkspaceApi(workspace),
    [workspace]
  );

  const [events, setEvents] = useState<SmartEvent[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(30);
  const [createRepeatDays, setCreateRepeatDays] = useState<number[]>([
    1, 2, 3, 4, 5,
  ]);
  const [createRepeatTime, setCreateRepeatTime] = useState('09:00');
  const [createGrocerySides, setCreateGrocerySides] = useState('');
  const [createGroceryRecipe, setCreateGroceryRecipe] = useState('');
  const [createGroceryIngredients, setCreateGroceryIngredients] = useState('');
  const [creating, setCreating] = useState(false);

  const [settingsDraft, setSettingsDraft] = useState<Partial<AppSettings>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [icloudCalendars, setIcloudCalendars] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [busyPreviewRefresh, setBusyPreviewRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evts, cfg] = await Promise.all([
        workspaceApi.getSmartEvents(),
        workspaceApi.getSettings(),
      ]);
      setEvents(evts);
      setSettings(cfg);
      setSettingsDraft(cfg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceApi]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (settings?.icloud_configured) {
      loadIcloudCalendars();
    }
  }, [settings?.icloud_configured]);

  async function loadIcloudCalendars() {
    setLoadingCalendars(true);
    try {
      const calendars = await api.listCalendars();
      setIcloudCalendars(calendars.map((c) => c.name));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingCalendars(false);
    }
  }

  const isRecurringWorkspace = workspace === 'recurring';
  const isGroceryWorkspace = workspace === 'grocery';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (isRecurringWorkspace && createRepeatDays.length === 0) {
      setError('Select at least one day for the event to repeat on.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const pendingCount = events.filter((ev) => ev.status === 'pending').length;
      await workspaceApi.createSmartEvent({
        title: title.trim(),
        description: isGroceryWorkspace ? undefined : description.trim() || undefined,
        duration_minutes: duration,
        priority: pendingCount + 1,
        ...(isRecurringWorkspace
          ? {
              repeat_days_of_week: createRepeatDays,
              repeat_time_of_day: createRepeatTime,
            }
          : {}),
        ...(isGroceryWorkspace
          ? {
              grocery_sides: createGrocerySides.trim() || undefined,
              grocery_recipe: createGroceryRecipe.trim() || undefined,
              grocery_ingredients: createGroceryIngredients.trim() || undefined,
            }
          : {}),
      });
      setTitle('');
      setDescription('');
      setDuration(30);
      if (isGroceryWorkspace) {
        setCreateGrocerySides('');
        setCreateGroceryRecipe('');
        setCreateGroceryIngredients('');
      }
      if (isRecurringWorkspace) {
        setCreateRepeatDays([1, 2, 3, 4, 5]);
        setCreateRepeatTime('09:00');
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Delete this ${config.eventLabel.toLowerCase()}?`)) return;
    try {
      await workspaceApi.deleteSmartEvent(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleComplete(id: string) {
    try {
      await workspaceApi.updateSmartEvent(id, { status: 'completed' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await workspaceApi.runSync(true);
      setSyncResult(result);
      setBusyPreviewRefresh((n) => n + 1);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (
      settingsDraft.schedule_start_use_default === false &&
      !settingsDraft.schedule_start_date
    ) {
      setError('Choose a start date or enable “Start at next available time slot”.');
      return;
    }

    const selectedDays =
      settingsDraft.schedule_days_of_week ?? ALL_SCHEDULE_WEEKDAYS;
    if (selectedDays.length === 0) {
      setError('Select at least one day of the week for scheduling.');
      return;
    }

    setSavingSettings(true);
    setError(null);
    try {
      const updated = await workspaceApi.updateSettings(
        toPersistedSettings({
          ...settingsDraft,
          schedule_start_date:
            settingsDraft.schedule_start_use_default === false
              ? settingsDraft.schedule_start_date ?? null
              : null,
        })
      );
      setSettings(updated);
      setSettingsDraft(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  const pendingCount = events.filter((e) => e.status === 'pending').length;
  const syncableCount = events.filter((e) => e.status !== 'completed').length;
  const calendarName = settings?.smart_calendar_name ?? config.defaultCalendarName;
  const selectedWeekdays =
    settingsDraft.schedule_days_of_week ?? ALL_SCHEDULE_WEEKDAYS;

  function toggleScheduleWeekday(day: number) {
    setSettingsDraft((current) => {
      const days = current.schedule_days_of_week ?? ALL_SCHEDULE_WEEKDAYS;
      const next = days.includes(day)
        ? days.filter((value) => value !== day)
        : [...days, day].sort((a, b) => a - b);
      return { ...current, schedule_days_of_week: next };
    });
  }

  function toggleCreateRepeatDay(day: number) {
    setCreateRepeatDays((current) => {
      const next = current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b);
      return next;
    });
  }

  return (
    <>
      <header className="header workspace-header">
        <div>
          <p className="workspace-description">
            {isRecurringWorkspace
              ? `Add weekly repeating events, set priority, then sync to push them to ${calendarName}.`
              : `Drag to set priority, then sync — recalls old events, refreshes iCloud busy times, and pushes a new schedule to ${calendarName}.`}
          </p>
          {settings && (
            <div className="connection-status">
              <span
                className={`status-dot ${settings.icloud_configured ? 'ok' : 'warn'}`}
              />
              {settings.icloud_configured
                ? 'iCloud connected'
                : 'iCloud not configured — set credentials on Render'}
            </div>
          )}
        </div>
        <div className="header-actions">
          <button
            className="btn-primary"
            onClick={handleSync}
            disabled={
              syncing ||
              !settings?.icloud_configured ||
              syncableCount === 0
            }
          >
            {syncing ? 'Syncing…' : config.syncButtonLabel}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {syncResult && (
        <div className="alert alert-success">
          {syncResult.smartEventsCleared > 0 && (
            <>
              Recalled <strong>{syncResult.smartEventsCleared}</strong> old event
              {syncResult.smartEventsCleared === 1 ? '' : 's'},{' '}
            </>
          )}
          refreshed <strong>{syncResult.appleEventsFetched}</strong> busy block
          {syncResult.appleEventsFetched === 1 ? '' : 's'} from iCloud, and synced{' '}
          <strong>{syncResult.smartEventsSynced}</strong> to{' '}
          <strong>{calendarName}</strong>.
          {syncResult.smartEventsUnscheduled > 0 && (
            <>
              {' '}
              <strong>{syncResult.smartEventsUnscheduled}</strong> could not fit in your
              open calendar slots
              {syncResult.unscheduled_titles?.length > 0 && (
                <> ({syncResult.unscheduled_titles.join(', ')})</>
              )}
              .
            </>
          )}
          {syncResult.errors.length > 0 && (
            <div className="sync-result" style={{ marginTop: '0.5rem' }}>
              {syncResult.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid">
        <section>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h2>{config.newEventHeading}</h2>
            <form onSubmit={handleCreate} className="form-grid">
              <div>
                <label htmlFor={`title-${workspace}`}>Title</label>
                <input
                  id={`title-${workspace}`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Review quarterly report"
                  required
                />
              </div>
              {isGroceryWorkspace ? (
                <>
                  <div>
                    <label htmlFor={`grocery-ingredients-${workspace}`}>
                      Ingredients (optional)
                    </label>
                    <textarea
                      id={`grocery-ingredients-${workspace}`}
                      value={createGroceryIngredients}
                      onChange={(e) => setCreateGroceryIngredients(e.target.value)}
                      rows={2}
                      placeholder="e.g. chicken, rice, broccoli"
                    />
                  </div>
                  <div>
                    <label htmlFor={`grocery-recipe-${workspace}`}>
                      Recipe (optional)
                    </label>
                    <textarea
                      id={`grocery-recipe-${workspace}`}
                      value={createGroceryRecipe}
                      onChange={(e) => setCreateGroceryRecipe(e.target.value)}
                      rows={2}
                      placeholder="Prep steps or recipe link"
                    />
                  </div>
                  <div>
                    <label htmlFor={`grocery-sides-${workspace}`}>
                      Sides (optional)
                    </label>
                    <textarea
                      id={`grocery-sides-${workspace}`}
                      value={createGrocerySides}
                      onChange={(e) => setCreateGrocerySides(e.target.value)}
                      rows={2}
                      placeholder="e.g. salad, garlic bread"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor={`description-${workspace}`}>
                    Description (optional)
                  </label>
                  <textarea
                    id={`description-${workspace}`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Notes or details"
                  />
                </div>
              )}
              {isRecurringWorkspace && (
                <div>
                  <label>Repeat weekly on</label>
                  <div
                    className="weekday-picker"
                    role="group"
                    aria-label="Repeat days"
                  >
                    {SCHEDULE_WEEKDAYS.map(({ value, label }) => {
                      const active = createRepeatDays.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`weekday-toggle${active ? ' active' : ''}`}
                          aria-pressed={active}
                          onClick={() => toggleCreateRepeatDay(value)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="settings-hint">
                    Sync creates one weekly recurring event at the same time on each
                    selected day.
                  </p>
                  <label htmlFor={`repeat-time-${workspace}`}>Time of day</label>
                  <input
                    id={`repeat-time-${workspace}`}
                    type="time"
                    value={createRepeatTime}
                    onChange={(e) => setCreateRepeatTime(e.target.value)}
                    required
                  />
                </div>
              )}
              <div>
                <label htmlFor={`duration-${workspace}`}>Duration (minutes)</label>
                <input
                  id={`duration-${workspace}`}
                  type="number"
                  min={15}
                  step={15}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={
                    creating ||
                    !title.trim() ||
                    (isRecurringWorkspace && createRepeatDays.length === 0)
                  }
                >
                  {creating ? 'Adding…' : config.addButtonLabel}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>
              {config.eventsHeading}
              {pendingCount > 0 && (
                <span className="badge badge-pending">{pendingCount} pending</span>
              )}
            </h2>

            {loading ? (
              <div className="empty-state">Loading…</div>
            ) : (
              <PriorityQueue
                events={events}
                onChange={setEvents}
                onError={setError}
                onDelete={handleDelete}
                onComplete={handleComplete}
                onReorder={(ids) => workspaceApi.reorderSmartEvents(ids)}
                showMoveToBottom={workspace === 'grocery'}
                showGroceryTraits={workspace === 'grocery'}
              />
            )}
          </div>
        </section>

        <aside>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h2>Settings</h2>
            <form onSubmit={handleSaveSettings} className="settings-form">
              <p className="settings-hint" style={{ marginBottom: '0.75rem' }}>
                Busy times are read from <strong>all iCloud calendars</strong> except
                the output calendars for each events page.
              </p>
              <div>
                <label>Output calendar</label>
                {icloudCalendars.length > 0 ? (
                  <select
                    value={settingsDraft.smart_calendar_name ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        smart_calendar_name: e.target.value,
                      }))
                    }
                  >
                    {!icloudCalendars.includes(
                      settingsDraft.smart_calendar_name ?? ''
                    ) && (
                      <option value={settingsDraft.smart_calendar_name ?? ''}>
                        {settingsDraft.smart_calendar_name} (not found — create it)
                      </option>
                    )}
                    {icloudCalendars.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={settingsDraft.smart_calendar_name ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        smart_calendar_name: e.target.value,
                      }))
                    }
                  />
                )}
                <p className="settings-hint">
                  Create <strong>{config.defaultCalendarName}</strong> once in Apple
                  Calendar if it doesn&apos;t appear in this list, then click Refresh
                  calendars.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
                  onClick={loadIcloudCalendars}
                  disabled={loadingCalendars || !settings?.icloud_configured}
                >
                  {loadingCalendars ? 'Loading…' : 'Refresh calendars'}
                </button>
              </div>
              {!isRecurringWorkspace && (
                <>
                  <div style={{ marginTop: '0.75rem' }}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={settingsDraft.schedule_start_use_default !== false}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            schedule_start_use_default: e.target.checked,
                            schedule_start_date: e.target.checked
                              ? null
                              : s.schedule_start_date ?? todayDateInputValue(),
                          }))
                        }
                      />
                      Start at next available time slot (default)
                    </label>
                    <p className="settings-hint">
                      When checked, events fill the next open slot within your work hours.
                      Uncheck to pick a specific start date.
                    </p>
                  </div>
                  {settingsDraft.schedule_start_use_default === false && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <label>Start scheduling on</label>
                      <input
                        type="date"
                        min={todayDateInputValue()}
                        value={settingsDraft.schedule_start_date ?? ''}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            schedule_start_date: e.target.value || null,
                          }))
                        }
                        required
                      />
                    </div>
                  )}
                </>
              )}
              {!isRecurringWorkspace && (
                <>
                  <div className="form-row" style={{ marginTop: '0.75rem' }}>
                    <div>
                      <label>Schedule from</label>
                      <input
                        type="time"
                        value={settingsDraft.working_hours_start ?? '08:00'}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            working_hours_start: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label>Schedule until</label>
                      <input
                        type="time"
                        value={settingsDraft.working_hours_end ?? '21:00'}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            working_hours_end: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '0.75rem' }}>
                    <label>Schedule on these days</label>
                    <div className="weekday-picker" role="group" aria-label="Schedule days">
                      {SCHEDULE_WEEKDAYS.map(({ value, label }) => {
                        const active = selectedWeekdays.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            className={`weekday-toggle${active ? ' active' : ''}`}
                            aria-pressed={active}
                            onClick={() => toggleScheduleWeekday(value)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="settings-hint">
                      Events are only placed on selected days within your work hours.
                    </p>
                  </div>
                  <div className="form-row" style={{ marginTop: '0.75rem' }}>
                    <div>
                      <label>Schedule ahead (days)</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={settingsDraft.schedule_days_ahead ?? 7}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            schedule_days_ahead: Number(e.target.value),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label>Gap between events (min)</label>
                      <input
                        type="number"
                        min={0}
                        step={5}
                        value={settingsDraft.min_gap_minutes ?? 15}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            min_gap_minutes: Number(e.target.value),
                          }))
                        }
                      />
                    </div>
                  </div>
                </>
              )}
              <div style={{ marginTop: '0.75rem' }}>
                <label>Timezone</label>
                <input
                  value={settingsDraft.timezone ?? 'America/Los_Angeles'}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({ ...s, timezone: e.target.value }))
                  }
                  placeholder="America/Los_Angeles"
                />
              </div>
              <div className="form-actions" style={{ marginTop: '1rem' }}>
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={savingSettings}
                >
                  {savingSettings ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>

          <BusyTimesPreview
            configured={settings?.icloud_configured ?? false}
            refreshToken={busyPreviewRefresh}
            workspaceApi={workspaceApi}
          />
        </aside>
      </div>
    </>
  );
}

function BusyTimesPreview({
  configured,
  refreshToken,
  workspaceApi,
}: {
  configured: boolean;
  refreshToken: number;
  workspaceApi: ReturnType<typeof createWorkspaceApi>;
}) {
  const [events, setEvents] = useState<
    { title: string; start: string; end: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  async function loadPreview(refresh = false) {
    if (!configured) return;
    setLoading(true);
    setPreviewError(null);
    try {
      const data = await workspaceApi.previewBusyEvents(refresh);
      setEvents(data.busy_events);
      setFetchedAt(data.fetched_at);
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview(true);
  }, [configured, refreshToken]);

  return (
    <div className="card">
      <h2>
        All Calendar Events
        <span
          className="badge badge-pending"
          style={{ background: 'rgba(255,107,107,0.15)', color: 'var(--apple)' }}
        >
          busy times
        </span>
      </h2>
      {!configured ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Connect iCloud to preview busy times from all calendars.
        </p>
      ) : loading ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading…</p>
      ) : previewError ? (
        <div className="alert alert-warning" style={{ marginBottom: 0 }}>
          {previewError}
        </div>
      ) : events.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          No upcoming events in your scheduling window.
        </p>
      ) : (
        <div className="preview-list">
          {events.map((e, i) => (
            <div key={i} className="preview-item">
              <strong>{e.title}</strong>
              <time>
                {formatDateTime(e.start)} →{' '}
                {new Date(e.end).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </div>
          ))}
        </div>
      )}
      {configured && fetchedAt && !loading && (
        <p className="preview-fetched-at">
          Updated {formatDateTime(fetchedAt)}
        </p>
      )}
    </div>
  );
}
