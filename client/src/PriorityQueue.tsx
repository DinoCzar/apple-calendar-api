import { useEffect, useRef, useState } from 'react';
import {
  normalizeStandardEventUpdate,
  toStandardEventUpdate,
  type StandardEventUpdate,
} from './event-edit';
import { normalizeGroceryEventUpdate, toGroceryEventUpdate, type GroceryEventUpdate } from './grocery';
import type { SmartEvent } from './types';
import {
  normalizeRecurringEventUpdate,
  toRecurringEventUpdate,
  type RecurringEventUpdate,
} from './recurring-edit';
import { formatRepeatDaysLabel, SCHEDULE_WEEKDAYS } from './weekdays';

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

function getTargetIndexFromY(
  clientY: number,
  orderedIds: string[],
  listEl: HTMLElement | null
): number {
  if (!listEl || orderedIds.length === 0) return 0;

  for (let i = 0; i < orderedIds.length; i++) {
    const el = listEl.querySelector(`[data-event-id="${orderedIds[i]}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }

  return orderedIds.length - 1;
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
  onReorder: (ids: string[]) => Promise<SmartEvent[]>;
  showMoveToBottom?: boolean;
  eventEditMode?: 'grocery' | 'standard' | 'recurring';
  onUpdateGroceryEvent?: (
    id: string,
    data: GroceryEventUpdate
  ) => Promise<SmartEvent>;
  onUpdateStandardEvent?: (
    id: string,
    data: StandardEventUpdate
  ) => Promise<SmartEvent>;
  onUpdateRecurringEvent?: (
    id: string,
    data: RecurringEventUpdate
  ) => Promise<SmartEvent>;
}

export default function PriorityQueue({
  events,
  onChange,
  onError,
  onDelete,
  onComplete,
  onReorder,
  showMoveToBottom = false,
  eventEditMode,
  onUpdateGroceryEvent,
  onUpdateStandardEvent,
  onUpdateRecurringEvent,
}: PriorityQueueProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [touchPreview, setTouchPreview] = useState<SmartEvent[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const isMobile = useIsMobileLayout();

  const listRef = useRef<HTMLDivElement>(null);
  const reorderableRef = useRef<SmartEvent[]>([]);
  const completedRef = useRef<SmartEvent[]>([]);
  const touchStartOrderRef = useRef<string[]>([]);
  const touchPreviewRef = useRef<SmartEvent[] | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const suppressExpandRef = useRef(false);

  const reorderable = sortByPriority(
    events.filter((e) => e.status !== 'completed')
  );
  const completed = sortByPriority(
    events.filter((e) => e.status === 'completed')
  );
  reorderableRef.current = reorderable;
  completedRef.current = completed;
  draggedIdRef.current = draggedId;

  const displayList = touchPreview ?? reorderable;
  touchPreviewRef.current = touchPreview;

  async function persistOrder(reordered: SmartEvent[]) {
    setSaving(true);
    try {
      const updated = await onReorder(reordered.map((e) => e.id));
      const completedIds = new Set(completedRef.current.map((e) => e.id));
      onChange([
        ...sortByPriority(updated.filter((e) => !completedIds.has(e.id))),
        ...completedRef.current,
      ]);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
      clearTouchDrag();
    }
  }

  function clearTouchDrag() {
    setDraggedId(null);
    setDragOverId(null);
    setTouchPreview(null);
    touchPreviewRef.current = null;
    touchStartOrderRef.current = [];
    document.body.classList.remove('priority-drag-active');
  }

  function beginPointerDrag(eventId: string) {
    if (saving || savingEdit || editingId !== null) return;

    const snapshot = [...reorderableRef.current];
    touchStartOrderRef.current = snapshot.map((item) => item.id);
    touchPreviewRef.current = snapshot;
    setDraggedId(eventId);
    setTouchPreview(snapshot);
    document.body.classList.add('priority-drag-active');
  }

  function handleReorderPointerDown(eventId: string, e: React.PointerEvent) {
    if (saving || savingEdit || editingId !== null) return;

    e.preventDefault();
    e.stopPropagation();
    beginPointerDrag(eventId);
  }

  function commitReorderedList(reordered: SmartEvent[]) {
    const withPriority = reordered.map((e, i) => ({
      ...e,
      priority: i + 1,
    }));
    onChange([...withPriority, ...completedRef.current]);
    persistOrder(withPriority);
  }

  function moveToBottom(eventId: string) {
    if (saving || savingEdit) return;

    const current = reorderableRef.current;
    const fromIndex = current.findIndex((e) => e.id === eventId);
    const lastIndex = current.length - 1;
    if (fromIndex === -1 || fromIndex === lastIndex) return;

    commitReorderedList(reorder(current, fromIndex, lastIndex));
  }

  function toggleExpand(eventId: string) {
    if (savingEdit || suppressExpandRef.current) return;
    setExpandedId((current) => (current === eventId ? null : eventId));
  }

  function toggleEdit(eventId: string) {
    if (savingEdit) return;
    setEditingId((current) => {
      const next = current === eventId ? null : eventId;
      if (next) {
        setExpandedId(eventId);
      }
      return next;
    });
  }

  async function saveGroceryEdit(eventId: string, draft: GroceryEventUpdate) {
    if (!onUpdateGroceryEvent) return;

    const normalized = normalizeGroceryEventUpdate(draft);
    if (!normalized.title) {
      onError('Title is required');
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await onUpdateGroceryEvent(eventId, normalized);
      onChange(events.map((event) => (event.id === eventId ? updated : event)));
      setEditingId(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveStandardEdit(eventId: string, draft: StandardEventUpdate) {
    if (!onUpdateStandardEvent) return;

    const normalized = normalizeStandardEventUpdate(draft);
    if (!normalized.title) {
      onError('Title is required');
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await onUpdateStandardEvent(eventId, normalized);
      onChange(events.map((event) => (event.id === eventId ? updated : event)));
      setEditingId(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveRecurringEdit(eventId: string, draft: RecurringEventUpdate) {
    if (!onUpdateRecurringEvent) return;

    const normalized = normalizeRecurringEventUpdate(draft);
    if (!normalized.title) {
      onError('Title is required');
      return;
    }
    if (normalized.repeat_days_of_week.length === 0) {
      onError('Select at least one day for the event to repeat on.');
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await onUpdateRecurringEvent(eventId, normalized);
      onChange(events.map((event) => (event.id === eventId ? updated : event)));
      setEditingId(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  function renderEventEditForm(event: SmartEvent) {
    if (eventEditMode === 'grocery' && onUpdateGroceryEvent) {
      return (
        <GroceryEventEditForm
          event={event}
          saving={savingEdit}
          onCancel={() => setEditingId(null)}
          onSave={(draft) => saveGroceryEdit(event.id, draft)}
        />
      );
    }

    if (eventEditMode === 'standard' && onUpdateStandardEvent) {
      return (
        <StandardEventEditForm
          event={event}
          saving={savingEdit}
          onCancel={() => setEditingId(null)}
          onSave={(draft) => saveStandardEdit(event.id, draft)}
        />
      );
    }

    if (eventEditMode === 'recurring' && onUpdateRecurringEvent) {
      return (
        <RecurringEventEditForm
          event={event}
          saving={savingEdit}
          onCancel={() => setEditingId(null)}
          onSave={(draft) => saveRecurringEdit(event.id, draft)}
        />
      );
    }

    return null;
  }

  function eventActionProps(event: SmartEvent) {
    return {
      event,
      onDelete,
      onComplete,
      eventEditMode,
      editDisabled: saving || savingEdit || (editingId !== null && editingId !== event.id),
      onEditToggle: () => toggleEdit(event.id),
    };
  }

  useEffect(() => {
    if (!draggedId || !touchPreview) return;

    function onPointerMove(e: PointerEvent) {
      e.preventDefault();
      const activeId = draggedIdRef.current;
      const current = touchPreviewRef.current;
      if (!activeId || !current || !listRef.current) return;

      const fromIndex = current.findIndex((item) => item.id === activeId);
      const toIndex = getTargetIndexFromY(
        e.clientY,
        current.map((item) => item.id),
        listRef.current
      );

      if (fromIndex === -1 || fromIndex === toIndex) return;

      const next = reorder(current, fromIndex, toIndex);
      touchPreviewRef.current = next;
      setTouchPreview(next);
      setDragOverId(next[toIndex]?.id ?? null);
    }

    function endPointerDrag() {
      const current = touchPreviewRef.current;
      const startOrder = touchStartOrderRef.current.join(',');

      if (current) {
        const endOrder = current.map((item) => item.id).join(',');
        if (endOrder !== startOrder) {
          suppressExpandRef.current = true;
          const withPriority = current.map((item, i) => ({
            ...item,
            priority: i + 1,
          }));
          onChange([...withPriority, ...completedRef.current]);
          persistOrder(withPriority);
          window.setTimeout(() => {
            suppressExpandRef.current = false;
          }, 0);
          return;
        }
      }

      clearTouchDrag();
    }

    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', endPointerDrag);
    document.addEventListener('pointercancel', endPointerDrag);

    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', endPointerDrag);
      document.removeEventListener('pointercancel', endPointerDrag);
      document.body.classList.remove('priority-drag-active');
    };
  }, [draggedId, touchPreview]);

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
              Drag the grip to reorder — click the name for details (top slots fill first on sync).
            </span>
            <span className="priority-hint-mobile">
              Hold and drag the grip, or long-press an event to move it — tap the name for details.
            </span>
            {saving && <span className="priority-saving"> Saving…</span>}
          </p>
          <div
            ref={listRef}
            className={`event-list priority-list ${draggedId ? 'priority-list-dragging' : ''}`}
          >
            {displayList.map((event, index) => {
              const isEditing = editingId === event.id;
              const isExpanded = isEditing || expandedId === event.id;
              const reorderDisabled = saving || savingEdit || isEditing;

              return (
              <div
                key={event.id}
                data-event-id={event.id}
                className={`event-item event-item-draggable ${
                  draggedId === event.id ? 'dragging' : ''
                } ${dragOverId === event.id && draggedId !== event.id ? 'drag-over' : ''}${
                  isEditing ? ' event-item-editing' : ''
                }${isExpanded ? ' event-item-expanded' : ' event-item-collapsed'}`}
              >
                <div
                  className={`event-item-content${
                    isEditing ? ' event-item-content-editing' : ''
                  }${!isExpanded && !isEditing ? ' event-item-content-collapsed' : ''}`}
                >
                  {!isEditing && (
                    <EventReorderHandle
                      eventId={event.id}
                      title={event.title}
                      index={index}
                      disabled={reorderDisabled}
                      isDragging={draggedId === event.id}
                      onDragStart={handleReorderPointerDown}
                    />
                  )}
                  {isEditing ? (
                    renderEventEditForm(event)
                  ) : isExpanded ? (
                    <>
                      <EventBody event={event} onTitleClick={() => toggleExpand(event.id)} />
                      <EventActions
                        {...eventActionProps(event)}
                        showMoveToBottom={showMoveToBottom}
                        moveToBottomDisabled={
                          saving || savingEdit || index === displayList.length - 1
                        }
                        onMoveToBottom={() => moveToBottom(event.id)}
                      />
                    </>
                  ) : (
                    <EventSummary
                      title={event.title}
                      enableLongPressDrag={isMobile}
                      onActivate={() => toggleExpand(event.id)}
                      onLongPressDrag={() => beginPointerDrag(event.id)}
                    />
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className={`event-list ${reorderable.length > 0 ? 'scheduled-list' : ''}`}>
          {completed.map((event) => {
            const isEditing = editingId === event.id;
            const isExpanded = isEditing || expandedId === event.id;

            return (
            <div
              key={event.id}
              className={`event-item${
                isExpanded ? ' event-item-expanded' : ' event-item-collapsed'
              }${isEditing ? ' event-item-editing' : ''}`}
            >
              <div className="event-item-content event-item-content-static">
                {isEditing ? (
                  renderEventEditForm(event)
                ) : isExpanded ? (
                  <>
                    <EventBody event={event} onTitleClick={() => toggleExpand(event.id)} />
                    <EventActions {...eventActionProps(event)} />
                  </>
                ) : (
                  <EventSummary
                    title={event.title}
                    onActivate={() => toggleExpand(event.id)}
                  />
                )}
              </div>
            </div>
          );
          })}
        </div>
      )}
    </>
  );
}

function EventReorderHandle({
  eventId,
  title,
  index,
  disabled = false,
  isDragging = false,
  onDragStart,
}: {
  eventId: string;
  title: string;
  index: number;
  disabled?: boolean;
  isDragging?: boolean;
  onDragStart: (eventId: string, e: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      className={`event-reorder-handle${isDragging ? ' event-reorder-handle-active' : ''}`}
      aria-label={`Drag to reorder ${title}, priority ${index + 1}`}
      disabled={disabled}
      onPointerDown={(e) => onDragStart(eventId, e)}
    >
      <span className="priority-rank">{index + 1}</span>
      <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor" aria-hidden="true">
        <rect x="0" y="0" width="16" height="1.5" rx="0.75" />
        <rect x="0" y="4.25" width="16" height="1.5" rx="0.75" />
        <rect x="0" y="8.5" width="16" height="1.5" rx="0.75" />
      </svg>
    </button>
  );
}

function EventSummary({
  title,
  onActivate,
  enableLongPressDrag = false,
  onLongPressDrag,
}: {
  title: string;
  onActivate: () => void;
  enableLongPressDrag?: boolean;
  onLongPressDrag?: () => void;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleActivate() {
    onActivate();
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!enableLongPressDrag || !onLongPressDrag || e.pointerType === 'mouse') return;

    longPressTriggeredRef.current = false;
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressTriggeredRef.current = true;
      onLongPressDrag();
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    }, 420);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!enableLongPressDrag || !longPressStartRef.current) return;

    const dx = Math.abs(e.clientX - longPressStartRef.current.x);
    const dy = Math.abs(e.clientY - longPressStartRef.current.y);
    if (dx > 8 || dy > 8) {
      clearLongPressTimer();
    }
  }

  function handlePointerUp() {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      clearLongPressTimer();
      longPressStartRef.current = null;
      return;
    }

    clearLongPressTimer();
    longPressStartRef.current = null;

    if (enableLongPressDrag) {
      handleActivate();
    }
  }

  useEffect(() => () => clearLongPressTimer(), []);

  return (
    <div
      className="event-item-summary"
      role="button"
      tabIndex={0}
      aria-expanded="false"
      onClick={enableLongPressDrag ? undefined : handleActivate}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        clearLongPressTimer();
        longPressStartRef.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      {title}
    </div>
  );
}

function EventBody({
  event,
  onTitleClick,
}: {
  event: SmartEvent;
  onTitleClick?: () => void;
}) {
  return (
    <div className="event-item-main">
      <h3
        className={onTitleClick ? 'event-item-title-toggle' : undefined}
        onClick={onTitleClick}
        onKeyDown={
          onTitleClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onTitleClick();
                }
              }
            : undefined
        }
        role={onTitleClick ? 'button' : undefined}
        tabIndex={onTitleClick ? 0 : undefined}
      >
        {event.title}
      </h3>
      {event.description && (
        <p className="event-description">{event.description}</p>
      )}
      <div className="event-meta">
        <span>{event.duration_minutes} min</span>
        <span>Priority {event.priority}</span>
        {event.repeat_days_of_week && event.repeat_days_of_week.length > 0 && (
          <span>
            Repeats weekly: {formatRepeatDaysLabel(event.repeat_days_of_week)}
            {event.repeat_time_of_day &&
              ` at ${formatRepeatTimeOfDay(event.repeat_time_of_day)}`}
          </span>
        )}
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

function RecurringEventEditForm({
  event,
  saving,
  onCancel,
  onSave,
}: {
  event: SmartEvent;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: RecurringEventUpdate) => void;
}) {
  const [draft, setDraft] = useState(() => toRecurringEventUpdate(event));

  function updateDraft(partial: Partial<RecurringEventUpdate>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function toggleRepeatDay(day: number) {
    setDraft((current) => {
      const next = current.repeat_days_of_week.includes(day)
        ? current.repeat_days_of_week.filter((value) => value !== day)
        : [...current.repeat_days_of_week, day].sort((a, b) => a - b);
      return { ...current, repeat_days_of_week: next };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(draft);
  }

  return (
    <form className="event-edit-form" onSubmit={handleSubmit}>
      <div>
        <label htmlFor={`edit-title-${event.id}`}>Title</label>
        <input
          id={`edit-title-${event.id}`}
          value={draft.title}
          onChange={(e) => updateDraft({ title: e.target.value })}
          required
        />
      </div>
      <div>
        <label htmlFor={`edit-description-${event.id}`}>Description (optional)</label>
        <textarea
          id={`edit-description-${event.id}`}
          value={draft.description ?? ''}
          onChange={(e) => updateDraft({ description: e.target.value || null })}
          rows={2}
        />
      </div>
      <div>
        <label>Repeat weekly on</label>
        <div className="weekday-picker" role="group" aria-label="Repeat days">
          {SCHEDULE_WEEKDAYS.map(({ value, label }) => {
            const active = draft.repeat_days_of_week.includes(value);
            return (
              <button
                key={value}
                type="button"
                className={`weekday-toggle${active ? ' active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleRepeatDay(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label htmlFor={`edit-repeat-time-${event.id}`}>Time of day</label>
        <input
          id={`edit-repeat-time-${event.id}`}
          type="time"
          value={draft.repeat_time_of_day}
          onChange={(e) => updateDraft({ repeat_time_of_day: e.target.value })}
          required
        />
      </div>
      <div>
        <label htmlFor={`edit-duration-${event.id}`}>Duration (minutes)</label>
        <input
          id={`edit-duration-${event.id}`}
          type="number"
          min={15}
          step={15}
          value={draft.duration_minutes}
          onChange={(e) =>
            updateDraft({ duration_minutes: Number(e.target.value) })
          }
          required
        />
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className="btn-primary"
          disabled={
            saving || !draft.title.trim() || draft.repeat_days_of_week.length === 0
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function StandardEventEditForm({
  event,
  saving,
  onCancel,
  onSave,
}: {
  event: SmartEvent;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: StandardEventUpdate) => void;
}) {
  const [draft, setDraft] = useState(() => toStandardEventUpdate(event));

  function updateDraft(partial: Partial<StandardEventUpdate>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(draft);
  }

  return (
    <form className="event-edit-form" onSubmit={handleSubmit}>
      <div>
        <label htmlFor={`edit-title-${event.id}`}>Title</label>
        <input
          id={`edit-title-${event.id}`}
          value={draft.title}
          onChange={(e) => updateDraft({ title: e.target.value })}
          required
        />
      </div>
      <div>
        <label htmlFor={`edit-description-${event.id}`}>Description</label>
        <textarea
          id={`edit-description-${event.id}`}
          value={draft.description ?? ''}
          onChange={(e) => updateDraft({ description: e.target.value || null })}
          rows={2}
        />
      </div>
      <div>
        <label htmlFor={`edit-duration-${event.id}`}>Duration (minutes)</label>
        <input
          id={`edit-duration-${event.id}`}
          type="number"
          min={15}
          step={15}
          value={draft.duration_minutes}
          onChange={(e) =>
            updateDraft({ duration_minutes: Number(e.target.value) })
          }
          required
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving || !draft.title.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function GroceryEventEditForm({
  event,
  saving,
  onCancel,
  onSave,
}: {
  event: SmartEvent;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: GroceryEventUpdate) => void;
}) {
  const [draft, setDraft] = useState(() => toGroceryEventUpdate(event));

  function updateDraft(partial: Partial<GroceryEventUpdate>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(draft);
  }

  return (
    <form className="event-edit-form" onSubmit={handleSubmit}>
      <div>
        <label htmlFor={`edit-title-${event.id}`}>Title</label>
        <input
          id={`edit-title-${event.id}`}
          value={draft.title}
          onChange={(e) => updateDraft({ title: e.target.value })}
          required
        />
      </div>
      <div>
        <label htmlFor={`edit-ingredients-${event.id}`}>Ingredients</label>
        <textarea
          id={`edit-ingredients-${event.id}`}
          value={draft.grocery_ingredients ?? ''}
          onChange={(e) => updateDraft({ grocery_ingredients: e.target.value || null })}
          rows={2}
        />
      </div>
      <div>
        <label htmlFor={`edit-recipe-${event.id}`}>Recipe</label>
        <textarea
          id={`edit-recipe-${event.id}`}
          value={draft.grocery_recipe ?? ''}
          onChange={(e) => updateDraft({ grocery_recipe: e.target.value || null })}
          rows={2}
        />
      </div>
      <div>
        <label htmlFor={`edit-sides-${event.id}`}>Sides</label>
        <textarea
          id={`edit-sides-${event.id}`}
          value={draft.grocery_sides ?? ''}
          onChange={(e) => updateDraft({ grocery_sides: e.target.value || null })}
          rows={2}
        />
      </div>
      <div>
        <label htmlFor={`edit-duration-${event.id}`}>Duration (minutes)</label>
        <input
          id={`edit-duration-${event.id}`}
          type="number"
          min={15}
          step={15}
          value={draft.duration_minutes}
          onChange={(e) =>
            updateDraft({ duration_minutes: Number(e.target.value) })
          }
          required
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving || !draft.title.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function EventActions({
  event,
  onDelete,
  onComplete,
  showMoveToBottom = false,
  moveToBottomDisabled = false,
  onMoveToBottom,
  eventEditMode,
  editDisabled = false,
  onEditToggle,
}: {
  event: SmartEvent;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
  showMoveToBottom?: boolean;
  moveToBottomDisabled?: boolean;
  onMoveToBottom?: () => void;
  eventEditMode?: 'grocery' | 'standard' | 'recurring';
  editDisabled?: boolean;
  onEditToggle?: () => void;
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
        <>
          {eventEditMode === 'grocery' && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              disabled={editDisabled}
              onClick={onEditToggle}
            >
              View
            </button>
          )}
          {eventEditMode === 'standard' && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              disabled={editDisabled}
              onClick={onEditToggle}
            >
              Edit
            </button>
          )}
          {eventEditMode === 'recurring' && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              disabled={editDisabled}
              onClick={onEditToggle}
            >
              Edit
            </button>
          )}
          {showMoveToBottom && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              disabled={moveToBottomDisabled}
              onClick={onMoveToBottom}
            >
              Lowest priority
            </button>
          )}
          <button
            className="btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            onClick={() => onComplete(event.id)}
          >
            Done
          </button>
        </>
      )}
      {event.status === 'completed' && eventEditMode === 'grocery' && (
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          disabled={editDisabled}
          onClick={onEditToggle}
        >
          View
        </button>
      )}
      {event.status === 'completed' && eventEditMode === 'standard' && (
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          disabled={editDisabled}
          onClick={onEditToggle}
        >
          Edit
        </button>
      )}
      {event.status === 'completed' && eventEditMode === 'recurring' && (
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          disabled={editDisabled}
          onClick={onEditToggle}
        >
          Edit
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

function formatRepeatTimeOfDay(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
