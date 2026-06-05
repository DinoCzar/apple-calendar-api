import { useState } from 'react';
import { api } from './api';
import type { SmartEvent } from './types';

function reorder<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...list];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

interface PriorityQueueProps {
  events: SmartEvent[];
  onChange: (events: SmartEvent[]) => void;
  onError: (message: string) => void;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
}

export default function PriorityQueue({
  events,
  onChange,
  onError,
  onDelete,
  onComplete,
}: PriorityQueueProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pending = events
    .filter((e) => e.status === 'pending')
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));

  const other = events.filter((e) => e.status !== 'pending');

  async function persistOrder(reordered: SmartEvent[]) {
    setSaving(true);
    try {
      const updated = await api.reorderSmartEvents(reordered.map((e) => e.id));
      onChange(updated);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
      setDraggedId(null);
      setDragOverId(null);
    }
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;

    const fromIndex = pending.findIndex((e) => e.id === draggedId);
    const toIndex = pending.findIndex((e) => e.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = reorder(pending, fromIndex, toIndex).map((e, i) => ({
      ...e,
      priority: i + 1,
    }));

    const nonPending = events.filter((e) => e.status !== 'pending');
    onChange([...reordered, ...nonPending]);
    persistOrder(reordered);
  }

  if (pending.length === 0 && other.length === 0) {
    return (
      <div className="empty-state">
        <strong>No smart events yet</strong>
        <p>Add a task above, then drag to set priority before syncing.</p>
      </div>
    );
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="priority-section">
          <p className="priority-hint">
            Drag to reorder by priority, then click <strong>Sync Smart Events</strong> to
            place them in the first open slots and push to your Smart Events calendar.
            {saving && <span className="priority-saving"> Saving…</span>}
          </p>
          <div className="event-list priority-list">
            {pending.map((event, index) => (
              <div
                key={event.id}
                className={`event-item event-item-draggable ${
                  draggedId === event.id ? 'dragging' : ''
                } ${dragOverId === event.id && draggedId !== event.id ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverId(event.id);
                }}
                onDragLeave={() => {
                  if (dragOverId === event.id) setDragOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(event.id);
                }}
              >
                <div
                  className="drag-handle"
                  title="Drag to reorder"
                  draggable={!saving}
                  onDragStart={(e) => {
                    setDraggedId(event.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                >
                  <span className="priority-rank">{index + 1}</span>
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                    <circle cx="2" cy="2" r="1.5" />
                    <circle cx="8" cy="2" r="1.5" />
                    <circle cx="2" cy="8" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="2" cy="14" r="1.5" />
                    <circle cx="8" cy="14" r="1.5" />
                  </svg>
                </div>
                <EventBody event={event} />
                <EventActions
                  event={event}
                  onDelete={onDelete}
                  onComplete={onComplete}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {other.length > 0 && (
        <div className={`event-list ${pending.length > 0 ? 'scheduled-list' : ''}`}>
          {other.map((event) => (
            <div key={event.id} className="event-item">
              <EventBody event={event} />
              <EventActions
                event={event}
                onDelete={onDelete}
                onComplete={onComplete}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EventBody({ event }: { event: SmartEvent }) {
  return (
    <div className="event-item-main">
      <h3>{event.title}</h3>
      {event.description && (
        <p className="event-description">{event.description}</p>
      )}
      <div className="event-meta">
        <span>{event.duration_minutes} min</span>
        {event.status !== 'pending' && <span>Priority {event.priority}</span>}
        {event.scheduled_start && event.scheduled_end && (
          <span>
            {formatDateTime(event.scheduled_start)} →{' '}
            {new Date(event.scheduled_end).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function EventActions({
  event,
  onDelete,
  onComplete,
}: {
  event: SmartEvent;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const labels: Record<SmartEvent['status'], string> = {
    pending: 'Pending',
    scheduled: 'Scheduled',
    synced: 'In Apple Calendar',
    completed: 'Completed',
  };

  return (
    <div className="event-actions">
      <span className={`badge badge-${event.status}`}>{labels[event.status]}</span>
      {event.status !== 'completed' && (
        <button
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          onClick={() => onComplete(event.id)}
        >
          Done
        </button>
      )}
      <button className="btn-danger" onClick={() => onDelete(event.id)}>
        Delete
      </button>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
