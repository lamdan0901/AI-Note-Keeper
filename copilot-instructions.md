<!-- GSD:project-start source:PROJECT.md -->
## Project

**AI Note Keeper: Convex to Express Migration**

This project migrates AI Note Keeper from a Convex-centric backend to an Express plus PostgreSQL backend while preserving behavior parity for web and mobile users. The migration is phase-based and prioritizes correctness, compatibility, and operational safety over feature expansion. Existing client-facing behavior remains stable during cutover, with legacy session and password compatibility preserved.

**Core Value:** Migrate backend infrastructure to Express/PostgreSQL with no user-facing regressions in core notes, reminders, subscriptions, and session flows.

### Constraints

- **Shared package reuse**: packages/shared remains unchanged and is imported by the new backend — prevents semantic drift in core logic.
- **Auth/session model**: JWT access plus rotating refresh tokens with hashed refresh token storage — improves session security while preserving compatibility.
- **Legacy compatibility**: Existing clients with raw userId must upgrade via POST /auth/upgrade-session — prevents forced re-auth cutover failures.
- **Password migration**: Support legacy salt:sha256 and lazily upgrade to argon2id on login — avoids lockout during transition.
- **Background execution**: Deferred work uses pg-boss and cron runs in a dedicated worker process — required reliability model.
- **Polling contract gate**: Notes sync on focus plus 30-second polling is mandatory before web cutover — explicit go-live gate.
- **Reminder safety guards**: Preserve MAX_LOOKBACK_MS and cron_state.key uniqueness semantics — protects cron correctness and upsert behavior.
- **Notification ledger boundary**: notification_ledger stays mobile-local SQLite only, never PostgreSQL — preserves client-local dedupe design.
- **Migration timing**: Export/import/reconcile tooling starts early, not only at final cutover — reduces late-stage migration risk.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript - Main application code in Convex functions, backend service, web app, mobile app, and shared packages.
- JavaScript - Workspace and tooling configuration (`jest.config.js`, `.eslintrc.cjs`, Expo/Babel config files).
- SQL - PostgreSQL schema and index migrations in `apps/backend/src/db/migrations/*.sql`.
- Markdown - Project docs, migration planning docs, and operational guides.
## Runtime
- Node.js runtime for backend service (`apps/backend`) and tooling scripts.
- Convex runtime for serverless data/functions in `convex/functions/*`.
- Browser runtime for web app (`apps/web`).
- React Native/Expo runtime for mobile app (`apps/mobile`).
- npm workspaces (`apps/*`, `packages/*`).
- Lockfile present: `package-lock.json`.
## Frameworks
- Convex `^1.33.1` - Primary current backend/data platform.
- Express `^5.2.1` - New PostgreSQL backend skeleton under migration (`apps/backend/src/index.ts`).
- React `18.2.0` - UI framework for web and mobile.
- Expo `~50.0.0` / React Native `0.73.6` - Mobile platform.
- Vite `^5.4.0` - Web dev/build tooling (`apps/web`).
- Jest `^30.2.0` + `ts-jest` - Root tests, contract tests, and many mobile/backend tests.
- Node test runner (`node:test`) - Used by backend tests compiled in `apps/backend/src/tests/*`.
- Vitest `^2.1.9` - Web test suite in `apps/web/tests`.
- TypeScript `^5.4.0` across workspaces.
- tsx `^4.21.0` for backend watch mode.
- concurrently `^9.2.1` for multi-process dev scripts.
## Key Dependencies
- `convex` - Data model, query/mutation/action runtime, scheduler/cron.
- `pg` - PostgreSQL connectivity for migration target backend.
- `zod` - Environment and request validation in backend migration surface.
- `openai` - NVIDIA-compatible AI API client via custom `baseURL`.
- `@react-native-firebase/messaging` + `expo-notifications` - Push and notification behavior on mobile.
- Docker Compose + `postgres:16-alpine` for local PostgreSQL runtime (`docker-compose.yml`).
- Expo SQLite (`expo-sqlite`) for mobile local storage and offline behavior.
## Configuration
- Root and workspace env files are used (`apps/backend/.env`, `.env.example`).
- Key env vars observed:
- TypeScript config per app (`apps/backend/tsconfig.json`, `apps/web/tsconfig.json`, `apps/mobile/tsconfig.json`).
- Web bundling via `apps/web/vite.config.ts`.
- Android/Expo build configs in `apps/mobile/android/*`, `eas.json`, `app.json`.
## Platform Requirements
- Cross-platform JS/TS development (Windows confirmed in current context).
- Local Postgres expected for backend migration work (`docker-compose.yml`).
- Android toolchain required for native mobile builds.
- Convex-hosted backend functions remain active source of truth.
- Express/PostgreSQL backend exists as migration target scaffold and partial implementation.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- TypeScript modules generally use camelCase filenames (`noteSync.ts`, `reminderTriggers.ts`, `localUserData.ts`).
- React components/screens use PascalCase (`NotesScreen.tsx`, `AuthDialog.tsx`, `LandingPage.tsx`).
- Test files consistently use `*.test.ts`.
- SQL migrations use numeric prefix and snake_case (`00001_users.sql`, `00009_core_indexes.sql`).
- camelCase function naming dominates (`computeNextTrigger`, `normalizeVoiceIntentResponse`, `resolvePendingMerge`).
- Hook names follow React hook conventions (`useNotes`, `useAuth`, `useSubscriptions`).
- Local variables are camelCase.
- Constants are UPPER_SNAKE_CASE where semantic/global (`MAX_LOOKBACK_MS`, `PROVIDER_TIMEOUT_MS`).
- Transition/state labels are string unions for readability (`'idle' | 'preflight' | ...`).
- Type aliases and interfaces use PascalCase (`AuthState`, `HealthStatus`, `RepeatRule`).
- Validator constants are descriptive lower camel case in Convex modules.
## Code Style
- Prettier is configured at workspace level (`npm run format`).
- ESLint baseline via `.eslintrc.cjs` with TypeScript + React + hooks plugins.
- Existing code strongly favors semicolons and single quotes in TS files.
- 2-space indentation is consistent across sampled files.
- Root lint script: `npm run lint`.
- Web has a scoped lint script: `npm --workspace apps/web run lint`.
- Some explicit lint suppressions are present where required by runtime constraints (for example `@ts-expect-error`, `eslint-disable-next-line`).
## Import Organization
- Blank lines separate conceptual import groups in most files.
- Relative paths are used heavily; no broad monorepo aliasing convention is enforced across all workspaces.
## Error Handling
- Convex functions throw `Error` for invalid domain input and rely on runtime propagation.
- Express migration backend uses typed `AppError` with category/status mapping.
- Startup is fail-fast for invalid env configuration (`apps/backend/src/config.ts`).
- Middleware-level normalization in Express (`errorMiddleware`, `notFoundMiddleware`).
- Async actions log contextual failures and continue per-item in fan-out loops (push/cron patterns).
## Logging
- Predominantly console logging (`console.log`, `console.warn`, `console.error`).
- Lifecycle and operational logs in background flows (cron/push/device token handling).
- Error logging before fallback paths in AI and bootstrap logic.
- No centralized structured logger package found in current workspace.
## Comments
- Clarifying non-obvious behavior (cron windows, recurrence logic, fallback reasons).
- Guarding compatibility and migration context (legacy fields, canonical fields).
- Rare lint suppressions explained inline.
- Comments usually explain why a branch exists rather than restating code.
- There are TODO markers in a few mobile reminder/UI spots signaling deferred reliability/UX work.
## Function Design
- Utility functions tend to be pure and type-annotated (`packages/shared/utils/*`).
- Domain handlers can be larger when they include validation + mutation + side effects (especially Convex actions).
- Guard clauses are commonly used for early exits (`if (!existing) return null`).
## Module Design
- Named exports are the norm in TS modules.
- Default exports are used primarily for top-level React components (`App.tsx`) and Convex schema export.
- Shared behavior is intentionally extracted to `packages/shared` and imported from app/backend modules.
- Migration backend is moving toward route/service/repository separation but currently concentrated in `apps/backend/src` with scaffolding elsewhere.
## Guidance for New Code
- Keep filenames aligned with existing feature/runtime conventions.
- Reuse shared domain utilities (`packages/shared`) instead of duplicating recurrence/hash logic.
- Prefer explicit typed errors and stable response shapes for new backend HTTP endpoints.
- Keep TODOs actionable and localized when postponing behavior.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Shared domain utilities in `packages/shared` consumed by Convex and clients.
- Client-heavy sync orchestration (web + mobile) with backend event propagation.
- Dual-backend transition state: Convex currently active, Express scaffold growing in `apps/backend`.
- Background reminder workflows rely on scheduled jobs and push fan-out.
## Layers
- Purpose: Render notes/reminders/subscriptions UX and manage user interactions.
- Contains: React components/screens/pages in `apps/web/src/*` and `apps/mobile/src/*`.
- Depends on: Convex APIs, local mobile DB/sync modules, shared utility semantics.
- Used by: End users via browser and mobile app.
- Purpose: Device identity, auth session transitions, local/offline state, sync triggers.
- Contains: `apps/mobile/src/sync/*`, `apps/mobile/src/auth/*`, `apps/web/src/services/*`.
- Depends on: Convex functions, local SQLite/secure storage, push/deep-link handlers.
- Used by: UI layer and app bootstrap routines.
- Purpose: Authoritative mutation/query/action logic.
- Contains: Convex functions in `convex/functions/*` and schema in `convex/schema.ts`.
- Depends on: Convex runtime, shared utilities (`packages/shared/utils/*`).
- Used by: Web/mobile clients and cron/scheduler jobs.
- Purpose: Future REST + PostgreSQL architecture with explicit middleware and migration tooling.
- Contains: `apps/backend/src/index.ts`, `apps/backend/src/migrate.ts`, db/error/config modules.
- Depends on: Express, pg pool, SQL migrations.
- Used by: Planned client cutover flow documented in migration roadmap.
## Data Flow
- Server state currently centralized in Convex.
- Mobile additionally maintains local persistence for offline and notification workflows.
- Migration target introduces PostgreSQL as server-side source of truth.
## Key Abstractions
- Purpose: Keep reminder recurrence deterministic across runtimes.
- Examples: `packages/shared/utils/recurrence.ts`, `packages/shared/types/reminder`.
- Pattern: Shared pure utility reused by Convex logic and tests.
- Purpose: Support idempotent sync and event propagation.
- Examples: `noteChangeEvents` table/schema in Convex and SQL migration files.
- Pattern: Payload-hash/change-event tracking plus timestamp/version checks.
- Purpose: Support local anonymous mode, login/register, merge decisions, and session restoration.
- Examples: `apps/mobile/src/auth/AuthContext.tsx`, `apps/web/src/auth/*`, Convex `auth.ts`.
- Pattern: Context-based state machine with explicit transition states.
## Entry Points
- Location: `apps/web/src/main.tsx` and `apps/web/src/App.tsx`.
- Triggers: Browser navigation.
- Responsibilities: UI composition, theme/auth/session interactions, service hooks.
- Location: `apps/mobile/App.tsx`.
- Triggers: App launch, deep links, push callbacks.
- Responsibilities: bootstrap migrations/notifications, auth bootstrap, screen routing.
- Location: `convex/schema.ts`, `convex/functions/*`, `convex/crons.ts`.
- Triggers: client queries/mutations/actions and cron scheduler.
- Responsibilities: persistence, business logic, push/AI side effects.
- Location: `apps/backend/src/index.ts` and `apps/backend/src/migrate.ts`.
- Triggers: HTTP requests or migration command.
- Responsibilities: health/error contracts, DB migration lifecycle.
## Error Handling
- Convex paths mostly throw domain errors directly.
- Express path standardizes errors through `AppError` and catalog mapping.
- Fail-fast env validation at startup (`process.exit(1)` on invalid env).
- Background actions log and continue where possible (push/cron loops).
- Error payload standardization implemented on Express side.
## Cross-Cutting Concerns
- Console logging is the default across Convex actions, mobile bootstrap, and backend startup/migration.
- Convex `v` validators at function boundaries.
- Zod schema validation in Express config path.
- Current identity/session checks in Convex auth functions and client auth contexts.
- Migration plan indicates JWT + refresh rotation target architecture.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.github/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
