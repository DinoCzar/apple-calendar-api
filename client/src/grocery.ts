import type { SmartEvent } from './types';

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
