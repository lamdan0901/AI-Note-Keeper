import {
  parseChecklist,
  serializeChecklist,
  checklistToPlainText,
  newChecklistItem,
  textToChecklist,
  checklistToText,
} from './checklist';

// Mock uuid to avoid crypto polyfill issues in test environment
let mockCounter = 0;
jest.mock('./uuid', () => ({
  uuidv4: () => `mock-uuid-${++mockCounter}`,
}));

beforeEach(() => {
  mockCounter = 0;
});

describe('parseChecklist', () => {
  test('parses valid JSON array', () => {
    const items = [
      { id: '1', text: 'Buy milk', checked: false },
      { id: '2', text: 'Walk dog', checked: true },
    ];
    const result = parseChecklist(JSON.stringify(items));
    expect(result).toEqual(items);
  });

  test('returns empty array for null', () => {
    expect(parseChecklist(null)).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(parseChecklist('')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseChecklist('not json')).toEqual([]);
  });

  test('returns empty array for non-array JSON', () => {
    expect(parseChecklist('{"foo": "bar"}')).toEqual([]);
  });

  test('filters out items with missing fields', () => {
    const input = JSON.stringify([
      { id: '1', text: 'Valid', checked: false },
      { id: '2', text: 'Missing checked' },
      { text: 'Missing id', checked: true },
      { id: '3', checked: false },
      'not an object',
      null,
    ]);
    const result = parseChecklist(input);
    expect(result).toEqual([{ id: '1', text: 'Valid', checked: false }]);
  });

  test('filters out items with wrong field types', () => {
    const input = JSON.stringify([
      { id: 1, text: 'Numeric id', checked: false },
      { id: '1', text: 123, checked: false },
      { id: '1', text: 'String checked', checked: 'yes' },
    ]);
    expect(parseChecklist(input)).toEqual([]);
  });
});

describe('serializeChecklist', () => {
  test('serializes items to JSON', () => {
    const items = [
      { id: '1', text: 'Item 1', checked: false },
      { id: '2', text: 'Item 2', checked: true },
    ];
    const json = serializeChecklist(items);
    expect(JSON.parse(json)).toEqual(items);
  });

  test('serializes empty array', () => {
    expect(serializeChecklist([])).toBe('[]');
  });
});

describe('parseChecklist + serializeChecklist round-trip', () => {
  test('round-trips correctly', () => {
    const items = [
      { id: 'a', text: 'First', checked: false },
      { id: 'b', text: 'Second', checked: true },
      { id: 'c', text: '', checked: false },
    ];
    expect(parseChecklist(serializeChecklist(items))).toEqual(items);
  });
});

describe('checklistToPlainText', () => {
  test('formats checked and unchecked items', () => {
    const items = [
      { id: '1', text: 'Done task', checked: true },
      { id: '2', text: 'Pending task', checked: false },
    ];
    expect(checklistToPlainText(items)).toBe('✓ Done task\n☐ Pending task');
  });

  test('handles empty array', () => {
    expect(checklistToPlainText([])).toBe('');
  });

  test('handles single item', () => {
    expect(checklistToPlainText([{ id: '1', text: 'Only', checked: false }])).toBe('☐ Only');
  });
});

describe('newChecklistItem', () => {
  test('creates item with default empty text', () => {
    const item = newChecklistItem();
    expect(item.text).toBe('');
    expect(item.checked).toBe(false);
    expect(item.id).toBeTruthy();
  });

  test('creates item with provided text', () => {
    const item = newChecklistItem('Buy groceries');
    expect(item.text).toBe('Buy groceries');
    expect(item.checked).toBe(false);
  });

  test('generates unique IDs', () => {
    const item1 = newChecklistItem();
    const item2 = newChecklistItem();
    expect(item1.id).not.toBe(item2.id);
  });
});

describe('textToChecklist', () => {
  test('converts multi-line text to items', () => {
    const result = textToChecklist('Line 1\nLine 2\nLine 3');
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
    expect(result[2].text).toBe('Line 3');
    result.forEach((item) => expect(item.checked).toBe(false));
  });

  test('skips empty lines', () => {
    const result = textToChecklist('Line 1\n\n\nLine 2\n');
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Line 1');
    expect(result[1].text).toBe('Line 2');
  });

  test('returns single empty item for empty/whitespace input', () => {
    const result = textToChecklist('');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('');
    expect(result[0].checked).toBe(false);
  });

  test('trims whitespace from lines', () => {
    const result = textToChecklist('  Item 1  \n  Item 2  ');
    expect(result[0].text).toBe('Item 1');
    expect(result[1].text).toBe('Item 2');
  });
});

describe('checklistToText', () => {
  test('converts items to lines', () => {
    const items = [
      { id: '1', text: 'First', checked: true },
      { id: '2', text: 'Second', checked: false },
    ];
    expect(checklistToText(items)).toBe('First\nSecond');
  });

  test('handles empty array', () => {
    expect(checklistToText([])).toBe('');
  });
});
