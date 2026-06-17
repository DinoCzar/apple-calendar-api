import type { SmartEvent } from '../types';

type GroceryNotesInput = Pick<
  SmartEvent,
  'description' | 'grocery_sides' | 'grocery_recipe' | 'grocery_ingredients'
>;

function appendSection(sections: string[], label: string, value: string | null): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  sections.push(`${label}:\n${trimmed}`);
}

export function formatGroceryCalendarNotes(event: GroceryNotesInput): string | undefined {
  const sections: string[] = [];

  if (event.description?.trim()) {
    sections.push(event.description.trim());
  }

  appendSection(sections, 'Ingredients', event.grocery_ingredients);
  appendSection(sections, 'Recipe', event.grocery_recipe);
  appendSection(sections, 'Sides', event.grocery_sides);

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}
