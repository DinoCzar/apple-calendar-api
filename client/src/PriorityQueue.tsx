import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { SmartEvent } from './types';

function reorder<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...list];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

function sortByPriority(events: SmartEvent[]): SmartEvent[] {
  return [...events].sort(
    (a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)
  );
}

function getEventIdFromTouch(touch: Touch): string | null {
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const item = el?.closest('[data-event-id]');
  return item?.getAttribute('data-event-id') ?? null;
}

function useIsMobileLayout(): boolean {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 768px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
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
  const isMobile = useIsMobileLayout();

  const reorderable = sortByPriority(
    events.filter((e) => e.status !== 'completed')
  );
  const completed = sortByPriority(
    events.filter((e) => e.status === 'completed')
  );
  const reorderableRef = useRef(reorderable);
  const completedRef = useRef(completed);
  reorderableRef.current = reorderable;
  completedRef.current = completed;

  async function persistOrder(reordered: SmartEvent[]) {
    setSaving(true);
    try {
      const updated = await api.reorderSmartEvents(reordered.map((e) => e.id));
      const completedIds = new Set(completedRef.current.map((e) => e.id));
      onChange([
        ...sortByPriority(updated.filter((e) => !completedIds.has(e.id))),
        ...completedRef.current,
      ]);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
      setDraggedId(null);
      setDragOverId(null);
    }
  }

  function applyReorder(fromId: string, toId: string) {
    if (fromId === toId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const current = reorderableRef.current;
    const done = completedRef.current;
    const fromIndex = current.findIndex((e) => e.id === fromId);
    const toIndex = current.findIndex((e) => e.id === toId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const reordered = reorder(current, fromIndex, toIndex).map((e, i) => ({
      ...e,
      priority: i + 1,
    }));

    onChange([...reordered, ...done]);
    persistOrder(reordered);
  }

  function handleDrop(targetId: string) {
    if (!draggedId) return;
    applyReorder(draggedId, targetId);
  }

  function handleDragStart(eventId: string, e: React.DragEvent) {
    if (saving || isMobile) {
      e.preventDefault();
      return;
    }

    const target = e.target as HTMLElement;
    if (target.closest('button, .event-actions')) {
      e.preventDefault();
      return;
    }

    setDraggedId(eventId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleTouchStart(eventId: string) {
    if (saving) return;
    setDraggedId(eventId);
  }

  useEffect(() => {
    if (!draggedId || !isMobile) return;

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const targetId = getEventIdFromTouch(touch);
      if (targetId) setDragOverId(targetId);
    }

    function endTouchDrag(e: TouchEvent) {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const targetId = getEventIdFromTouch(touch);
      if (targetId && draggedId) {
        applyReorder(draggedId, targetId);
      } else {
        setDraggedId(null);
        setDragOverId(null);
      }
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', endTouchDrag);
    document.addEventListener('touchcancel', endTouchDrag);

    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', endTouchDrag);
      document.removeEventListener('touchcancel', endTouchDrag);
    };
  }, [draggedId, isMobile]);

  if (reorderable.length === 0 && completed.length === 0) {
    return (
      <div className="empty-state">
        <strong>No smart events yet</strong>
        <p>Add a task above, then drag to set priority.</p>
      </div>
    );
  }

  return (
    <>
      {reorderable.length > 0 && (
        <div className="priority-section">
          <p className="priority-hint">
            <span className="priority-hint-desktop">
              Drag any event to reorder priority — top slots fill first on sync.
            </span>
            <span className="priority-hint-mobile">
              Touch and hold the drag tab below each event to reorder.
            </span>
            {saving && <span className="priority-saving"> Saving…</span>}
          </p>
          <div className="event-list priority-list">
            {reorderable.map((event, index) => (
              <div
                key={event.id}
                data-event-id={event.id}
                className={`event-item event-item-draggable ${
                  draggedId === event.id ? 'dragging' : ''
                } ${dragOverId === event.id && draggedId !== event.id ? 'drag-over' : ''}`}
                draggable={!saving && !isMobile}
                title={isMobile ? undefined : 'Drag to reorder'}
                onDragStart={(e) => handleDragStart(event.id, e)}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
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
                <div className="event-item-content">
                  <div className="drag-handle" aria-hidden="true">
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
                <div
                  className="mobile-drag-tab"
                  role="button"
                  tabIndex={0}
                  aria-label={`Drag to reorder ${event.title}`}
                  onTouchStart={() => handleTouchStart(event.id)}
                >
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" aria-hidden="true">
                    <rect x="0" y="0" width="14" height="2" rx="1" />
                    <rect x="0" y="4" width="14" height="2" rx="1" />
                    <rect x="0" y="8" width="14" height="2" rx="1" />
                  </svg>
                  <span>Hold and drag to reorder</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className={`event-list ${reorderable.length > 0 ? 'scheduled-list' : ''}`}>
          {completed.map((event) => (
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
        <span>Priority {event.priority}</span>
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
