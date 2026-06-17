import { Router } from 'express';
import { getSettings } from '../db';
import { fetchAllBusyEvents, getScheduleFetchRange, getSchedulingWindow } from '../services/caldav';
import { runFullSync, runRecall } from '../services/sync';
import { isICloudConfigured } from '../config';

const router = Router();

router.post('/', async (req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }

    const reschedule = req.body?.reschedule !== false;
    const result = await runFullSync({ reschedule });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/recall', async (_req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }

    const result = await runRecall();
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

    const settings = await getSettings();
    const { start: rangeStart, end: rangeEnd } = getScheduleFetchRange(settings);
    const { start: windowStart, end: windowEnd } = getSchedulingWindow(settings);
    const refresh =
      req.query.refresh === '1' ||
      req.query.refresh === 'true' ||
      typeof req.query.t === 'string';

    const busyEvents = await fetchAllBusyEvents(settings, rangeStart, rangeEnd, {
      refresh,
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
