# Technology Stack

**Analysis Date:** 2026-04-17

## Languages

**Primary:**

- TypeScript - Main application code in Convex functions, backend service, web app, mobile app, and shared packages.

**Secondary:**

- JavaScript - Workspace and tooling configuration (`jest.config.js`, `.eslintrc.cjs`, Expo/Babel config files).
- SQL - PostgreSQL schema and index migrations in `apps/backend/src/db/migrations/*.sql`.
- Markdown - Project docs, migration planning docs, and operational guides.

## Runtime

**Environment:**

- Node.js runtime for backend service (`apps/backend`) and tooling scripts.
- Convex runtime for serverless data/functions in `convex/functions/*`.
- Browser runtime for web app (`apps/web`).
- React Native/Expo runtime for mobile app (`apps/mobile`).

**Package Manager:**

- npm workspaces (`apps/*`, `packages/*`).
- Lockfile present: `package-lock.json`.

## Frameworks

**Core:**

- Convex `^1.33.1` - Primary current backend/data platform.
- Express `^5.2.1` - New PostgreSQL backend skeleton under migration (`apps/backend/src/index.ts`).
- React `18.2.0` - UI framework for web and mobile.
- Expo `~50.0.0` / React Native `0.73.6` - Mobile platform.
- Vite `^5.4.0` - Web dev/build tooling (`apps/web`).

**Testing:**

- Jest `^30.2.0` + `ts-jest` - Root tests, contract tests, and many mobile/backend tests.
- Node test runner (`node:test`) - Used by backend tests compiled in `apps/backend/src/tests/*`.
- Vitest `^2.1.9` - Web test suite in `apps/web/tests`.

**Build/Dev:**

- TypeScript `^5.4.0` across workspaces.
- tsx `^4.21.0` for backend watch mode.
- concurrently `^9.2.1` for multi-process dev scripts.

## Key Dependencies

**Critical:**

- `convex` - Data model, query/mutation/action runtime, scheduler/cron.
- `pg` - PostgreSQL connectivity for migration target backend.
- `zod` - Environment and request validation in backend migration surface.
- `openai` - NVIDIA-compatible AI API client via custom `baseURL`.
- `@react-native-firebase/messaging` + `expo-notifications` - Push and notification behavior on mobile.

**Infrastructure:**

- Docker Compose + `postgres:16-alpine` for local PostgreSQL runtime (`docker-compose.yml`).
- Expo SQLite (`expo-sqlite`) for mobile local storage and offline behavior.

## Configuration

**Environment:**

- Root and workspace env files are used (`apps/backend/.env`, `.env.example`).
- Key env vars observed:
  - `DATABASE_URL`, `PORT`
  - `EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_DEVICE_ID`
  - `NVIDIA_API_KEY`, `NVIDIA_MODEL_PARSE`, `NVIDIA_MODEL_CLARIFY`, `NVIDIA_TRANSCRIPT_ZERO_RETENTION`
  - `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`

**Build:**

- TypeScript config per app (`apps/backend/tsconfig.json`, `apps/web/tsconfig.json`, `apps/mobile/tsconfig.json`).
- Web bundling via `apps/web/vite.config.ts`.
- Android/Expo build configs in `apps/mobile/android/*`, `eas.json`, `app.json`.

## Platform Requirements

**Development:**

- Cross-platform JS/TS development (Windows confirmed in current context).
- Local Postgres expected for backend migration work (`docker-compose.yml`).
- Android toolchain required for native mobile builds.

**Production/Deployment Shape (Current):**

- Convex-hosted backend functions remain active source of truth.
- Express/PostgreSQL backend exists as migration target scaffold and partial implementation.

---

_Stack analysis: 2026-04-17_
_Update after major dependency or platform changes_
