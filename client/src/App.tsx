import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import PriorityQueue from './PriorityQueue';
import type { AppSettings, SmartEvent, SyncResult } from './types';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function App() {
  const [events, setEvents] = useState<SmartEvent[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(30);
  const [creating, setCreating] = useState(false);

  const [settingsDraft, setSettingsDraft] = useState<Partial<AppSettings>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [icloudCalendars, setIcloudCalendars] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evts, cfg] = await Promise.all([
        api.getSmartEvents(),
        api.getSettings(),
      ]);
      setEvents(evts);
      setSettings(cfg);
      setSettingsDraft(cfg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (settings?.icloud_configured) {
      loadIcloudCalendars();
    }
  }, [settings?.icloud_configured]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const pendingCount = events.filter((e) => e.status === 'pending').length;
      await api.createSmartEvent({
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
    if (!confirm('Delete this smart event?')) return;
    try {
      await api.deleteSmartEvent(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleComplete(id: string) {
    try {
      await api.updateSmartEvent(id, { status: 'completed' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSyncSmartEvents() {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await api.runSync(true);
      setSyncResult(result);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

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

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    try {
      const updated = await api.updateSettings(settingsDraft);
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

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Smart Events</h1>
          <p>
            Drag to set priority, then sync — smart events fill open slots between{' '}
            <strong>
              {settings?.working_hours_start ?? '08:00'}–{settings?.working_hours_end ?? '21:00'}
            </strong>{' '}
            when no other iCloud events are scheduled, then push to{' '}
            <strong>{settings?.smart_calendar_name ?? 'Smart Events'}</strong>.
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
            onClick={handleSyncSmartEvents}
            disabled={
              syncing ||
              !settings?.icloud_configured ||
              syncableCount === 0
            }
          >
            {syncing ? 'Syncing…' : 'Sync Smart Events'}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {syncResult && (
        <div className="alert alert-success">
          Replaced <strong>{syncResult.smartEventsCleared}</strong> old event
          {syncResult.smartEventsCleared === 1 ? '' : 's'} with{' '}
          <strong>{syncResult.smartEventsSynced}</strong> new on{' '}
          <strong>{settings?.smart_calendar_name ?? 'Smart Events'}</strong>{' '}
          ({syncResult.appleEventsFetched} busy blocks across all iCloud calendars).
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
            <h2>New Smart Event</h2>
            <form onSubmit={handleCreate} className="form-grid">
              <div>
                <label htmlFor="title">Title</label>
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Review quarterly report"
                  required
                />
              </div>
              <div>
                <label htmlFor="description">Description (optional)</label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Notes or details"
                />
              </div>
              <div>
                <label htmlFor="duration">Duration (minutes)</label>
                <input
                  id="duration"
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
                  {creating ? 'Adding…' : 'Add Smart Event'}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>
              Your Smart Events
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
                the Smart Events output calendar below.
              </p>
              <div>
                <label>Smart events output calendar</label>
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
                  Create <strong>Smart Events</strong> once in Apple Calendar if it
                  doesn&apos;t appear in this list, then click Refresh calendars.
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

          <BusyTimesPreview configured={settings?.icloud_configured ?? false} />
        </aside>
      </div>
    </div>
  );
}

function BusyTimesPreview({ configured }: { configured: boolean }) {
  const [events, setEvents] = useState<
    { title: string; start: string; end: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function loadPreview() {
    if (!configured) return;
    setLoading(true);
    setPreviewError(null);
    try {
      const data = await api.previewBusyEvents();
      setEvents(data.busy_events);
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
  }, [configured]);

  return (
    <div className="card">
      <h2>
        All Calendar Events
        <span className="badge badge-pending" style={{ background: 'rgba(255,107,107,0.15)', color: 'var(--apple)' }}>
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
          No upcoming events — smart events can fill 8am–9pm.
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
        <button
          className="btn-secondary"
          style={{ marginTop: '0.75rem', width: '100%', fontSize: '0.85rem' }}
          onClick={loadPreview}
          disabled={loading}
        >
          Refresh
        </button>
      )}
    </div>
  );
}
