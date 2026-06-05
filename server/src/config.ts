import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  icloud: {
    username: process.env.ICLOUD_USERNAME || '',
    password: process.env.ICLOUD_APP_PASSWORD || '',
    serverUrl: 'https://caldav.icloud.com',
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
