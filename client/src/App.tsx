import { useEffect, useState } from 'react';
import { api, AuthError } from './api';
import EventWorkspace from './EventWorkspace';
import Login from './Login';
import { WORKSPACES, type WorkspaceId } from './workspaces';

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('smart');
  const [error, setError] = useState<string | null>(null);

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

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setError(null);
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

  return (
    <div className="app">
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
        <button className="btn-secondary" onClick={handleLogout}>
          Sign out
        </button>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <EventWorkspace key={activeWorkspace} workspace={activeWorkspace} />
    </div>
  );
}
