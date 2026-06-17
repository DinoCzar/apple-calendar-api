import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, createWorkspaceApi } from './api';
import PriorityQueue from './PriorityQueue';
import type { AppSettings, RecallResult, SmartEvent, SyncResult } from './types';
import { toPersistedSettings } from './types';
import { getWorkspaceConfig, type WorkspaceId } from './workspaces';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
  const [recalling, setRecalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [recallResult, setRecallResult] = useState<RecallResult | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(30);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const pendingCount = events.filter((ev) => ev.status === 'pending').length;
      await workspaceApi.createSmartEvent({
        title: title.trim(),
        description: description.trim() || undefined,
        duration_minutes: duration,
        priority: pendingCount + 1,
      });
      setTitle('');
      setDescription('');
      setDuration(30);
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
    setRecallResult(null);
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

  async function handleRecallEvents() {
    const calendarName = settings?.smart_calendar_name ?? config.defaultCalendarName;
    const onCalendar = events.filter(
      (e) => e.status === 'synced' || e.status === 'scheduled'
    ).length;

    if (
      !confirm(
        `Remove events from your ${calendarName} calendar` +
          (onCalendar > 0
            ? ` and return ${onCalendar} to pending?`
            : '?')
      )
    ) {
      return;
    }

    setRecalling(true);
    setError(null);
    setSyncResult(null);
    setRecallResult(null);
    try {
      const result = await workspaceApi.runRecall();
      setRecallResult(result);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecalling(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    try {
      const updated = await workspaceApi.updateSettings(
        toPersistedSettings(settingsDraft)
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

  return (
    <>
      <header className="header workspace-header">
        <div>
          <p className="workspace-description">
            Drag to set priority, then sync — recalls old events, refreshes iCloud
            busy times, and pushes a new schedule to <strong>{calendarName}</strong>.
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
            className="btn-secondary"
            onClick={handleRecallEvents}
            disabled={recalling || syncing || !settings?.icloud_configured}
          >
            {recalling ? 'Recalling…' : 'Recall Events'}
          </button>
          <button
            className="btn-primary"
            onClick={handleSync}
            disabled={
              syncing ||
              recalling ||
              !settings?.icloud_configured ||
              syncableCount === 0
            }
          >
            {syncing ? 'Syncing…' : config.syncButtonLabel}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {recallResult && (
        <div className="alert alert-success">
          Removed <strong>{recallResult.calendarEventsRemoved}</strong> event
          {recallResult.calendarEventsRemoved === 1 ? '' : 's'} from{' '}
          <strong>{calendarName}</strong>
          {recallResult.smartEventsRecalled > 0 && (
            <>
              {' '}
              and returned <strong>{recallResult.smartEventsRecalled}</strong> to
              pending
            </>
          )}
          .
          {recallResult.errors.length > 0 && (
            <div className="sync-result" style={{ marginTop: '0.5rem' }}>
              {recallResult.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

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
                  disabled={creating || !title.trim()}
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
                the Smart Events and Work Events output calendars.
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
      {configured && (
        <div className="preview-footer">
          {fetchedAt && !loading && (
            <p className="preview-fetched-at">
              Updated {formatDateTime(fetchedAt)}
            </p>
          )}
          <button
            className="btn-secondary"
            style={{ width: '100%', fontSize: '0.85rem' }}
            onClick={() => loadPreview(true)}
            disabled={loading}
          >
            {loading ? 'Refreshing from iCloud…' : 'Refresh from iCloud'}
          </button>
        </div>
      )}
    </div>
  );
}
