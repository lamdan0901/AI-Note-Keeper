import React, { useRef, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import type { ChecklistItem } from '../../../../packages/shared/types/note';
import { newChecklistItem } from '../../../../packages/shared/utils/checklist';

interface ChecklistEditorProps {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

export function ChecklistEditor({ items, onChange }: ChecklistEditorProps) {
  const lastAddedIdRef = useRef<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (lastAddedIdRef.current) {
      const input = inputRefs.current.get(lastAddedIdRef.current);
      input?.focus();
      lastAddedIdRef.current = null;
    }
  });

  const toggleItem = (id: string) => {
    onChange(items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
  };

  const updateText = (id: string, text: string) => {
    onChange(items.map((item) => (item.id === id ? { ...item, text } : item)));
  };

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const addItem = () => {
    const item = newChecklistItem();
    lastAddedIdRef.current = item.id;
    onChange([...items, item]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    } else if (e.key === 'Backspace' && e.currentTarget.value === '') {
      e.preventDefault();
      const idx = items.findIndex((item) => item.id === id);
      removeItem(id);
      // Focus previous item
      if (idx > 0) {
        const prevId = items[idx - 1].id;
        setTimeout(() => inputRefs.current.get(prevId)?.focus(), 0);
      }
    }
  };

  return (
    <div className="checklist-editor" role="list" aria-label="Checklist">
      {items.map((item) => (
        <div
          key={item.id}
          className={`checklist-editor__item${item.checked ? ' checklist-editor__item--checked' : ''}`}
          role="listitem"
        >
          <label className="checklist-editor__checkbox-label">
            <input
              type="checkbox"
              className="checklist-editor__checkbox"
              checked={item.checked}
              onChange={() => toggleItem(item.id)}
              aria-label={`Mark "${item.text || 'item'}" as ${item.checked ? 'not done' : 'done'}`}
            />
            <span className="checklist-editor__checkmark" aria-hidden="true" />
          </label>
          <input
            ref={(el) => {
              if (el) inputRefs.current.set(item.id, el);
              else inputRefs.current.delete(item.id);
            }}
            type="text"
            className="checklist-editor__text"
            value={item.text}
            onChange={(e) => updateText(item.id, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, item.id)}
            placeholder="List item"
            aria-label="Checklist item text"
          />
          <button
            className="checklist-editor__remove"
            onClick={() => removeItem(item.id)}
            aria-label="Remove item"
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button className="checklist-editor__add" onClick={addItem} type="button">
        <Plus size={14} /> Add item
      </button>
    </div>
  );
}
