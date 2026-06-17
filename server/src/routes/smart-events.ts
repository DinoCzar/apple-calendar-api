import { Router } from 'express';
import {
  createSmartEvent,
  deleteSmartEvent,
  getSmartEvent,
  listSmartEvents,
  reorderSmartEvents,
  updateSmartEvent,
} from '../db';
import type { CreateSmartEventInput, UpdateSmartEventInput } from '../types';
import { workspaceFromRequest, type WorkspaceId } from '../workspace';

const router = Router();

function validateRepeatDays(
  workspace: WorkspaceId,
  repeatDays: unknown
): string | null {
  if (workspace !== 'recurring') {
    return null;
  }

  if (!Array.isArray(repeatDays) || repeatDays.length === 0) {
    return 'Select at least one repeat day for recurring events';
  }

  if (
    !repeatDays.every(
      (day) => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6
    )
  ) {
    return 'Repeat days must be valid weekdays';
  }

  return null;
}

function validateRepeatTime(
  workspace: WorkspaceId,
  repeatTime: unknown
): string | null {
  if (workspace !== 'recurring') {
    return null;
  }

  if (typeof repeatTime !== 'string' || !/^\d{2}:\d{2}$/.test(repeatTime)) {
    return 'Choose a valid time of day for the recurring event';
  }

  const [hour, minute] = repeatTime.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    return 'Choose a valid time of day for the recurring event';
  }

  return null;
}

router.get('/', async (req, res) => {
  try {
    const workspace = workspaceFromRequest(req);
    const events = await listSmartEvents(workspace);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/reorder', async (req, res) => {
  try {
    const workspace = workspaceFromRequest(req);
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'ids must be an array of event IDs' });
      return;
    }
    const events = await reorderSmartEvents(workspace, ids);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const workspace = workspaceFromRequest(req);
    const event = await getSmartEvent(req.params.id, workspace);
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
    const workspace = workspaceFromRequest(req);
    const input = req.body as CreateSmartEventInput;
    if (!input.title?.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    const repeatError = validateRepeatDays(workspace, input.repeat_days_of_week);
    if (repeatError) {
      res.status(400).json({ error: repeatError });
      return;
    }
    const timeError = validateRepeatTime(workspace, input.repeat_time_of_day);
    if (timeError) {
      res.status(400).json({ error: timeError });
      return;
    }
    const event = await createSmartEvent(workspace, input);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const workspace = workspaceFromRequest(req);
    const input = req.body as UpdateSmartEventInput;
    const event = await updateSmartEvent(req.params.id, workspace, input);
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
    const workspace = workspaceFromRequest(req);
    const deleted = await deleteSmartEvent(req.params.id, workspace);
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
