export const WORKSPACE_IDS = [
  'smart',
  'grocery',
  'work',
  'home',
  'project',
  'other',
  'recurring',
] as const;
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
    id: 'grocery',
    label: 'Grocery Events',
    eventLabel: 'Grocery Event',
    eventsHeading: 'Your Grocery Events',
    newEventHeading: 'New Grocery Event',
    addButtonLabel: 'Add Grocery Event',
    syncButtonLabel: 'Sync Grocery Events',
    defaultCalendarName: 'Grocery Events',
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
  {
    id: 'home',
    label: 'Home Events',
    eventLabel: 'Home Event',
    eventsHeading: 'Your Home Events',
    newEventHeading: 'New Home Event',
    addButtonLabel: 'Add Home Event',
    syncButtonLabel: 'Sync Home Events',
    defaultCalendarName: 'Home Events',
  },
  {
    id: 'project',
    label: 'Project Events',
    eventLabel: 'Project Event',
    eventsHeading: 'Your Project Events',
    newEventHeading: 'New Project Event',
    addButtonLabel: 'Add Project Event',
    syncButtonLabel: 'Sync Project Events',
    defaultCalendarName: 'Project Events',
  },
  {
    id: 'other',
    label: 'Other Events',
    eventLabel: 'Other Event',
    eventsHeading: 'Your Other Events',
    newEventHeading: 'New Other Event',
    addButtonLabel: 'Add Other Event',
    syncButtonLabel: 'Sync Other Events',
    defaultCalendarName: 'Other Events',
  },
  {
    id: 'recurring',
    label: 'Recurring Events',
    eventLabel: 'Recurring Event',
    eventsHeading: 'Your Recurring Events',
    newEventHeading: 'New Recurring Event',
    addButtonLabel: 'Add Recurring Event',
    syncButtonLabel: 'Sync Recurring Events',
    defaultCalendarName: 'Recurring Events',
  },
];

export function getWorkspaceConfig(id: WorkspaceId): WorkspaceConfig {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
}

export const SCHEDULABLE_WORKSPACE_IDS = WORKSPACE_IDS.filter(
  (id): id is Exclude<WorkspaceId, 'recurring'> => id !== 'recurring'
);

export const SCHEDULE_DAYS_AHEAD_OPTIONS = [30, 60, 90] as const;
export type ScheduleDaysAhead = (typeof SCHEDULE_DAYS_AHEAD_OPTIONS)[number];
