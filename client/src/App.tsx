import { useEffect, useState } from 'react';
import {
  api,
  AuthError,
  createWorkspaceApi,
  loadSchedulableScheduleDaysAhead,
  runSyncAllWorkspaces,
  updateSchedulableScheduleDaysAhead,
} from './api';
import EventWorkspace from './EventWorkspace';
import Login from './Login';
import type { SyncAllProgressItem } from './types';
import {
  getWorkspaceConfig,
  SCHEDULE_DAYS_AHEAD_OPTIONS,
  WORKSPACES,
  type WorkspaceId,
} from './workspaces';

function syncAllProgressLabel(item: SyncAllProgressItem): string {
  const label = getWorkspaceConfig(item.workspace).label;

  switch (item.status) {
    case 'pending':
      return `${label} — waiting…`;
    case 'syncing':
      return `${label} — syncing to Apple Calendar…`;
    case 'synced':
      return `${label} — synced ${item.syncedCount ?? 0} event${
        item.syncedCount === 1 ? '' : 's'
      }`;
    case 'skipped':
      return `${label} — skipped (no events to sync)`;
    case 'error':
      return `${label} — ${item.error ?? 'sync failed'}`;
  }
}

function syncAllProgressAlertClass(
  items: SyncAllProgressItem[],
  syncing: boolean
): string {
  if (syncing) return 'alert-sync-progress';

  const hasError = items.some((item) => item.status === 'error');
  const hasSynced = items.some((item) => item.status === 'synced');

  if (hasError && hasSynced) return 'alert-warning';
  if (hasError) return 'alert-error';
  if (hasSynced) return 'alert-success';
  return 'alert-sync-progress';
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('smart');
  const [error, setError] = useState<string | null>(null);
  const [icloudConfigured, setIcloudConfigured] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllProgress, setSyncAllProgress] = useState<SyncAllProgressItem[] | null>(
    null
  );
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [scheduleDaysAhead, setScheduleDaysAhead] = useState(30);
  const [loadingScheduleDays, setLoadingScheduleDays] = useState(false);
  const [savingScheduleDays, setSavingScheduleDays] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then((result) => setUser(result.username))
      .catch((err) => {
        if (!(err instanceof AuthError)) {
          setError((err as Error).message);
        }
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setIcloudConfigured(false);
      return;
    }

    createWorkspaceApi('smart')
      .getSettings()
      .then((settings) => setIcloudConfigured(settings.icloud_configured ?? false))
      .catch(() => setIcloudConfigured(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;

    setLoadingScheduleDays(true);
    loadSchedulableScheduleDaysAhead()
      .then(setScheduleDaysAhead)
      .catch(() => setScheduleDaysAhead(30))
      .finally(() => setLoadingScheduleDays(false));
  }, [user, workspaceRefreshToken]);

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setError(null);
    setSyncAllProgress(null);
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    setError(null);
    setSyncAllProgress(null);
    try {
      const result = await runSyncAllWorkspaces(setSyncAllProgress);
      setWorkspaceRefreshToken((token) => token + 1);
      if (result.workspaces.length === 0) {
        setError('Nothing to sync — every workspace only has completed events.');
      }
    } catch (err) {
      setError((err as Error).message);
      setSyncAllProgress(null);
    } finally {
      setSyncingAll(false);
    }
  }

  async function handleScheduleDaysChange(days: number) {
    if (days === scheduleDaysAhead || savingScheduleDays) return;

    setSavingScheduleDays(true);
    setError(null);
    try {
      await updateSchedulableScheduleDaysAhead(days);
      setScheduleDaysAhead(days);
      setWorkspaceRefreshToken((token) => token + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingScheduleDays(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="login-page">
        <div className="empty-state">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  const activeConfig = WORKSPACES.find((w) => w.id === activeWorkspace)!;
  const syncAllWarnings =
    syncAllProgress?.flatMap((item) =>
      (item.result?.errors ?? []).map((message) => ({
        workspace: item.workspace,
        message,
      }))
    ) ?? [];

  return (
    <div className="app">
      <div className="app-utility-bar">
        <div className="app-utility-bar-start">
          <button
            className="btn-primary"
            onClick={handleSyncAll}
            disabled={syncingAll || !icloudConfigured}
          >
            {syncingAll ? 'Syncing all…' : 'Sync All'}
          </button>
          <div
            className="schedule-days-control"
            role="group"
            aria-label="Schedule events ahead in days"
          >
            <span className="schedule-days-label">Schedule ahead</span>
            <div className="schedule-days-options">
              {SCHEDULE_DAYS_AHEAD_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`weekday-toggle${
                    scheduleDaysAhead === days ? ' active' : ''
                  }`}
                  aria-pressed={scheduleDaysAhead === days}
                  disabled={loadingScheduleDays || savingScheduleDays || syncingAll}
                  onClick={() => handleScheduleDaysChange(days)}
                >
                  {days} days
                </button>
              ))}
            </div>
          </div>
        </div>
        <button className="btn-secondary" onClick={handleLogout}>
          Sign out
        </button>
      </div>

      <header className="app-top-bar">
        <div className="app-top-bar-start">
          <h1 className="app-title">{activeConfig.label}</h1>
          <nav className="workspace-tabs" aria-label="Event workspaces">
            {WORKSPACES.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={`workspace-tab${
                  activeWorkspace === workspace.id ? ' active' : ''
                }`}
                onClick={() => setActiveWorkspace(workspace.id)}
                aria-current={
                  activeWorkspace === workspace.id ? 'page' : undefined
                }
              >
                {workspace.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {syncAllProgress && (
        <div
          className={`alert ${syncAllProgressAlertClass(syncAllProgress, syncingAll)}`}
          aria-live="polite"
        >
          <strong>{syncingAll ? 'Syncing all workspaces…' : 'Sync all complete'}</strong>
          <ul className="sync-all-progress-list">
            {syncAllProgress.map((item) => (
              <li
                key={item.workspace}
                className={`sync-all-progress-item sync-all-progress-${item.status}`}
              >
                {syncAllProgressLabel(item)}
              </li>
            ))}
          </ul>
          {!syncingAll && syncAllWarnings.length > 0 && (
            <div className="sync-result" style={{ marginTop: '0.5rem' }}>
              {syncAllWarnings.map(({ workspace, message }, index) => (
                <div key={`${workspace}-${index}`}>
                  {getWorkspaceConfig(workspace).label}: {message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <EventWorkspace
        key={activeWorkspace}
        workspace={activeWorkspace}
        refreshToken={workspaceRefreshToken}
        globalSyncing={syncingAll}
      />
    </div>
  );
}
