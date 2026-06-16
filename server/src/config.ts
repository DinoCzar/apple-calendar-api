import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  turso: {
    url: process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '',
    authToken:
      process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '',
  },
  icloud: {
    username: process.env.ICLOUD_USERNAME || '',
    password: process.env.ICLOUD_APP_PASSWORD || '',
    serverUrl: 'https://caldav.icloud.com',
  },
  auth: {
    username: process.env.AUTH_USERNAME || process.env.ICLOUD_USERNAME || '',
    password: process.env.AUTH_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    secureCookies: process.env.NODE_ENV === 'production',
  },
  defaults: {
    appleCalendarName: process.env.APPLE_CALENDAR_NAME || 'apple events',
    smartCalendarName: process.env.SMART_CALENDAR_NAME || 'Smart Events',
    workingHoursStart: process.env.WORKING_HOURS_START || '08:00',
    workingHoursEnd: process.env.WORKING_HOURS_END || '21:00',
    scheduleDaysAhead: parseInt(process.env.SCHEDULE_DAYS_AHEAD || '7', 10),
    minGapMinutes: parseInt(process.env.MIN_GAP_MINUTES || '15', 10),
    timezone: process.env.TIMEZONE || 'America/Los_Angeles',
  },
};

export function isICloudConfigured(): boolean {
  return Boolean(config.icloud.username && config.icloud.password);
}

export function isAuthConfigured(): boolean {
  return Boolean(
    (config.auth.username || config.icloud.username) &&
      config.auth.password &&
      config.auth.sessionSecret
  );
}

export function isTursoConfigured(): boolean {
  return Boolean(config.turso.url);
}
