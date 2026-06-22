import type {
  AppSettings,
  AppleEventPreview,
  PersistedAppSettings,
  SmartEvent,
  SyncAllProgressItem,
  SyncAllResult,
  SyncResult,
} from './types';
import { SCHEDULABLE_WORKSPACE_IDS, WORKSPACE_IDS, type WorkspaceId } from './workspaces';

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
      repeat_days_of_week?: number[];
      repeat_time_of_day?: string;
      grocery_sides?: string;
      grocery_recipe?: string;
      grocery_ingredients?: string;
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
    previewBusyEvents: (refresh = false) => {
      const query = refresh ? `?refresh=1&t=${Date.now()}` : '';
      return request<{ busy_events: AppleEventPreview[]; fetched_at: string }>(
        withWorkspace(`/sync/preview${query}`, workspace)
      );
    },
  };
}

export async function runSyncAllWorkspaces(
  onProgress?: (items: SyncAllProgressItem[]) => void
): Promise<SyncAllResult> {
  const items: SyncAllProgressItem[] = WORKSPACE_IDS.map((workspace) => ({
    workspace,
    status: 'pending',
  }));
  const workspaces: SyncAllResult['workspaces'] = [];

  const emit = () => onProgress?.(items.map((item) => ({ ...item })));

  emit();

  for (let index = 0; index < WORKSPACE_IDS.length; index++) {
    const workspace = WORKSPACE_IDS[index];
    const workspaceApi = createWorkspaceApi(workspace);
    const settings = await workspaceApi.getSettings();

    if (!settings.icloud_configured) {
      throw new Error(
        'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.'
      );
    }

    const events = await workspaceApi.getSmartEvents();
    const syncableCount = events.filter((event) => event.status !== 'completed').length;
    if (syncableCount === 0) {
      items[index] = { workspace, status: 'skipped' };
      emit();
      continue;
    }

    items[index] = { workspace, status: 'syncing' };
    emit();

    try {
      const result = await workspaceApi.runSync(true);
      items[index] = {
        workspace,
        status: 'synced',
        syncedCount: result.smartEventsSynced,
        result,
      };
      workspaces.push({ workspace, result });
    } catch (err) {
      items[index] = {
        workspace,
        status: 'error',
        error: (err as Error).message,
      };
    }

    emit();
  }

  return { workspaces };
}

export async function loadSchedulableScheduleDaysAhead(): Promise<number> {
  const settings = await Promise.all(
    SCHEDULABLE_WORKSPACE_IDS.map((workspace) =>
      createWorkspaceApi(workspace).getSettings()
    )
  );
  const days = settings.map((item) => item.schedule_days_ahead);
  return days[0] ?? 30;
}

export async function updateSchedulableScheduleDaysAhead(
  days: number
): Promise<void> {
  await Promise.all(
    SCHEDULABLE_WORKSPACE_IDS.map((workspace) =>
      createWorkspaceApi(workspace).updateSettings({ schedule_days_ahead: days })
    )
  );
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
