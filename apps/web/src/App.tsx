import React, { useEffect, useState, useRef } from 'react';
import {
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Sun,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import NotesPage from './pages/NotesPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import { useSubscriptions } from './services/subscriptions';
import { SubscriptionReminderBanner } from './components/subscriptions/SubscriptionReminderBanner';
import { useWebAuth } from './auth/AuthContext';
import { AuthDialog } from './components/auth/AuthDialog';
import { AccountMergeDialog } from './components/auth/AccountMergeDialog';
import {
  getStoredThemeMode,
  getSystemPrefersDark,
  resolveThemeMode,
  SYSTEM_DARK_QUERY,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from './services/theme';
import type { NotesViewMode } from './services/notesTypes';
import { LandingPage } from './components/LandingPage';
import { AppFooter } from './components/AppFooter';

const LANDING_DISMISSED_KEY = 'ai-note-keeper-landing-dismissed';

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: React.ReactNode; label: string }> = [
  { mode: 'light', icon: <Sun size={16} />, label: 'Light' },
  { mode: 'dark', icon: <Moon size={16} />, label: 'Dark' },
];

type ActiveTab = 'notes' | 'subscriptions';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_STATUS_LABELS: Record<SaveStatus, string | null> = {
  idle: null,
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error saving',
};

export default function App(): JSX.Element {
  const {
    username,
    isAuthenticated,
    isLoading: authLoading,
    pendingMerge,
    transitionState,
    login,
    register,
    resolvePendingMerge,
    cancelPendingMerge,
    logout,
  } = useWebAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(getStoredThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<ThemeMode>(() =>
    resolveThemeMode(getStoredThemeMode(), getSystemPrefersDark()),
  );
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
  const [notesSearchQuery, setNotesSearchQuery] = useState('');
  const [subsSearchQuery, setSubsSearchQuery] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState<SaveStatus>('idle');
  const [authDialog, setAuthDialog] = useState<'login' | 'register' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [showLanding, setShowLanding] = useState(
    () => !sessionStorage.getItem(LANDING_DISMISSED_KEY),
  );

  const dismissLanding = () => {
    sessionStorage.setItem(LANDING_DISMISSED_KEY, '1');
    setShowLanding(false);
  };

  const openLoginFromLanding = () => {
    dismissLanding();
    setAuthError(null);
    setAuthDialog('login');
  };

  const openRegisterFromLanding = () => {
    dismissLanding();
    setAuthError(null);
    setAuthDialog('register');
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (themeMode == null) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_DARK_QUERY);

    const applyTheme = () => {
      const resolvedTheme = resolveThemeMode(themeMode, mediaQuery.matches);
      setResolvedTheme(resolvedTheme);
      const root = document.documentElement;
      root.dataset.theme = resolvedTheme;
      root.style.colorScheme = resolvedTheme;
    };

    applyTheme();

    if (themeMode != null) {
      return;
    }

    const handleThemeChange = () => applyTheme();
    mediaQuery.addEventListener('change', handleThemeChange);
    return () => mediaQuery.removeEventListener('change', handleThemeChange);
  }, [themeMode]);

  const activeSearchQuery = activeTab === 'notes' ? notesSearchQuery : subsSearchQuery;
  const activeSearchPlaceholder =
    activeTab === 'notes'
      ? notesViewingTrash
        ? 'Search deleted notes'
        : 'Search notes'
      : subsViewingTrash
        ? 'Search deleted subscriptions'
        : 'Search subscriptions';
  const hasSearch = activeSearchQuery.trim().length > 0;
  const notesStatusLabel = SAVE_STATUS_LABELS[notesSaveStatus];
  const authBusy =
    authLoading ||
    transitionState === 'preflight' ||
    transitionState === 'applying' ||
    transitionState === 'logout-snapshot';

  const handleAuthSubmit = async (
    mode: 'login' | 'register',
    enteredUsername: string,
    password: string,
  ) => {
    setAuthError(null);
    const result =
      mode === 'login'
        ? await login(enteredUsername, password)
        : await register(enteredUsername, password);
    if (result.success || result.requiresMerge) {
      setAuthDialog(null);
      return;
    }
    setAuthError(result.error ?? 'Authentication failed');
  };

  if (showLanding) {
    return (
      <>
        <LandingPage
          onEnterApp={dismissLanding}
          onOpenLogin={openLoginFromLanding}
          onOpenRegister={openRegisterFromLanding}
        />
        {authDialog && (
          <AuthDialog
            mode={authDialog}
            loading={authBusy}
            error={authError}
            onClose={() => setAuthDialog(null)}
            onSwitchMode={() => {
              setAuthError(null);
              setAuthDialog(authDialog === 'login' ? 'register' : 'login');
            }}
            onSubmit={(enteredUsername, password) =>
              handleAuthSubmit(authDialog, enteredUsername, password)
            }
          />
        )}
      </>
    );
  }

  return (
    <>
      <nav className="app-nav">
        <div className="app-nav__left">
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
        </div>
        <div className="app-nav__search">
          <input
            className="app-nav__search-input"
            type="text"
            value={activeSearchQuery}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (activeTab === 'notes') {
                setNotesSearchQuery(nextValue);
              } else {
                setSubsSearchQuery(nextValue);
              }
            }}
            placeholder={activeSearchPlaceholder}
            aria-label={activeSearchPlaceholder}
          />
          {hasSearch && (
            <button
              className="app-nav__search-clear"
              type="button"
              onClick={() => {
                if (activeTab === 'notes') {
                  setNotesSearchQuery('');
                } else {
                  setSubsSearchQuery('');
                }
              }}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="app-nav__right">
          <div
            className="app-nav__theme notes-header__view-toggle"
            role="radiogroup"
            aria-label="Theme mode"
          >
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.mode}
                className={`notes-header__view-btn${resolvedTheme === option.mode ? ' notes-header__view-btn--active' : ''}`}
                onClick={() => setThemeMode(option.mode)}
                role="radio"
                aria-checked={resolvedTheme === option.mode}
                aria-label={option.label}
                title={option.label}
                type="button"
              >
                <span className="notes-header__theme-btn-icon" aria-hidden="true">
                  {option.icon}
                </span>
              </button>
            ))}
          </div>

          <div
            className="app-nav__actions"
            style={{ display: activeTab === 'notes' ? undefined : 'none' }}
          >
            {notesStatusLabel && (
              <span className={`notes-header__status notes-header__status--${notesSaveStatus}`}>
                {notesStatusLabel}
              </span>
            )}
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
              className="subs-header__new-btn"
              onClick={() => setNewNoteTrigger((t) => t + 1)}
              type="button"
            >
              <Plus size={16} /> New
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
          </div>
          <div
            className="app-nav__actions"
            style={{ display: activeTab === 'subscriptions' ? undefined : 'none' }}
          >
            <div className="notes-header__view-toggle" role="group" aria-label="View mode">
              <button
                className={`notes-header__view-btn${subsViewMode === 'grid' ? ' notes-header__view-btn--active' : ''}`}
                onClick={() => setSubsViewMode('grid')}
                aria-pressed={subsViewMode === 'grid'}
                title="Grid view"
                type="button"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                className={`notes-header__view-btn${subsViewMode === 'list' ? ' notes-header__view-btn--active' : ''}`}
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
          </div>

          <div className="app-nav__account-dropdown-container" ref={accountMenuRef}>
            <button
              className={`app-nav__account-dropdown-trigger${accountMenuOpen ? ' app-nav__account-dropdown-trigger--active' : ''}`}
              type="button"
              onClick={() => setAccountMenuOpen((prev) => !prev)}
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              title="Account menu"
            >
              <User size={16} />
            </button>

            {accountMenuOpen && (
              <div className="app-nav__account-dropdown-menu" role="menu">
                {isAuthenticated ? (
                  <>
                    <div className="app-nav__account-dropdown-header">
                      <div className="app-nav__account-dropdown-label">Signed in as</div>
                      <div className="app-nav__account-dropdown-value" title={username ?? ''}>
                        {username}
                      </div>
                    </div>
                    <button
                      className="app-nav__account-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        void logout();
                      }}
                      disabled={authBusy}
                    >
                      <LogOut size={16} style={{ marginRight: '8px' }} /> Log out
                    </button>
                  </>
                ) : (
                  <>
                    <div className="app-nav__account-dropdown-header">
                      <div className="app-nav__account-dropdown-label">Mode</div>
                      <div className="app-nav__account-dropdown-value">Local only</div>
                    </div>
                    <button
                      className="app-nav__account-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setAuthError(null);
                        setAuthDialog('login');
                      }}
                    >
                      <LogIn size={16} style={{ marginRight: '8px' }} /> Sign in
                    </button>
                    <button
                      className="app-nav__account-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setAuthError(null);
                        setAuthDialog('register');
                      }}
                    >
                      <UserPlus size={16} style={{ marginRight: '8px' }} /> Create account
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
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
          searchQuery={notesSearchQuery}
          onSaveStatusChange={setNotesSaveStatus}
          onTrashCountChange={setNotesTrashCount}
        />
      </div>
      <div style={{ display: activeTab === 'subscriptions' ? undefined : 'none' }}>
        <SubscriptionsPage
          viewMode={subsViewMode}
          viewingTrash={subsViewingTrash}
          searchQuery={subsSearchQuery}
          newSubTrigger={newSubTrigger}
          onTrashCountChange={setSubsTrashCount}
        />
      </div>

      {authDialog && (
        <AuthDialog
          mode={authDialog}
          loading={authBusy}
          error={authError}
          onClose={() => setAuthDialog(null)}
          onSwitchMode={() => {
            setAuthError(null);
            setAuthDialog(authDialog === 'login' ? 'register' : 'login');
          }}
          onSubmit={(enteredUsername, password) =>
            handleAuthSubmit(authDialog, enteredUsername, password)
          }
        />
      )}

      {pendingMerge && (
        <AccountMergeDialog
          summary={pendingMerge.summary}
          loading={transitionState === 'applying'}
          onClose={cancelPendingMerge}
          onChoose={(strategy) => {
            void resolvePendingMerge(strategy);
          }}
        />
      )}

      <AppFooter />
    </>
  );
}
