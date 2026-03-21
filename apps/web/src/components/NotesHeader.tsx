import React from 'react';
import { X } from 'lucide-react';

interface NotesHeaderProps {
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onClearSearch: () => void;
}

const SAVE_STATUS_LABELS: Record<NotesHeaderProps['saveStatus'], string | null> = {
  idle: null,
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error saving',
};

export function NotesHeader({
  saveStatus,
  searchQuery,
  onSearchQueryChange,
  onClearSearch,
}: NotesHeaderProps) {
  const statusLabel = SAVE_STATUS_LABELS[saveStatus];
  const hasSearch = searchQuery.trim().length > 0;

  return (
    <header className="notes-header">
      <div className="notes-header__search">
        <input
          className="notes-header__search-input"
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
        />
        {hasSearch && (
          <button
            className="notes-header__search-clear"
            type="button"
            onClick={onClearSearch}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {statusLabel && (
        <div className="notes-header__actions">
          <span className={`notes-header__status notes-header__status--${saveStatus}`}>
            {statusLabel}
          </span>
        </div>
      )}
    </header>
  );
}
