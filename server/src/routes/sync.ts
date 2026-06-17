import { Router } from 'express';
import { getSettings } from '../db';
import { fetchAllBusyEvents, getScheduleFetchRange, getSchedulingWindow } from '../services/caldav';
import { runFullSync, runRecall } from '../services/sync';
import { isICloudConfigured } from '../config';
import { withTimeout } from '../utils/async';
import { WORKSPACE_IDS, workspaceFromRequest } from '../workspace';

const router = Router();
const SYNC_TIMEOUT_MS = 120_000;

async function outputCalendarNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const workspace of WORKSPACE_IDS) {
    const settings = await getSettings(workspace);
    names.add(settings.smart_calendar_name);
  }
  return [...names];
}

router.post('/', async (req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }

    const workspace = workspaceFromRequest(req);
    const reschedule = req.body?.reschedule !== false;
    const result = await withTimeout(
      runFullSync({ workspace, reschedule }),
      SYNC_TIMEOUT_MS,
      'Sync'
    );
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes('timed out') ? 504 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/recall', async (req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }

    const workspace = workspaceFromRequest(req);
    const result = await runRecall(workspace);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/preview', async (req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }

    res.set('Cache-Control', 'no-store');

    const workspace = workspaceFromRequest(req);
    const settings = await getSettings(workspace);
    const excludeCalendarNames = await outputCalendarNames();
    const { start: rangeStart, end: rangeEnd } = getScheduleFetchRange(settings);
    const { start: windowStart, end: windowEnd } = getSchedulingWindow(settings);
    const refresh =
      req.query.refresh === '1' ||
      req.query.refresh === 'true' ||
      typeof req.query.t === 'string';

    const busyEvents = await fetchAllBusyEvents(settings, rangeStart, rangeEnd, {
      refresh,
      excludeCalendarNames,
    });
    const now = new Date();

    res.json({
      fetched_at: now.toISOString(),
      schedule_window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      busy_events: busyEvents
        .filter((e) => e.end > now && e.start < windowEnd && e.end > windowStart)
        .map((e) => ({
          title: e.title,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          all_day: e.allDay,
        })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
