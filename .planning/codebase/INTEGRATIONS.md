# External Integrations

**Analysis Date:** 2026-04-17

## APIs & External Services

**AI Provider (NVIDIA-hosted model endpoint):**

- Service: NVIDIA API endpoint via OpenAI client compatibility layer.
  - Integration code: `convex/functions/aiNoteCapture.ts`.
  - Base URL: `https://integrate.api.nvidia.com/v1`.
  - Auth: `NVIDIA_API_KEY` env var.
  - Model selection: `NVIDIA_MODEL_PARSE`, `NVIDIA_MODEL_CLARIFY`.
  - Privacy guard: `NVIDIA_TRANSCRIPT_ZERO_RETENTION` must be `true` before provider calls proceed.
  - Fallback: deterministic parsing/clarification logic when provider config is missing or request fails.

**Push Notification Providers:**

- Service: Firebase Cloud Messaging (FCM v1 API).
  - Integration code: `convex/functions/push.ts`.
  - Auth exchange: Google OAuth token endpoint `https://oauth2.googleapis.com/token`.
  - Delivery endpoint: `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`.
  - Credentials: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`.
  - Operational behavior: stale token cleanup on `UNREGISTERED`, retry scheduling for transient 429/5xx responses.

## Data Storage

**Current Primary Backend Store:**

- Convex document database and scheduler runtime.
  - Schema: `convex/schema.ts`.
  - Functions: `convex/functions/*`.
  - Cron scheduling: `convex/crons.ts`.

**Migration Target Store:**

- PostgreSQL (local/dev via Docker now; target for Express migration).
  - Runtime config: `docker-compose.yml`.
  - Access: `DATABASE_URL`.
  - Migrations: `apps/backend/src/db/migrations/*.sql`.
  - DB client: `pg` pool in `apps/backend/src/db/pool.ts`.

**Client-side Local Storage:**

- Mobile local database and secure/session storage:
  - SQLite (`expo-sqlite`) via `apps/mobile/src/db/*`.
  - SecureStore and AsyncStorage in auth/session lifecycle (`apps/mobile/src/auth/session.ts`, tested by `apps/mobile/tests/unit/auth.sessionLifecycle.test.ts`).
- Notification ledger is intentionally mobile-local per migration plan and not intended for server PostgreSQL.

## Authentication & Identity

**Current Auth Strategy:**

- Convex auth functions currently return raw user identity payloads.
  - `register`, `login`, `validateSession` in `convex/functions/auth.ts`.
  - Password scheme currently supports legacy-style salted SHA-256 in Convex.

**In-flight Migration Auth Strategy:**

- Express backend has migration tables and error/config plumbing for JWT/refresh model evolution.
  - Refresh token table: `apps/backend/src/db/migrations/00008_refresh_tokens.sql`.
  - Planned rotation and hash-based token storage is documented in migration plan.

## Monitoring & Observability

**Logging:**

- Console-based logging in Convex actions/mutations and backend startup/migrations.
- No dedicated centralized observability stack (for example Sentry/Datadog) detected in repo configs.

**Error Contracts:**

- Express path has explicit error catalog/middleware response shape (`apps/backend/src/errors/catalog.ts`, `apps/backend/src/middleware/error-middleware.ts`).

## CI/CD & Deployment

**CI Pipeline:**

- No `.github/workflows/*` files detected in this workspace snapshot.

**Build/Deploy Tooling Present:**

- Expo EAS configuration in `apps/mobile/eas.json` and `apps/mobile/EAS_BUILD_SECRETS_GUIDE.md`.
- Web app served/built with Vite scripts from `apps/web/package.json`.
- Backend run/build scripts in `apps/backend/package.json`.

## Environment Configuration

**Development:**

- Env-var based configuration across backend/mobile/Convex paths.
- Backend minimum vars documented in `apps/backend/.env.example`.
- Mobile references `EXPO_PUBLIC_CONVEX_URL` for Convex connectivity.

**Staging/Production:**

- Detailed environment split is partially documented but not fully codified in checked-in CI files.
- Secrets expected to be managed externally (EAS/host environment), not in repository.

## Webhooks & Callbacks

**Incoming webhooks:**

- No dedicated inbound webhook route modules detected in current Express scaffold.

**Outgoing callbacks/events:**

- Push and AI integrations are outbound HTTP calls from Convex actions.

---

_Integration audit: 2026-04-17_
_Update when external services or credential models change_
