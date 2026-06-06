import { Router } from 'express';
import { getSettings } from '../db';
import { fetchAllBusyEvents, getScheduleFetchRange } from '../services/caldav';
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

router.get('/preview', async (_req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }

    const settings = await getSettings();
    const { start: rangeStart, end: rangeEnd } = getScheduleFetchRange(settings);

    const busyEvents = await fetchAllBusyEvents(settings, rangeStart, rangeEnd);
    res.json({
      busy_events: busyEvents.map((e) => ({
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
