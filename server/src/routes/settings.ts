import { Router } from 'express';
import { getSettings, updateSettings } from '../db';
import { listCalendars } from '../services/caldav';
import { isICloudConfigured } from '../config';
import type { AppSettings } from '../types';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      ...settings,
      icloud_configured: isICloudConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/', async (req, res) => {
  try {
    const updates = req.body as Partial<AppSettings>;
    const settings = await updateSettings(updates);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/calendars', async (_req, res) => {
  try {
    if (!isICloudConfigured()) {
      res.status(400).json({
        error: 'iCloud not configured. Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD.',
      });
      return;
    }
    const calendars = await listCalendars();
    res.json(calendars);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
