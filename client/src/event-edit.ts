import type { SmartEvent } from './types';

export interface StandardEventUpdate {
  title: string;
  description: string | null;
  duration_minutes: number;
}

export function toStandardEventUpdate(event: SmartEvent): StandardEventUpdate {
  return {
    title: event.title,
    description: event.description,
    duration_minutes: event.duration_minutes,
  };
}

export function normalizeStandardEventUpdate(
  draft: StandardEventUpdate
): StandardEventUpdate {
  return {
    title: draft.title.trim(),
    description: draft.description?.trim() || null,
    duration_minutes: draft.duration_minutes,
  };
}
