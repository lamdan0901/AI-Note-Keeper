import { ChecklistItem } from '../types/note';
import { uuidv4 } from './uuid';

/**
 * Parse a JSON-encoded checklist string back into an array of ChecklistItems.
 * Returns an empty array on invalid/null/empty input.
 */
export function parseChecklist(content: string | null): ChecklistItem[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is ChecklistItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ChecklistItem).id === 'string' &&
        typeof (item as ChecklistItem).text === 'string' &&
        typeof (item as ChecklistItem).checked === 'boolean',
    );
  } catch {
    return [];
  }
}

/**
 * Serialize a checklist array to a JSON string for storage in the content field.
 */
export function serializeChecklist(items: ChecklistItem[]): string {
  return JSON.stringify(items);
}

/**
 * Convert checklist items to human-readable plain text (for notifications).
 */
export function checklistToPlainText(items: ChecklistItem[]): string {
  return items.map((item) => `${item.checked ? '✓' : '☐'} ${item.text}`).join('\n');
}

/**
 * Create a new empty checklist item with a unique ID.
 */
export function newChecklistItem(text = ''): ChecklistItem {
  return { id: uuidv4(), text, checked: false };
}

/**
 * Convert plain text lines into checklist items (one item per non-empty line).
 */
export function textToChecklist(text: string): ChecklistItem[] {
  if (!text.trim()) return [newChecklistItem()];
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => newChecklistItem(line.trim()));
}

/**
 * Convert checklist items back to plain text lines.
 */
export function checklistToText(items: ChecklistItem[]): string {
  return items.map((item) => item.text).join('\n');
}
