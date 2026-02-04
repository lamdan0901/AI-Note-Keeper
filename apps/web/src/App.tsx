import React from "react";

export default function App(): JSX.Element {
  return (
    <main className="app">
      <header className="hero">
        <p className="tag">US1 MVP scaffold</p>
        <h1>AI Note Keeper</h1>
        <p className="subtitle">
          Web + mobile reminder sync foundation is wired. Add your Convex auth
          + reminder UI next.
        </p>
      </header>
      <section className="panel">
        <h2>Status</h2>
        <ul>
          <li>Web app bootstrapped (Vite + React).</li>
          <li>Convex hooks available in services.</li>
          <li>Mobile Expo app scaffolded.</li>
        </ul>
      </section>
    </main>
  );
}
