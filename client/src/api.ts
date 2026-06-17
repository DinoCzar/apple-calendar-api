import type {
  AppSettings,
  AppleEventPreview,
  PersistedAppSettings,
  RecallResult,
  SmartEvent,
  SyncResult,
} from './types';
import type { WorkspaceId } from './workspaces';

const API = '/api';

export class AuthError extends Error {
  constructor(message = 'Login required') {
    super(message);
    this.name = 'AuthError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (res.status === 401) {
    throw new AuthError();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 502) {
      throw new Error(
        body.error ||
          'Server unavailable during sync (502). The app may still be deploying or restarting — wait a minute and try again.'
      );
    }
    if (res.status === 504) {
      throw new Error(
        body.error ||
          'Sync timed out. Try again, or reduce schedule-ahead days in Settings.'
      );
    }
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

function withWorkspace(path: string, workspace: WorkspaceId): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}workspace=${workspace}`;
}

export function createWorkspaceApi(workspace: WorkspaceId) {
  return {
    getSmartEvents: () =>
      request<SmartEvent[]>(withWorkspace('/smart-events', workspace)),
    createSmartEvent: (data: {
      title: string;
      description?: string;
      duration_minutes?: number;
      priority?: number;
    }) =>
      request<SmartEvent>('/smart-events', {
        method: 'POST',
        body: JSON.stringify({ ...data, workspace }),
      }),
    updateSmartEvent: (id: string, data: Partial<SmartEvent>) =>
      request<SmartEvent>(`/smart-events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...data, workspace }),
      }),
    deleteSmartEvent: (id: string) =>
      request<void>(withWorkspace(`/smart-events/${id}`, workspace), {
        method: 'DELETE',
      }),
    reorderSmartEvents: (ids: string[]) =>
      request<SmartEvent[]>('/smart-events/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids, workspace }),
      }),
    getSettings: () =>
      request<AppSettings>(withWorkspace('/settings', workspace), {
        cache: 'no-store',
      }),
    updateSettings: (data: Partial<PersistedAppSettings>) =>
      request<AppSettings>('/settings', {
        method: 'PUT',
        cache: 'no-store',
        body: JSON.stringify({ ...data, workspace }),
      }),
    runSync: (reschedule = false) =>
      request<SyncResult>('/sync', {
        method: 'POST',
        body: JSON.stringify({ reschedule, workspace }),
      }),
    runRecall: () =>
      request<RecallResult>('/sync/recall', {
        method: 'POST',
        body: JSON.stringify({ workspace }),
      }),
    previewBusyEvents: (refresh = false) => {
      const query = refresh ? `?refresh=1&t=${Date.now()}` : '';
      return request<{ busy_events: AppleEventPreview[]; fetched_at: string }>(
        withWorkspace(`/sync/preview${query}`, workspace)
      );
    },
  };
}

export const api = {
  getMe: () => request<{ username: string }>('/auth/me'),
  login: (username: string, password: string) =>
    request<{ username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  listCalendars: () =>
    request<{ name: string; url: string }[]>('/settings/calendars'),
};
