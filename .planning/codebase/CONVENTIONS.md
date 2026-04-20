# Coding Conventions

**Analysis Date:** 2026-04-17

## Naming Patterns

**Files:**

- TypeScript modules generally use camelCase filenames (`noteSync.ts`, `reminderTriggers.ts`, `localUserData.ts`).
- React components/screens use PascalCase (`NotesScreen.tsx`, `AuthDialog.tsx`, `LandingPage.tsx`).
- Test files consistently use `*.test.ts`.
- SQL migrations use numeric prefix and snake_case (`00001_users.sql`, `00009_core_indexes.sql`).

**Functions:**

- camelCase function naming dominates (`computeNextTrigger`, `normalizeVoiceIntentResponse`, `resolvePendingMerge`).
- Hook names follow React hook conventions (`useNotes`, `useAuth`, `useSubscriptions`).

**Variables and constants:**

- Local variables are camelCase.
- Constants are UPPER_SNAKE_CASE where semantic/global (`MAX_LOOKBACK_MS`, `PROVIDER_TIMEOUT_MS`).
- Transition/state labels are string unions for readability (`'idle' | 'preflight' | ...`).

**Types:**

- Type aliases and interfaces use PascalCase (`AuthState`, `HealthStatus`, `RepeatRule`).
- Validator constants are descriptive lower camel case in Convex modules.

## Code Style

**Formatting:**

- Prettier is configured at workspace level (`npm run format`).
- ESLint baseline via `.eslintrc.cjs` with TypeScript + React + hooks plugins.
- Existing code strongly favors semicolons and single quotes in TS files.
- 2-space indentation is consistent across sampled files.

**Linting:**

- Root lint script: `npm run lint`.
- Web has a scoped lint script: `npm --workspace apps/web run lint`.
- Some explicit lint suppressions are present where required by runtime constraints (for example `@ts-expect-error`, `eslint-disable-next-line`).

## Import Organization

**Observed order pattern:**

1. External library imports.
2. Internal app/shared imports.
3. Type-only or generated API imports where needed.

**Grouping:**

- Blank lines separate conceptual import groups in most files.
- Relative paths are used heavily; no broad monorepo aliasing convention is enforced across all workspaces.

## Error Handling

**Patterns:**

- Convex functions throw `Error` for invalid domain input and rely on runtime propagation.
- Express migration backend uses typed `AppError` with category/status mapping.
- Startup is fail-fast for invalid env configuration (`apps/backend/src/config.ts`).

**Boundary strategy:**

- Middleware-level normalization in Express (`errorMiddleware`, `notFoundMiddleware`).
- Async actions log contextual failures and continue per-item in fan-out loops (push/cron patterns).

## Logging

**Framework:**

- Predominantly console logging (`console.log`, `console.warn`, `console.error`).

**Patterns:**

- Lifecycle and operational logs in background flows (cron/push/device token handling).
- Error logging before fallback paths in AI and bootstrap logic.
- No centralized structured logger package found in current workspace.

## Comments

**When comments appear:**

- Clarifying non-obvious behavior (cron windows, recurrence logic, fallback reasons).
- Guarding compatibility and migration context (legacy fields, canonical fields).
- Rare lint suppressions explained inline.

**Tone and style:**

- Comments usually explain why a branch exists rather than restating code.
- There are TODO markers in a few mobile reminder/UI spots signaling deferred reliability/UX work.

## Function Design

**Common traits:**

- Utility functions tend to be pure and type-annotated (`packages/shared/utils/*`).
- Domain handlers can be larger when they include validation + mutation + side effects (especially Convex actions).
- Guard clauses are commonly used for early exits (`if (!existing) return null`).

## Module Design

**Exports:**

- Named exports are the norm in TS modules.
- Default exports are used primarily for top-level React components (`App.tsx`) and Convex schema export.

**Boundaries:**

- Shared behavior is intentionally extracted to `packages/shared` and imported from app/backend modules.
- Migration backend is moving toward route/service/repository separation but currently concentrated in `apps/backend/src` with scaffolding elsewhere.

## Guidance for New Code

- Keep filenames aligned with existing feature/runtime conventions.
- Reuse shared domain utilities (`packages/shared`) instead of duplicating recurrence/hash logic.
- Prefer explicit typed errors and stable response shapes for new backend HTTP endpoints.
- Keep TODOs actionable and localized when postponing behavior.

---

_Convention analysis: 2026-04-17_
_Update when lint rules, naming, or backend layering conventions change_
