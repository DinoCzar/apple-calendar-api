import type { Request } from 'express';

export const WORKSPACE_IDS = [
  'smart',
  'work',
  'home',
  'project',
  'other',
  'recurring',
] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

const DEFAULT_CALENDAR_NAMES: Record<WorkspaceId, string> = {
  smart: 'Smart Events',
  work: 'Work Events',
  home: 'Home Events',
  project: 'Project Events',
  other: 'Other Events',
  recurring: 'Recurring Events',
};

export function isWorkspaceId(value: string): value is WorkspaceId {
  return WORKSPACE_IDS.includes(value as WorkspaceId);
}

export function parseWorkspace(value: unknown): WorkspaceId {
  if (typeof value === 'string' && isWorkspaceId(value)) {
    return value;
  }
  return 'smart';
}

export function workspaceFromRequest(req: Request): WorkspaceId {
  const query = req.query.workspace;
  if (typeof query === 'string') {
    return parseWorkspace(query);
  }
  if (req.body && typeof req.body === 'object' && 'workspace' in req.body) {
    return parseWorkspace((req.body as { workspace?: unknown }).workspace);
  }
  return 'smart';
}

export function settingsStorageKey(
  workspace: WorkspaceId,
  key: string
): string {
  return `${workspace}:${key}`;
}

export function defaultCalendarName(workspace: WorkspaceId): string {
  return DEFAULT_CALENDAR_NAMES[workspace];
}
