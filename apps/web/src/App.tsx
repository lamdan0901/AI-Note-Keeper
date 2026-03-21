import React, { useEffect, useState } from 'react';
import { LayoutGrid, List, Monitor, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import NotesPage from './pages/NotesPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import { useSubscriptions } from './services/subscriptions';
import { SubscriptionReminderBanner } from './components/subscriptions/SubscriptionReminderBanner';
import {
  getInitialThemeMode,
  resolveThemeMode,
  SYSTEM_DARK_QUERY,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from './services/theme';
import type { NotesViewMode } from './services/notesTypes';

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: React.ReactNode; label: string }> = [
  { mode: 'light', icon: <Sun size={16} />, label: 'Light' },
  { mode: 'dark', icon: <Moon size={16} />, label: 'Dark' },
  { mode: 'auto', icon: <Monitor size={16} />, label: 'Auto' },
];

type ActiveTab = 'notes' | 'subscriptions';

export default function App(): JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');
  const subscriptions = useSubscriptions();

  const [notesViewMode, setNotesViewMode] = useState<NotesViewMode>('grid');
  const [subsViewMode, setSubsViewMode] = useState<'grid' | 'list'>('grid');
  const [notesViewingTrash, setNotesViewingTrash] = useState(false);
  const [notesTrashCount, setNotesTrashCount] = useState(0);
  const [subsViewingTrash, setSubsViewingTrash] = useState(false);
  const [subsTrashCount, setSubsTrashCount] = useState(0);
  const [newNoteTrigger, setNewNoteTrigger] = useState(0);
  const [newSubTrigger, setNewSubTrigger] = useState(0);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_DARK_QUERY);

    const applyTheme = () => {
      const resolvedTheme = resolveThemeMode(themeMode, mediaQuery.matches);
      const root = document.documentElement;
      root.dataset.theme = resolvedTheme;
      root.style.colorScheme = resolvedTheme;
    };

    applyTheme();

    if (themeMode !== 'auto') {
      return;
    }

    const handleThemeChange = () => applyTheme();
    mediaQuery.addEventListener('change', handleThemeChange);
    return () => mediaQuery.removeEventListener('change', handleThemeChange);
  }, [themeMode]);

  return (
    <>
      <nav className="app-nav">
        <button
          className={`app-nav__tab${activeTab === 'notes' ? ' app-nav__tab--active' : ''}`}
          onClick={() => setActiveTab('notes')}
          aria-pressed={activeTab === 'notes'}
          type="button"
        >
          Notes
        </button>
        <button
          className={`app-nav__tab${activeTab === 'subscriptions' ? ' app-nav__tab--active' : ''}`}
          onClick={() => setActiveTab('subscriptions')}
          aria-pressed={activeTab === 'subscriptions'}
          type="button"
        >
          Subscriptions
        </button>
        <div className="app-nav__theme" role="radiogroup" aria-label="Theme mode">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={`notes-header__theme-btn${themeMode === option.mode ? ' notes-header__theme-btn--active' : ''}`}
              onClick={() => setThemeMode(option.mode)}
              role="radio"
              aria-checked={themeMode === option.mode}
              title={option.label}
              type="button"
            >
              <span className="notes-header__theme-btn-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span className="notes-header__theme-btn-text">{option.label}</span>
            </button>
          ))}
        </div>

        <div className="app-nav__actions">
          {activeTab === 'notes' ? (
            <>
              <div className="notes-header__view-toggle" role="group" aria-label="View mode">
                <button
                  className={`notes-header__view-btn${notesViewMode === 'grid' ? ' notes-header__view-btn--active' : ''}`}
                  onClick={() => setNotesViewMode('grid')}
                  aria-pressed={notesViewMode === 'grid'}
                  title="Grid view"
                  type="button"
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  className={`notes-header__view-btn${notesViewMode === 'list' ? ' notes-header__view-btn--active' : ''}`}
                  onClick={() => setNotesViewMode('list')}
                  aria-pressed={notesViewMode === 'list'}
                  title="List view"
                  type="button"
                >
                  <List size={16} />
                </button>
              </div>
              <button
                className="notes-header__new-btn"
                onClick={() => setNewNoteTrigger((t) => t + 1)}
                type="button"
              >
                <Plus size={16} /> New note
              </button>
              <button
                className={`notes-header__trash-btn${notesViewingTrash ? ' notes-header__trash-btn--active' : ''}`}
                onClick={() => setNotesViewingTrash((v) => !v)}
                title={notesViewingTrash ? 'Back to notes' : 'View trash'}
                aria-pressed={notesViewingTrash}
                type="button"
              >
                <Trash2 size={16} />
                {!notesViewingTrash && notesTrashCount > 0 && (
                  <span className="notes-header__trash-badge">{notesTrashCount}</span>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="subs-header__view-toggle" role="group" aria-label="View mode">
                <button
                  className={`subs-header__view-btn${subsViewMode === 'grid' ? ' subs-header__view-btn--active' : ''}`}
                  onClick={() => setSubsViewMode('grid')}
                  aria-pressed={subsViewMode === 'grid'}
                  title="Grid view"
                  type="button"
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  className={`subs-header__view-btn${subsViewMode === 'list' ? ' subs-header__view-btn--active' : ''}`}
                  onClick={() => setSubsViewMode('list')}
                  aria-pressed={subsViewMode === 'list'}
                  title="List view"
                  type="button"
                >
                  <List size={16} />
                </button>
              </div>
              <button
                className="subs-header__new-btn"
                onClick={() => setNewSubTrigger((t) => t + 1)}
                type="button"
              >
                <Plus size={16} /> New
              </button>
              <button
                className={`notes-header__trash-btn${subsViewingTrash ? ' notes-header__trash-btn--active' : ''}`}
                onClick={() => setSubsViewingTrash((v) => !v)}
                title={subsViewingTrash ? 'Back to subscriptions' : 'View trash'}
                aria-pressed={subsViewingTrash}
                type="button"
              >
                <Trash2 size={16} />
                {!subsViewingTrash && subsTrashCount > 0 && (
                  <span className="notes-header__trash-badge">{subsTrashCount}</span>
                )}
              </button>
            </>
          )}
        </div>
      </nav>

      {subscriptions != null && subscriptions.length > 0 && (
        <div className="app-banner-wrap">
          <SubscriptionReminderBanner subscriptions={subscriptions} />
        </div>
      )}

      <div style={{ display: activeTab === 'notes' ? undefined : 'none' }}>
        <NotesPage
          viewMode={notesViewMode}
          viewingTrash={notesViewingTrash}
          newNoteTrigger={newNoteTrigger}
          onTrashCountChange={setNotesTrashCount}
        />
      </div>
      <div style={{ display: activeTab === 'subscriptions' ? undefined : 'none' }}>
        <SubscriptionsPage
          viewMode={subsViewMode}
          viewingTrash={subsViewingTrash}
          onToggleView={setSubsViewMode}
          newSubTrigger={newSubTrigger}
          onTrashCountChange={setSubsTrashCount}
        />
      </div>
    </>
  );
}
