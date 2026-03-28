import React from 'react';
import { Brain, Smartphone, LogIn, ArrowRight, Zap, RefreshCw, Shield } from 'lucide-react';

const MOBILE_APP_LINK = 'https://github.com/lamdan0901/AI-Note-Keeper/releases';

type LandingPageProps = {
  onEnterApp: () => void;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
};

export function LandingPage({
  onEnterApp,
  onOpenLogin,
}: LandingPageProps): JSX.Element {
  return (
    <div className="landing">
      {/* ── Header ── */}
      <header className="landing__header">
        <div className="landing__header-inner">
          <div className="landing__logo">
            <div className="landing__logo-icon">
              <Brain size={22} />
            </div>
            <span className="landing__logo-name">AI Note Keeper</span>
          </div>
          <div className="landing__header-actions">
            <a
              className="landing__header-btn landing__header-btn--mobile"
              href={MOBILE_APP_LINK}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Smartphone size={15} />
              <span>Mobile App</span>
            </a>
            <button
              className="landing__header-btn landing__header-btn--ghost"
              onClick={onOpenLogin}
              type="button"
            >
              <LogIn size={15} />
              <span>Sign In</span>
            </button>
            <button
              className="landing__header-btn landing__header-btn--solid"
              onClick={onEnterApp}
              type="button"
            >
              Go to App
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="landing__hero">
        <div className="landing__hero-content">
          <span className="landing__eyebrow">✦ AI-Powered Note Taking</span>
          <h1 className="landing__headline">
            Your notes,{' '}
            <span className="landing__headline-accent">everywhere</span>{' '}
            you need them
          </h1>
          <p className="landing__subline">
            Create, organise, and sync your notes and subscriptions across all
            devices. Start local with no account required — sign in when
            you&apos;re ready.
          </p>
          <div className="landing__hero-actions">
            <button
              className="landing__cta-primary"
              onClick={onOpenLogin}
              type="button"
            >
              <LogIn size={18} />
              Sign In to Your Account
            </button>
            <button
              className="landing__cta-secondary"
              onClick={onEnterApp}
              type="button"
            >
              Continue Without Account
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Decorative floating note cards */}
        <div className="landing__hero-deco" aria-hidden="true">
          <div className="landing__deco-card landing__deco-card--1">
            <div className="landing__deco-card-title">Meeting Notes</div>
            <div className="landing__deco-card-body">
              Discussed Q1 targets and roadmap priorities for the upcoming
              sprint…
            </div>
            <div className="landing__deco-card-tag">📅 Reminder set</div>
          </div>
          <div className="landing__deco-card landing__deco-card--2">
            <div className="landing__deco-card-title">Ideas ✨</div>
            <div className="landing__deco-card-body">
              New feature concept for the mobile app interface…
            </div>
          </div>
          <div className="landing__deco-card landing__deco-card--3">
            <div className="landing__deco-card-title">Grocery List</div>
            <div className="landing__deco-card-body">
              ☑ Milk &nbsp; ☑ Eggs &nbsp; ☐ Bread &nbsp; ☐ Butter
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="landing__features">
        <div className="landing__features-inner">
          <h2 className="landing__features-title">Everything you need in one place</h2>
          <div className="landing__features-grid">
            <div className="landing__feature-card">
              <div className="landing__feature-icon landing__feature-icon--blue">
                <Zap size={24} />
              </div>
              <h3 className="landing__feature-title">AI-Powered</h3>
              <p className="landing__feature-desc">
                Smart note creation with AI assistance. Organise your thoughts
                faster with intelligent suggestions and reminders.
              </p>
            </div>
            <div className="landing__feature-card">
              <div className="landing__feature-icon landing__feature-icon--purple">
                <RefreshCw size={24} />
              </div>
              <h3 className="landing__feature-title">Seamless Sync</h3>
              <p className="landing__feature-desc">
                Access your notes on web and mobile. Real-time sync keeps
                everything up to date across all your devices.
              </p>
            </div>
            <div className="landing__feature-card">
              <div className="landing__feature-icon landing__feature-icon--green">
                <Shield size={24} />
              </div>
              <h3 className="landing__feature-title">Privacy First</h3>
              <p className="landing__feature-desc">
                Start locally with no account needed. Your data stays on your
                device until you choose to sync.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing__footer">
        <div className="landing__footer-inner">
          <div className="landing__footer-logo">
            <Brain size={17} />
            <span>AI Note Keeper</span>
          </div>
          <a
            className="landing__footer-mobile-link"
            href={MOBILE_APP_LINK}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Smartphone size={15} />
            Download Mobile App
          </a>
          <p className="landing__footer-copy">
            © {new Date().getFullYear()} AI Note Keeper. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

