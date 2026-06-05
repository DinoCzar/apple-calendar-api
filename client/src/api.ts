import type { AppSettings, AppleEventPreview, SmartEvent, SyncResult } from './types';

const API = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
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
  previewBusyEvents: () =>
    request<{ busy_events: AppleEventPreview[] }>('/sync/preview'),
};
