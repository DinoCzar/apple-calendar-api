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
