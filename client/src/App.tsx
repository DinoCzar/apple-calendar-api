import { useEffect, useState } from 'react';
import { api, AuthError, createWorkspaceApi, runSyncAllWorkspaces } from './api';
import EventWorkspace from './EventWorkspace';
import Login from './Login';
import type { SyncAllResult } from './types';
import { getWorkspaceConfig, WORKSPACES, type WorkspaceId } from './workspaces';

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('smart');
  const [error, setError] = useState<string | null>(null);
  const [icloudConfigured, setIcloudConfigured] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllResult, setSyncAllResult] = useState<SyncAllResult | null>(null);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);

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

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setError(null);
    setSyncAllResult(null);
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    setError(null);
    setSyncAllResult(null);
    try {
      const result = await runSyncAllWorkspaces();
      setSyncAllResult(result);
      setWorkspaceRefreshToken((token) => token + 1);
      if (result.workspaces.length === 0) {
        setError('Nothing to sync — every workspace only has completed events.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncingAll(false);
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
  const syncAllErrors = syncAllResult?.workspaces.flatMap(({ workspace, result }) =>
    result.errors.map((message) => ({
      workspace,
      message,
    }))
  );

  return (
    <div className="app">
      <div className="app-utility-bar">
        <button
          className="btn-primary"
          onClick={handleSyncAll}
          disabled={syncingAll || !icloudConfigured}
        >
          {syncingAll ? 'Syncing all…' : 'Sync All'}
        </button>
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

      {syncAllResult && syncAllResult.workspaces.length > 0 && (
        <div className="alert alert-success">
          Synced{' '}
          {syncAllResult.workspaces.map(({ workspace, result }, index) => {
            const label = getWorkspaceConfig(workspace).label;
            return (
              <span key={workspace}>
                {index > 0 ? ', ' : ''}
                <strong>{label}</strong> ({result.smartEventsSynced} synced)
              </span>
            );
          })}
          .
          {syncAllErrors && syncAllErrors.length > 0 && (
            <div className="sync-result" style={{ marginTop: '0.5rem' }}>
              {syncAllErrors.map(({ workspace, message }, index) => (
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
