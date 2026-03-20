import React, { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
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
      </nav>

      {subscriptions != null && subscriptions.length > 0 && (
        <div className="app-banner-wrap">
          <SubscriptionReminderBanner subscriptions={subscriptions} />
        </div>
      )}

      <div style={{ display: activeTab === 'notes' ? undefined : 'none' }}>
        <NotesPage />
      </div>
      <div style={{ display: activeTab === 'subscriptions' ? undefined : 'none' }}>
        <SubscriptionsPage />
      </div>
    </>
  );
}
