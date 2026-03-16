import React from 'react';
import type { ChecklistItem } from '../../../../packages/shared/types/note';

interface ChecklistDisplayProps {
  items: ChecklistItem[];
  maxItems?: number;
}

export function ChecklistDisplay({ items, maxItems = 5 }: ChecklistDisplayProps) {
  const visible = maxItems > 0 ? items.slice(0, maxItems) : items;
  const remaining = items.length - visible.length;

  return (
    <div className="checklist-display" role="list" aria-label="Checklist">
      {visible.map((item) => (
        <div
          key={item.id}
          className={`checklist-display__item${item.checked ? ' checklist-display__item--checked' : ''}`}
          role="listitem"
        >
          <span className="checklist-display__icon" aria-hidden="true">
            {item.checked ? '✓' : '○'}
          </span>
          <span className="checklist-display__text">{item.text}</span>
        </div>
      ))}
      {remaining > 0 && <div className="checklist-display__more">+{remaining} more</div>}
    </div>
  );
}
