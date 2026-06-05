import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createSmartEvent,
  deleteSmartEvent,
  getSmartEvent,
  listSmartEvents,
  reorderSmartEvents,
  updateSmartEvent,
} from '../db';
import type { CreateSmartEventInput, UpdateSmartEventInput } from '../types';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const events = await listSmartEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/reorder', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'ids must be an array of event IDs' });
      return;
    }
    const events = await reorderSmartEvents(ids);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const event = await getSmartEvent(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'Smart event not found' });
      return;
    }
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/', async (req, res) => {
  try {
    const input = req.body as CreateSmartEventInput;
    if (!input.title?.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    const event = await createSmartEvent(uuidv4(), input);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const input = req.body as UpdateSmartEventInput;
    const event = await updateSmartEvent(req.params.id, input);
    if (!event) {
      res.status(404).json({ error: 'Smart event not found' });
      return;
    }
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteSmartEvent(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Smart event not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
