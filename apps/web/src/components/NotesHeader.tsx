import React from 'react';
import { LayoutGrid, List, Monitor, Moon, Plus, Sun } from 'lucide-react';
import type { NotesViewMode } from '../services/notesTypes';
import type { ThemeMode } from '../services/theme';

interface NotesHeaderProps {
  viewMode: NotesViewMode;
  onToggleView: (mode: NotesViewMode) => void;
  onNewNote: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}

const SAVE_STATUS_LABELS: Record<NotesHeaderProps['saveStatus'], string | null> = {
  idle: null,
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error saving',
};

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: React.ReactNode; label: string }> = [
  { mode: 'light', icon: <Sun size={16} />, label: 'Light' },
  { mode: 'dark', icon: <Moon size={16} />, label: 'Dark' },
  { mode: 'system', icon: <Monitor size={16} />, label: 'System' },
];

export function NotesHeader({
  viewMode,
  onToggleView,
  onNewNote,
  saveStatus,
  themeMode,
  onThemeModeChange,
}: NotesHeaderProps) {
  const statusLabel = SAVE_STATUS_LABELS[saveStatus];

  return (
    <header className="notes-header">
      <span className="notes-header__title">Notes</span>

      <div className="notes-header__actions">
        {statusLabel && (
          <span className={`notes-header__status notes-header__status--${saveStatus}`}>
            {statusLabel}
          </span>
        )}
        <div className="notes-header__theme" role="radiogroup" aria-label="Theme mode">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={`notes-header__theme-btn${
                themeMode === option.mode ? ' notes-header__theme-btn--active' : ''
              }`}
              onClick={() => onThemeModeChange(option.mode)}
              role="radio"
              aria-checked={themeMode === option.mode}
              title={option.label}
            >
              <span className="notes-header__theme-btn-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span className="notes-header__theme-btn-text">{option.label}</span>
            </button>
          ))}
        </div>

        <div className="notes-header__view-toggle" role="group" aria-label="View mode">
          <button
            className={`notes-header__view-btn${viewMode === 'grid' ? ' notes-header__view-btn--active' : ''}`}
            onClick={() => onToggleView('grid')}
            aria-pressed={viewMode === 'grid'}
            title="Grid view"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            className={`notes-header__view-btn${viewMode === 'list' ? ' notes-header__view-btn--active' : ''}`}
            onClick={() => onToggleView('list')}
            aria-pressed={viewMode === 'list'}
            title="List view"
          >
            <List size={16} />
          </button>
        </div>

        <button className="notes-header__new-btn" onClick={onNewNote}>
          <Plus size={16} /> New note
        </button>
      </div>
    </header>
  );
}
