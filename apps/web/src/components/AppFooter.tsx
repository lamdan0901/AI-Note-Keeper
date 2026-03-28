import React from 'react';
import { Smartphone } from 'lucide-react';

const MOBILE_APP_LINK = 'https://github.com/lamdan0901/AI-Note-Keeper/releases';

export function AppFooter(): JSX.Element {
  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <a
          className="app-footer__mobile-link"
          href={MOBILE_APP_LINK}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Smartphone size={14} />
          Download Mobile App
        </a>
        <span className="app-footer__divider" aria-hidden="true">·</span>
        <p className="app-footer__copy">
          © {new Date().getFullYear()} AI Note Keeper
        </p>
      </div>
    </footer>
  );
}

