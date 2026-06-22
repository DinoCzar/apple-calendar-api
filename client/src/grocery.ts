import type { SmartEvent } from './types';

export type GroceryListDays = 3 | 5 | 7;

export const GROCERY_LIST_DAY_OPTIONS: GroceryListDays[] = [3, 5, 7];

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getScheduledGroceryEventsInDays(
  events: SmartEvent[],
  days: GroceryListDays,
  now = new Date()
): SmartEvent[] {
  const rangeStart = startOfLocalDay(now);
  const rangeEnd = addLocalDays(rangeStart, days);

  return events
    .filter((event) => {
      if (!event.scheduled_start || event.status === 'completed') {
        return false;
      }

      const scheduledAt = new Date(event.scheduled_start);
      return scheduledAt >= rangeStart && scheduledAt < rangeEnd;
    })
    .sort((a, b) =>
      a.scheduled_start!.localeCompare(b.scheduled_start!)
    );
}

export function formatGroceryListText(
  events: SmartEvent[],
  days: GroceryListDays,
  now = new Date()
): string {
  const scheduled = getScheduledGroceryEventsInDays(events, days, now);

  if (scheduled.length === 0) {
    return `Grocery list — next ${days} days\n\nNo grocery events are scheduled in this window.`;
  }

  const sections = scheduled.map((event) => {
    const lines = [event.title];

    if (event.grocery_ingredients?.trim()) {
      lines.push('Ingredients:');
      lines.push(event.grocery_ingredients.trim());
    }

    if (event.grocery_sides?.trim()) {
      lines.push('Sides:');
      lines.push(event.grocery_sides.trim());
    }

    if (!event.grocery_ingredients?.trim() && !event.grocery_sides?.trim()) {
      lines.push('(No ingredients or sides listed)');
    }

    return lines.join('\n');
  });

  return [`Grocery list — next ${days} days`, '', ...sections].join('\n\n');
}

export interface GroceryTrait {
  label: string;
  value: string;
}

export function getGroceryTraits(event: SmartEvent): GroceryTrait[] {
  const traits: GroceryTrait[] = [];

  if (event.grocery_ingredients?.trim()) {
    traits.push({ label: 'Ingredients', value: event.grocery_ingredients.trim() });
  }
  if (event.grocery_recipe?.trim()) {
    traits.push({ label: 'Recipe', value: event.grocery_recipe.trim() });
  }
  if (event.grocery_sides?.trim()) {
    traits.push({ label: 'Sides', value: event.grocery_sides.trim() });
  }

  return traits;
}

export interface GroceryEventUpdate {
  title: string;
  duration_minutes: number;
  grocery_sides: string | null;
  grocery_recipe: string | null;
  grocery_ingredients: string | null;
}

export function toGroceryEventUpdate(event: SmartEvent): GroceryEventUpdate {
  return {
    title: event.title,
    duration_minutes: event.duration_minutes,
    grocery_sides: event.grocery_sides,
    grocery_recipe: event.grocery_recipe,
    grocery_ingredients: event.grocery_ingredients,
  };
}

export function normalizeGroceryEventUpdate(
  draft: GroceryEventUpdate
): GroceryEventUpdate {
  return {
    title: draft.title.trim(),
    duration_minutes: draft.duration_minutes,
    grocery_sides: draft.grocery_sides?.trim() || null,
    grocery_recipe: draft.grocery_recipe?.trim() || null,
    grocery_ingredients: draft.grocery_ingredients?.trim() || null,
  };
}
