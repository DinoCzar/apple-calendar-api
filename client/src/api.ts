import type {
  AppSettings,
  AppleEventPreview,
  RecallResult,
  SmartEvent,
  SyncResult,
} from './types';

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
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getMe: () => request<{ username: string }>('/auth/me'),
  login: (username: string, password: string) =>
    request<{ username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  getSmartEvents: () => request<SmartEvent[]>('/smart-events'),
  createSmartEvent: (data: {
    title: string;
    description?: string;
    duration_minutes?: number;
    priority?: number;
  }) =>
    request<SmartEvent>('/smart-events', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSmartEvent: (id: string, data: Partial<SmartEvent>) =>
    request<SmartEvent>(`/smart-events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteSmartEvent: (id: string) =>
    request<void>(`/smart-events/${id}`, { method: 'DELETE' }),
  reorderSmartEvents: (ids: string[]) =>
    request<SmartEvent[]>('/smart-events/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  getSettings: () => request<AppSettings>('/settings'),
  updateSettings: (data: Partial<AppSettings>) =>
    request<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  listCalendars: () => request<{ name: string; url: string }[]>('/settings/calendars'),
  runSync: (reschedule = false) =>
    request<SyncResult>('/sync', {
      method: 'POST',
      body: JSON.stringify({ reschedule }),
    }),
  runRecall: () =>
    request<RecallResult>('/sync/recall', {
      method: 'POST',
    }),
  previewBusyEvents: () =>
    request<{ busy_events: AppleEventPreview[] }>('/sync/preview'),
};
