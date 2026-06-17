import { useEffect, useRef, useState } from 'react';
import { getGroceryTraits, normalizeGroceryEventUpdate, toGroceryEventUpdate, type GroceryEventUpdate } from './grocery';
import type { SmartEvent } from './types';
import { formatRepeatDaysLabel } from './weekdays';

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
  showGroceryTraits?: boolean;
  onUpdateGroceryEvent?: (
    id: string,
    data: GroceryEventUpdate
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
  showGroceryTraits = false,
  onUpdateGroceryEvent,
}: PriorityQueueProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [touchPreview, setTouchPreview] = useState<SmartEvent[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const isMobile = useIsMobileLayout();

  const listRef = useRef<HTMLDivElement>(null);
  const reorderableRef = useRef<SmartEvent[]>([]);
  const completedRef = useRef<SmartEvent[]>([]);
  const touchStartOrderRef = useRef<string[]>([]);
  const touchPreviewRef = useRef<SmartEvent[] | null>(null);
  const draggedIdRef = useRef<string | null>(null);

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
    document.body.classList.remove('mobile-drag-active');
  }

  function commitReorderedList(reordered: SmartEvent[]) {
    const withPriority = reordered.map((e, i) => ({
      ...e,
      priority: i + 1,
    }));
    onChange([...withPriority, ...completedRef.current]);
    persistOrder(withPriority);
  }

  function applyReorder(fromId: string, toId: string) {
    if (fromId === toId) {
      clearTouchDrag();
      return;
    }

    const current = reorderableRef.current;
    const fromIndex = current.findIndex((e) => e.id === fromId);
    const toIndex = current.findIndex((e) => e.id === toId);
    if (fromIndex === -1 || toIndex === -1) {
      clearTouchDrag();
      return;
    }

    commitReorderedList(reorder(current, fromIndex, toIndex));
  }

  function moveByOffset(eventId: string, offset: number) {
    if (saving) return;

    const current = reorderableRef.current;
    const fromIndex = current.findIndex((e) => e.id === eventId);
    const toIndex = fromIndex + offset;
    if (fromIndex === -1 || toIndex < 0 || toIndex >= current.length) return;

    commitReorderedList(reorder(current, fromIndex, toIndex));
  }

  function moveToBottom(eventId: string) {
    if (saving || savingEdit) return;

    const current = reorderableRef.current;
    const fromIndex = current.findIndex((e) => e.id === eventId);
    const lastIndex = current.length - 1;
    if (fromIndex === -1 || fromIndex === lastIndex) return;

    commitReorderedList(reorder(current, fromIndex, lastIndex));
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

  function handleTouchStart(eventId: string, e: React.TouchEvent) {
    if (saving) return;

    e.preventDefault();
    const snapshot = [...reorderableRef.current];
    touchStartOrderRef.current = snapshot.map((item) => item.id);
    touchPreviewRef.current = snapshot;
    setDraggedId(eventId);
    setTouchPreview(snapshot);
    document.body.classList.add('mobile-drag-active');
  }

  useEffect(() => {
    if (!draggedId || !isMobile || !touchPreview) return;

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const touch = e.touches[0];
      const activeId = draggedIdRef.current;
      const current = touchPreviewRef.current;
      if (!touch || !activeId || !current || !listRef.current) return;

      const fromIndex = current.findIndex((item) => item.id === activeId);
      const toIndex = getTargetIndexFromY(
        touch.clientY,
        current.map((item) => item.id),
        listRef.current
      );

      if (fromIndex === -1 || fromIndex === toIndex) return;

      const next = reorder(current, fromIndex, toIndex);
      touchPreviewRef.current = next;
      setTouchPreview(next);
      setDragOverId(next[toIndex]?.id ?? null);
    }

    function endTouchDrag() {
      const current = touchPreviewRef.current;
      const startOrder = touchStartOrderRef.current.join(',');

      if (current) {
        const endOrder = current.map((item) => item.id).join(',');
        if (endOrder !== startOrder) {
          const withPriority = current.map((item, i) => ({
            ...item,
            priority: i + 1,
          }));
          onChange([...withPriority, ...completedRef.current]);
          persistOrder(withPriority);
          return;
        }
      }

      clearTouchDrag();
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', endTouchDrag);
    document.addEventListener('touchcancel', endTouchDrag);

    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', endTouchDrag);
      document.removeEventListener('touchcancel', endTouchDrag);
      document.body.classList.remove('mobile-drag-active');
    };
  }, [draggedId, isMobile, touchPreview]);

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
              Use the arrows or drag the tab below each event to reorder.
            </span>
            {saving && <span className="priority-saving"> Saving…</span>}
          </p>
          <div
            ref={listRef}
            className={`event-list priority-list ${draggedId ? 'priority-list-dragging' : ''}`}
          >
            {displayList.map((event, index) => {
              const isEditing = editingId === event.id;

              return (
              <div
                key={event.id}
                data-event-id={event.id}
                className={`event-item event-item-draggable ${
                  draggedId === event.id ? 'dragging' : ''
                } ${dragOverId === event.id && draggedId !== event.id ? 'drag-over' : ''}${
                  isEditing ? ' event-item-editing' : ''
                }`}
                draggable={!saving && !savingEdit && !isMobile && !isEditing}
                title={isMobile || isEditing ? undefined : 'Drag to reorder'}
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
                <div
                  className={`event-item-content${
                    isEditing ? ' event-item-content-editing' : ''
                  }`}
                >
                  {isEditing ? (
                    <GroceryEventEditForm
                      event={event}
                      saving={savingEdit}
                      onCancel={() => setEditingId(null)}
                      onSave={(draft) => saveGroceryEdit(event.id, draft)}
                    />
                  ) : (
                    <>
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
                      <EventBody event={event} showGroceryTraits={showGroceryTraits} />
                      <EventActions
                        event={event}
                        onDelete={onDelete}
                        onComplete={onComplete}
                        showMoveToBottom={showMoveToBottom}
                        moveToBottomDisabled={
                          saving || savingEdit || index === displayList.length - 1
                        }
                        onMoveToBottom={() => moveToBottom(event.id)}
                        showGroceryEdit={Boolean(onUpdateGroceryEvent)}
                        editDisabled={saving || savingEdit || editingId !== null}
                        onEdit={() => setEditingId(event.id)}
                      />
                    </>
                  )}
                </div>
                {!isEditing && (
                <div className="mobile-reorder-bar">
                  <div
                    className="mobile-drag-tab"
                    aria-label={`Drag to reorder ${event.title}`}
                    onTouchStart={(e) => handleTouchStart(event.id, e)}
                  >
                    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
                      <rect x="0" y="0" width="18" height="2.5" rx="1.25" />
                      <rect x="0" y="4.75" width="18" height="2.5" rx="1.25" />
                      <rect x="0" y="9.5" width="18" height="2.5" rx="1.25" />
                    </svg>
                    <span>Drag to move</span>
                  </div>
                  <div className="mobile-move-buttons">
                    <button
                      type="button"
                      className="mobile-move-btn"
                      aria-label={`Move ${event.title} up`}
                      disabled={saving || index === 0}
                      onClick={() => moveByOffset(event.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="mobile-move-btn"
                      aria-label={`Move ${event.title} down`}
                      disabled={saving || index === displayList.length - 1}
                      onClick={() => moveByOffset(event.id, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                )}
              </div>
            );
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className={`event-list ${reorderable.length > 0 ? 'scheduled-list' : ''}`}>
          {completed.map((event) => (
            <div key={event.id} className="event-item">
              <div className="event-item-content event-item-content-static">
                {editingId === event.id ? (
                  <GroceryEventEditForm
                    event={event}
                    saving={savingEdit}
                    onCancel={() => setEditingId(null)}
                    onSave={(draft) => saveGroceryEdit(event.id, draft)}
                  />
                ) : (
                  <>
                    <EventBody event={event} showGroceryTraits={showGroceryTraits} />
                    <EventActions
                      event={event}
                      onDelete={onDelete}
                      onComplete={onComplete}
                      showGroceryEdit={Boolean(onUpdateGroceryEvent)}
                      editDisabled={saving || savingEdit || editingId !== null}
                      onEdit={() => setEditingId(event.id)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EventBody({
  event,
  showGroceryTraits = false,
}: {
  event: SmartEvent;
  showGroceryTraits?: boolean;
}) {
  const groceryTraits = showGroceryTraits ? getGroceryTraits(event) : [];

  return (
    <div className="event-item-main">
      <h3>{event.title}</h3>
      {!showGroceryTraits && event.description && (
        <p className="event-description">{event.description}</p>
      )}
      {groceryTraits.length > 0 && (
        <div className="event-traits">
          {groceryTraits.map((trait) => (
            <div key={trait.label} className="event-trait">
              <span className="event-trait-label">{trait.label}</span>
              <span className="event-trait-value">{trait.value}</span>
            </div>
          ))}
        </div>
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
  showGroceryEdit = false,
  editDisabled = false,
  onEdit,
}: {
  event: SmartEvent;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
  showMoveToBottom?: boolean;
  moveToBottomDisabled?: boolean;
  onMoveToBottom?: () => void;
  showGroceryEdit?: boolean;
  editDisabled?: boolean;
  onEdit?: () => void;
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
          {showGroceryEdit && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              disabled={editDisabled}
              onClick={onEdit}
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
      {event.status === 'completed' && showGroceryEdit && (
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          disabled={editDisabled}
          onClick={onEdit}
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
