export const WORKSPACE_IDS = ['smart', 'work'] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export interface WorkspaceConfig {
  id: WorkspaceId;
  label: string;
  eventLabel: string;
  eventsHeading: string;
  newEventHeading: string;
  addButtonLabel: string;
  syncButtonLabel: string;
  defaultCalendarName: string;
}

export const WORKSPACES: WorkspaceConfig[] = [
  {
    id: 'smart',
    label: 'Smart Events',
    eventLabel: 'Smart Event',
    eventsHeading: 'Your Smart Events',
    newEventHeading: 'New Smart Event',
    addButtonLabel: 'Add Smart Event',
    syncButtonLabel: 'Sync Smart Events',
    defaultCalendarName: 'Smart Events',
  },
  {
    id: 'work',
    label: 'Work Events',
    eventLabel: 'Work Event',
    eventsHeading: 'Your Work Events',
    newEventHeading: 'New Work Event',
    addButtonLabel: 'Add Work Event',
    syncButtonLabel: 'Sync Work Events',
    defaultCalendarName: 'Work Events',
  },
];

export function getWorkspaceConfig(id: WorkspaceId): WorkspaceConfig {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
}
