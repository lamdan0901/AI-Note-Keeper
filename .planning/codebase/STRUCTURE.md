# Codebase Structure

**Analysis Date:** 2026-04-17

## Directory Layout

```text
ai-note-keeper/
├── apps/                         # App surfaces by runtime
│   ├── backend/                  # Express + PostgreSQL migration backend
│   │   ├── src/                  # Active backend source (config, db, middleware, tests)
│   │   ├── db/, jobs/, routes/   # Planned target architecture directories (mostly scaffolded)
│   │   └── package.json          # Backend scripts/deps
│   ├── mobile/                   # Expo/React Native client
│   │   ├── src/                  # Mobile features (auth, notes, reminders, sync, voice)
│   │   ├── tests/                # Mobile unit/integration tests
│   │   └── android/              # Native Android project
│   └── web/                      # React + Vite client
│       ├── src/                  # Web app pages/components/services/auth
│       └── tests/                # Web test suite
├── convex/                       # Current backend schema + functions + cron definitions
│   ├── functions/                # Domain functions (auth/notes/reminders/subscriptions/push/ai)
│   ├── _generated/               # Convex generated API/types
│   ├── crons.ts                  # Scheduled jobs
│   └── schema.ts                 # Convex data model
├── packages/shared/              # Cross-app shared domain utilities/constants/types
├── tests/                        # Root contract/integration/live/mobile migration tests
├── docs/                         # Project and migration documentation
├── android/                      # Root Android project artifacts
├── docker-compose.yml            # Local postgres service for migration backend
├── package.json                  # Workspace scripts and dependencies
└── AGENTS.md                     # Repo-level working guidelines
```

## Directory Purposes

**apps/backend:**

- Purpose: Migration target backend (Express + PostgreSQL).
- Contains: Config, db pool/bootstrap/migrations, error catalog/middleware, health endpoints, backend tests.
- Key files: `apps/backend/src/index.ts`, `apps/backend/src/migrate.ts`, `apps/backend/src/db/migrations/*`.
- Subdirectories: `src/db`, `src/errors`, `src/middleware`, `src/tests`.

**convex:**

- Purpose: Current production logic and data model.
- Contains: query/mutation/action handlers, cron jobs, generated client/server types.
- Key files: `convex/schema.ts`, `convex/crons.ts`, `convex/functions/*.ts`.

**apps/mobile/src:**

- Purpose: Mobile product implementation with offline/sync/reminder/push handling.
- Contains: feature-organized modules (`auth`, `notes`, `reminders`, `sync`, `voice`, `screens`).
- Key files: `apps/mobile/App.tsx`, `apps/mobile/src/auth/AuthContext.tsx`, `apps/mobile/src/sync/*`.

**apps/web/src:**

- Purpose: Web product implementation and service abstraction over Convex.
- Contains: pages, components, auth context, notes/reminders/subscriptions service modules.
- Key files: `apps/web/src/App.tsx`, `apps/web/src/services/notes.ts`.

**packages/shared:**

- Purpose: Domain-level shared logic and types used across backend/clients.
- Contains: recurrence, hash/checklist utilities, reminder/auth-related types/constants.
- Key files: `packages/shared/utils/recurrence.ts`, `packages/shared/utils/hash.ts`.

## Key File Locations

**Entry Points:**

- `apps/web/src/main.tsx` - Web app bootstrapping.
- `apps/mobile/App.tsx` - Mobile app bootstrapping.
- `convex/functions/*.ts` - Convex callable units.
- `apps/backend/src/index.ts` - Express server start.

**Configuration:**

- `package.json` - workspace scripts and dependency root.
- `.eslintrc.cjs` - lint baseline.
- `jest.config.js` - root Jest setup.
- `apps/*/tsconfig.json` - app-specific TS behavior.
- `apps/backend/.env.example` - backend env contract.

**Core Logic:**

- `convex/functions/notes.ts` - note sync and trash semantics.
- `convex/functions/reminders.ts` - reminder CRUD/ack/snooze transitions.
- `convex/functions/reminderTriggers.ts` - cron watermark and trigger logic.
- `convex/functions/subscriptions.ts` - subscription lifecycle and reminders.

**Testing:**

- `tests/contract/*.test.ts` - behavior parity contracts.
- `tests/integration/*.test.ts` - cross-flow integration tests.
- `apps/mobile/tests/{unit,integration}/*.test.ts` - mobile-focused tests.
- `apps/web/tests/*.test.ts` - web-focused tests (Vitest).
- `apps/backend/src/tests/*.test.ts` - backend migration-side tests.

## Naming Conventions

**Files:**

- Mostly `camelCase.ts` for service/logic files (`noteSync.ts`, `reminderTriggers.ts`).
- `PascalCase.tsx` for React components/screens (`NotesScreen.tsx`, `LandingPage.tsx`).
- `*.test.ts` for tests.
- SQL migrations use numeric prefix + snake_case (`00009_core_indexes.sql`).

**Directories:**

- Feature/domain-oriented in clients (`auth`, `reminders`, `subscriptions`, `voice`).
- Runtime-oriented at top-level (`apps/backend`, `apps/mobile`, `apps/web`).

## Where to Add New Code

**New Convex domain behavior:**

- Implementation: `convex/functions/<domain>.ts`.
- Schema/index changes: `convex/schema.ts` (and matching SQL migration if part of migration path).
- Tests: `tests/contract` and relevant app tests.

**New Express migration backend endpoint/service:**

- Primary code: `apps/backend/src` (follow `routes/services/repositories` target pattern as folders populate).
- SQL changes: `apps/backend/src/db/migrations`.
- Tests: `apps/backend/src/tests`.

**New mobile feature:**

- Feature code: `apps/mobile/src/<feature>/`.
- Screens/components: `apps/mobile/src/screens` / `apps/mobile/src/components`.
- Tests: `apps/mobile/tests/unit` or `apps/mobile/tests/integration`.

**New shared domain helper/type:**

- Shared logic: `packages/shared/utils`.
- Shared types/constants: `packages/shared/types`, `packages/shared/constants`.

## Special Directories

**convex/\_generated:**

- Purpose: generated Convex API/type artifacts.
- Source: Convex codegen.
- Committed: yes (present in workspace).

**apps/backend/dist:**

- Purpose: compiled backend artifacts.
- Source: TypeScript build output.
- Committed: appears generated/build-oriented and should be treated as derived output.

**.planning/codebase:**

- Purpose: generated codebase mapping docs for planning workflows.
- Source: gsd-map-codebase workflow output.

---

_Structure analysis: 2026-04-17_
_Update when module boundaries or directory ownership changes_
