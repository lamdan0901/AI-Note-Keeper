# ai-note-keeper Development Guidelines

Auto-generated from all feature plans.

## Active Technologies

- TypeScript monorepo with React, React Native / Expo, Convex, and shared packages
- Mobile client: Expo React Native app
- Web client: Vite + React app
- Backend: `apps/api-next` (Next.js, HTTP layer) over `apps/backend/src` (domain layer, imported via `@backend/*`)
- Shared code: `packages/*`

## Project Structure

```text
android/                 # native Android wrapper for mobile app
apps/
  api-next/             # main backend: HTTP layer only (Next route handlers, auth middleware, cron/internal endpoints, service composition)
  backend/              # legacy Express server + pg-boss worker are retired, BUT src/** is still the live domain layer
                        #   api-next compiles it via `@backend/* -> ../backend/src/*` (apps/api-next/tsconfig.json)
                        #   ~149 imports across ~74 api-next files: notes/reminders services, scheduler,
                        #   scheduled-task-executor, repair-job, repositories/SQL, auth, expenses, subscriptions, db pool
                        #   => editing apps/backend/src changes production behavior. Do not skip it when tracing logic.
  mobile/               # Expo React Native mobile app
  web/                  # frontend web app
packages/                # shared packages, constants, hooks, auth, tokens, types, utils
tests/                   # integration / contract / runtime test suites
docs/                    # documentation and runbooks
```

## Commands

- `npm run lint`
- `npm test`
- `npm run dev`
- `npm run dev:web`
- `npm run dev:mobile`
- `npm run dev:api-next` — Next.js API on port 3001 (worker optional after Phase 5)
- `npm run dev:api-next:full` — api-next + web without Express worker
- `npm run build:web`
- `npm run build:mobile`

## Code Style

TypeScript (React for web, React Native/Expo for Android): follow standard TypeScript and React conventions.

<!-- MANUAL ADDITIONS START -->

- Don't run build to verify changes. just run lint, test (if needed) and typecheck
- Run tests in **run-once / self-terminated** mode — never watch mode. In this repo, the default `test` scripts already exit: root `npm test` → `jest` (no watch unless you pass `--watch`); `apps/web` → `vitest run`; `apps/api-next` → `node --test` / `tsx --test`; `apps/backend` → `node --test dist/tests`. Prefer those scripts over bare `vitest`, `jest --watch`, `tsx --test --watch`, or `apps/web`'s `test:watch`. Do not leave a test process running in the background. Set `block_until_ms` high enough for the full run; if a test command does not exit, diagnose the hang instead of assuming watch mode.
<!-- MANUAL ADDITIONS END -->
