# @ai-note-keeper/api-next

Next.js App Router backend for ai-note-keeper. Runs alongside the Express API on port **3001** (Express stays on **3000**).

## Layout

- `app/` — App Router route tree (not under `src/app`)
- `src/server/`, `src/http/`, `src/db/` — support code imported via `@/*`

## TypeScript path aliases

| Alias | Maps to |
|-------|---------|
| `@/*` | `./src/*` |
| `@backend/*` | `../backend/src/*` |

Import backend domain code without copying it:

```ts
import { evaluateReadiness } from "@backend/health/readiness.js";
```

Backend uses ESM (`"type": "module"`, `NodeNext`) with explicit `.js` extensions in import specifiers.

| Context | Import style |
|---------|--------------|
| `tsc --noEmit` | `@backend/health/readiness.js` (verified in `src/server/backend-alias-esm-typecheck.ts`) |
| `next dev` / routes | `@backend/health/readiness` (extensionless — webpack `extensionAlias` resolves `.js` specifiers to `.ts`) |

`next.config.ts` sets `turbopack.root` to the monorepo root and `webpack.resolve.extensionAlias` so dev (`next dev --webpack`) and production builds can resolve backend `.js` specifiers to `.ts` sources. Turbopack does not yet support `extensionAlias`; the dev script uses `--webpack` until that gap closes.

Run `npm run typecheck` (or `npm --workspace apps/api-next run typecheck` from repo root) to verify alias resolution.

### ESM + cross-app import fallback

`@backend/*` is resolved by TypeScript and Next.js (Turbopack/webpack) during `next dev` and `next build`. If runtime alias friction appears in `next start` or production bundles:

1. **Preferred:** Extract shared domain code to `packages/backend-core` and depend on it from both `apps/backend` and `apps/api-next`.
2. **Short-term:** Use relative imports from api-next into `../backend/src/...` with explicit `.js` extensions.
3. **Build step:** Compile backend to `dist/` and point api-next imports at published workspace output.

See parent plan § ESM + Cross-App Imports for full context.

## API routes

Every route handler file must declare Node runtime:

```ts
export const runtime = "nodejs";
```

Do not use the Edge runtime; this service depends on Node-only packages (`pg`, `@node-rs/argon2`, etc.).

## Development

```bash
npm run dev
# or from repo root:
# npm run dev:api-next
```

Listens on [http://localhost:3001](http://localhost:3001).

## Worker-less local development (Phase 5+)

After Phase 5, the pg-boss worker (`dev:backend:worker`) is **optional** for local CRUD and per-reminder QStash flows. QStash callbacks on api-next handle reminder fires and push retry. Batch maintenance (repair + subscription dispatch) still uses the **Express worker** unless you trigger `/cron/*` manually — no platform cron is configured on api-next. The legacy Express + worker stack (`dev:backend:all`) remains available until Phase 6 client cutover.

See also: [migration plan § Worker-less local dev](../../docs/2026-06-26-api-next-migration-plan.md#worker-less-local-development-phase-5) and task 5.1 audit matrix in [phase-5-tasks](../../docs/2026-06-26-api-next-migration-phase-5-tasks.md#task-51-audit--worker-coverage--worker-less-dev-matrix).

### Quick start — web + api-next (no worker)

From repo root:

```bash
npm run dev:api-next:full
```

This runs api-next (port **3001**) and the Vite web app concurrently — **without** `dev:backend:worker` or Express.

Point the web client at api-next in `apps/web/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:3001
VITE_AUTH_API_BASE_URL=http://localhost:3001
```

Copy `apps/api-next/.env.example` → `apps/api-next/.env.local` and align Postgres/JWT vars with `apps/backend`.

### Dev modes

| Mode | Commands | Worker needed? | Notes |
|------|----------|----------------|-------|
| API + auth only | `npm run dev:api-next` with `REMINDER_SCHEDULER_PROVIDER=disabled` | **No** | Default in `.env.example`. CRUD, auth, merge work; internal + cron routes return **404** (expected). |
| Web + api-next | `npm run dev:api-next:full` | **No** | Same scheduler behavior as api-only; web talks to port 3001. |
| Full scheduler E2E | `npm run dev:api-next` + tunnel + `REMINDER_SCHEDULER_PROVIDER=qstash` + QStash envs | **No** for per-reminder fires | Per-reminder fire + push retry via QStash on api-next. Maintenance sweeps need worker or manual `/cron/*`. See § Staging QStash below. |
| Legacy Express parity | `npm run dev:backend:all` | **Yes** | Express API + worker on port **3000** until Phase 6 cutover. |

### Manual maintenance triggers (local)

Maintenance routes (`/cron/*`) require `Authorization: Bearer ${CRON_SECRET}`. No platform cron is configured — use the Express worker for automatic repair/subscription dispatch, or trigger manually. Set `CRON_SECRET` in `apps/api-next/.env.local`, restart api-next, then:

```bash
# Subscription reminder scan + push enqueue
curl -s -X POST http://localhost:3001/cron/subscriptions-dispatch \
  -H "Authorization: Bearer $CRON_SECRET" | jq .

# Reminder repair / drift recovery
curl -s -X POST http://localhost:3001/cron/reminders-repair \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

`GET` is also supported on both paths (same auth).

### Env quick reference

| Variable | API-only dev | Full scheduler |
|----------|--------------|----------------|
| `REMINDER_SCHEDULER_PROVIDER` | `disabled` | `qstash` |
| `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | omit | required (public HTTPS; tunnel for local E2E) |
| `QSTASH_TOKEN`, signing keys | omit | required |
| `CRON_SECRET` | omit unless testing maintenance routes | required for manual `/cron/*` triggers |

## Staging QStash end-to-end verification

Use this runbook to confirm the Phase 3 reminders pipeline: create → QStash schedule → signed callback → executor → next occurrence (recurring) or completion (one-time). Copy the checklist into PR #5 when merging Phase 3.

**Prerequisites**

- Postgres reachable with the same `DATABASE_URL` as `apps/backend`
- Upstash QStash project with signing keys
- api-next exposed on a **public HTTPS** origin (deployed staging host, or local tunnel — QStash cannot POST to `localhost`)

### 1. Configure environment

Copy `apps/api-next/.env.example` to `.env.local` and set:

| Variable | Value |
|----------|-------|
| `REMINDER_SCHEDULER_PROVIDER` | `qstash` |
| `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | Public HTTPS base of api-next (no trailing path) |
| `QSTASH_TOKEN` | Upstash QStash token |
| `QSTASH_CURRENT_SIGNING_KEY` | Current signing key from Upstash console |
| `QSTASH_NEXT_SIGNING_KEY` | Next signing key from Upstash console |

Runtime builds the callback URL as:

```text
{REMINDER_SCHEDULER_CALLBACK_BASE_URL}/internal/reminders/scheduled-task
```

With `REMINDER_SCHEDULER_PROVIDER=disabled` (local default), that internal route returns **404** — expected for CRUD-only dev.

### 2. Expose api-next (local staging-like flow)

```bash
# Terminal 1 — api-next with qstash provider
npm run dev:api-next

# Terminal 2 — tunnel (pick one)
ngrok http 3001
# cloudflared tunnel --url http://localhost:3001
```

Set `REMINDER_SCHEDULER_CALLBACK_BASE_URL` to the tunnel HTTPS origin (e.g. `https://abc123.ngrok-free.app`), restart api-next, and confirm:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$REMINDER_SCHEDULER_CALLBACK_BASE_URL/internal/reminders/scheduled-task"
# Expect 401 (route mounted, signature missing) — not 404
```

### 3. Obtain a bearer token

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -H "x-client-platform: web" \
  -H "Origin: http://localhost:5173" \
  -d '{"username":"alice","password":"password-123"}' | jq -r .accessToken
```

Export as `ACCESS_TOKEN` for the steps below.

### 4. Create a one-time reminder (near-future fire)

```bash
TRIGGER_MS=$(($(date +%s) * 1000 + 120000))  # ~2 minutes from now

curl -s -X POST http://localhost:3001/api/reminders \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"e2e-smoke-once\",\"title\":\"QStash smoke\",\"triggerAt\":$TRIGGER_MS,\"active\":true,\"timezone\":\"UTC\"}" | jq .
```

**Expect:** `200` with `{ "reminder": { ... } }`. Scheduler metadata (`scheduleProvider`, `scheduleTargetId`, etc.) is stripped from the response.

### 5. Confirm QStash received the schedule

In the [Upstash QStash console](https://console.upstash.com/qstash), verify a new message targeting:

```text
{REMINDER_SCHEDULER_CALLBACK_BASE_URL}/internal/reminders/scheduled-task
```

Delivery should be scheduled for roughly the `triggerAt` you set.

### 6. Confirm callback execution

After the scheduled time:

1. **Upstash:** delivery status `DELIVERED` (HTTP 200 from api-next).
2. **api-next logs:** no `Invalid QStash signature` / auth errors on the internal route.
3. **Reminder state** — re-fetch:

```bash
curl -s http://localhost:3001/api/reminders/e2e-smoke-once \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

**One-time reminder expect:** `nextTriggerAt` is `null` (no successor). `lastFiredAt` updated.

### 7. Recurring reminder — successor scheduled

```bash
TRIGGER_MS=$(($(date +%s) * 1000 + 120000))

curl -s -X POST http://localhost:3001/api/reminders \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"e2e-smoke-daily\",\"title\":\"QStash recurring\",\"triggerAt\":$TRIGGER_MS,\"active\":true,\"timezone\":\"UTC\",\"repeat\":{\"kind\":\"daily\",\"interval\":1},\"startAt\":$TRIGGER_MS}" | jq .
```

After the first fire:

- `GET /api/reminders/e2e-smoke-daily` shows `nextTriggerAt` advanced to the next daily occurrence.
- Upstash shows a **new** scheduled message for the successor (see integration test `schedule:reminder-1:1` pattern in `tests/reminders-scheduler-integration.test.ts`).

### 8. Negative checks (optional)

| Check | Command / action | Expect |
|-------|------------------|--------|
| Internal route hidden when disabled | `REMINDER_SCHEDULER_PROVIDER=disabled`, POST internal path | `404` |
| Missing signature | POST internal path without `Upstash-Signature` | `401` `Invalid QStash signature` |
| Idempotent replay | Same QStash payload delivered twice | Second response `{ "status": "duplicate" }` or `{ "status": "stale" }` |

### Automated coverage (no tunnel)

These tests mock QStash and do not require a public callback URL:

```bash
npm run test:api-next -- tests/internal-routes.test.ts tests/reminders-scheduler-integration.test.ts
```

Use this runbook for staging/tunnel E2E; use the tests above for CI and local iteration.

## Staging verification: 24h without worker (Phase 5)

Use this runbook before Phase 6 cutover to confirm api-next maintenance paths replace the pg-boss worker. Copy the monitoring checklist into PR #8 when completing task 5.18.

**Goal:** api-next + Postgres + QStash run for **24 hours** with per-reminder delivery verified. Maintenance (repair + subscription dispatch) is handled by the **Express worker** unless you trigger `/cron/*` manually — no platform cron is configured on api-next.

### Prerequisites

- Task 5.16 green: `npm run test:parity:next` (worker contract scenarios without pg-boss)
- Staging Postgres reachable (`DATABASE_URL` shared with `apps/backend`)
- Upstash QStash project with signing keys
- api-next deployed to a **public HTTPS** staging origin (Vercel or equivalent)
- `CRON_SECRET` set in staging env (optional — for manual `/cron/*` smoke only)

### 1. Deploy api-next to staging

Set staging environment variables (Vercel project → Settings → Environment Variables):

| Variable | Value |
|----------|-------|
| `REMINDER_SCHEDULER_PROVIDER` | `qstash` |
| `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | Public HTTPS base of api-next (no trailing path) |
| `QSTASH_TOKEN` | Upstash QStash token |
| `QSTASH_CURRENT_SIGNING_KEY` | Current signing key |
| `QSTASH_NEXT_SIGNING_KEY` | Next signing key |
| `CRON_SECRET` | Strong random secret (manual cron smoke) |
| `DATABASE_URL` | Staging Postgres connection string |
| JWT / auth vars | Same as `apps/backend` staging |

Callback URLs built at runtime:

```text
{REMINDER_SCHEDULER_CALLBACK_BASE_URL}/internal/reminders/scheduled-task
{REMINDER_SCHEDULER_CALLBACK_BASE_URL}/internal/push/retry
```

Deploy from monorepo with **Root Directory** = `apps/api-next` (or equivalent build config).

Post-deploy smoke:

```bash
STAGING_BASE="https://your-api-next-staging.example.com"

# Routes mounted (401 = signature missing, not 404)
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$STAGING_BASE/internal/reminders/scheduled-task"
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$STAGING_BASE/internal/push/retry"

# Cron auth wired (401 without secret)
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$STAGING_BASE/cron/reminders-repair"
```

### 2. Maintenance routes (optional manual smoke)

`/cron/reminders-repair` and `/cron/subscriptions-dispatch` remain available for manual invocation with `CRON_SECRET`. Automatic maintenance uses the **Express worker** (same as pre-migration).

```bash
curl -s -X POST "$STAGING_BASE/cron/reminders-repair" \
  -H "Authorization: Bearer $CRON_SECRET" | jq .

curl -s -X POST "$STAGING_BASE/cron/subscriptions-dispatch" \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

**Repair expect:** JSON summary from `reminderRepairJob.run()` (`candidates`, `executed`, `scheduled`).

**Subscription dispatch expect:** `SubscriptionReminderDispatchRunResult` (`cronKey`: `check-subscription-reminders`) with `scanned` / `enqueued` / `duplicates`.

### 3. Worker for maintenance

Keep the pg-boss **worker** running for repair (~15 min) and subscription dispatch (daily UTC midnight). api-next handles per-reminder QStash callbacks and push retry; the worker handles batch maintenance sweeps.

Confirm worker is processing:

- `[worker] reminder repair completed` log lines within repair interval
- `[worker] subscription reminder dispatch completed` after UTC midnight

### 4. Monitor for 24 hours

| Window | Check | Pass criteria |
|--------|-------|---------------|
| T+0–2h | Create one-time reminder (~5 min fire) | QStash `DELIVERED` → push notification received |
| T+0–2h | Repair job | Worker repair log lines within ≤15 min (or manual POST to `/cron/reminders-repair` returns `200`) |
| T+0–24h | Recurring reminder | After fire, `nextTriggerAt` advanced; new QStash message scheduled |
| UTC midnight | Subscription dispatch | Worker dispatch log lines; `scanned`/`enqueued` sensible |
| T+0–24h | Push retry (induced 429) | Register device token; trigger transient FCM failure; QStash delayed message to `/internal/push/retry` delivers within retry window |

**Log sources**

- Worker logs → repair and subscription dispatch cycles
- Upstash QStash console → delivery status for scheduled-task and push/retry callbacks
- api-next function logs → no repeated `Invalid QStash signature` or `Invalid cron authorization`

**Regression vs worker baseline**

- Reminder fires on schedule (not missed beyond repair cron recovery)
- Subscription renewal reminders still enqueue and deliver
- Push retries complete after transient failures (not stuck until process restart)

### 5. Rollback drill (< 15 minutes)

If api-next QStash callbacks fail, point `REMINDER_SCHEDULER_CALLBACK_BASE_URL` back at Express and keep the worker running until api-next routes are fixed. Per-reminder delivery uses QStash callbacks — the worker does not replace `/internal/reminders/scheduled-task` delivery in `qstash` mode.

### Automated coverage (no staging deploy)

```bash
npm run test:parity:next
npm run test:api-next -- tests/readme-runbook.test.mjs
```

Use this runbook for staging 24h verification; use parity tests for CI gates.

## Cutover readiness (Phase 6)

Before shifting client traffic from Express (`:3000`) to api-next, complete the **cutover readiness checklist** in [Phase 6 tasks § 6.1](../../docs/2026-06-26-api-next-migration-phase-6-tasks.md#cutover-readiness-checklist-task-61).

**Prerequisite gates (must pass before production deploy — task 6.3):**

| Gate | Command / action |
|------|------------------|
| Parity suite | `npm run test:parity:next` |
| api-next tests | `npm run test:api-next` |
| 24h staging without worker | § Staging verification: 24h without worker (task 5.18) |
| Staging HTTPS smoke | Health 200; `POST /internal/*` and `POST /cron/*` return **401** (not 404) |

---

## Client cutover (Phase 6)

Shifts web and mobile traffic from Express to api-next via cohort rollout (`shadow → pilot → ramp → full`). **No client source changes** — only deployment env vars on Vercel (web), EAS / Expo (mobile), and Vercel (api-next).

The cutover gate functions in `apps/web/src/config/cutover.ts` and `apps/mobile/src/config/cutover.ts` (`evaluateCutoverGate`, `evaluateWebCohortTransition`, `evaluateMobileCohortTransition`) provide **objective evidence** for manual go/no-go decisions. They are not runtime traffic routers. Actual traffic is driven solely by the `*BASE_URL` env vars below.

### Relative API paths (unchanged at cutover)

Web and mobile service modules call **relative** `/api/*` paths (e.g. `/api/notes`, `/api/auth/login`). The HTTP client prepends the configured host from `VITE_API_BASE_URL` / `EXPO_PUBLIC_API_BASE_URL` (data) or `VITE_AUTH_API_BASE_URL` / `EXPO_PUBLIC_AUTH_API_URL` (auth). **Only the host env vars change at cutover** — path strings in source stay the same.

### Cohort → traffic mapping

| Cohort | Web / mobile traffic | api-next role | Express API |
|--------|----------------------|---------------|-------------|
| `shadow` | Prod → Express | Parity tests + shadow monitoring only | Running |
| `pilot` | Staging → api-next; prod → Express | Serves staging clients | Running (prod) |
| `ramp` | Prod → api-next | Primary backend | Running (rollback standby) |
| `full` | Prod → api-next | Sole HTTP API | **Stopped** |

### Deployment surfaces

| Surface | Platform | Env configuration |
|---------|----------|-------------------|
| Web client | Vercel project (`apps/web`) | Settings → Environment Variables (per Preview / Production) |
| Mobile client | EAS / Expo (`apps/mobile`) | `eas.json` build profiles + EAS Secrets; `preview` / `production` channels |
| api-next | Vercel project (`apps/api-next`) | Settings → Environment Variables; Root Directory = `apps/api-next` |
| QStash callbacks | Upstash console + api-next env | `REMINDER_SCHEDULER_CALLBACK_BASE_URL` on api-next (canonical name — not `QSTASH_CALLBACK_BASE_URL`) |
| Maintenance sweeps | Express worker | Repair + subscription dispatch (no platform cron on api-next) |

### URL placeholders

Replace `.example.com` hosts with your real staging and production origins before cutover.

| Role | Staging placeholder | Production placeholder |
|------|---------------------|------------------------|
| api-next (public HTTPS) | `https://api-next-staging.example.com` | `https://api-next.example.com` |
| Express API (rollback) | `https://express-api-staging.example.com` | `https://express-api.example.com` |
| Web origin (CORS) | `https://web-staging.example.com` | `https://web.example.com` |

Callback URLs built at runtime on api-next:

```text
{REMINDER_SCHEDULER_CALLBACK_BASE_URL}/internal/reminders/scheduled-task
{REMINDER_SCHEDULER_CALLBACK_BASE_URL}/internal/push/retry
```

### Environment matrix by cohort

#### `shadow` — production clients on Express

Production web and mobile keep Express hosts. api-next is deployed (task 6.3) for parity CI and monitoring only.

| Surface | Variable | Value |
|---------|----------|-------|
| Web data API | `VITE_API_BASE_URL` | `https://express-api.example.com` |
| Web auth API | `VITE_AUTH_API_BASE_URL` | `https://express-api.example.com` |
| Web cohort | `VITE_CUTOVER_COHORT` | `shadow` |
| Mobile data API | `EXPO_PUBLIC_API_BASE_URL` | `https://express-api.example.com` |
| Mobile auth API | `EXPO_PUBLIC_AUTH_API_URL` | `https://express-api.example.com` |
| Mobile cohort | `EXPO_PUBLIC_CUTOVER_COHORT` | `shadow` |
| api-next callbacks | `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | `https://api-next.example.com` (production public base) |
| QStash | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Production keys |
| Cron auth | `CRON_SECRET` | Production secret |
| CORS | `CORS_ALLOWED_ORIGINS` | `https://web.example.com` |

#### `pilot` — staging clients on api-next

Staging web + mobile point at api-next; **production** client env stays on Express (shadow values above).

| Surface | Variable | Staging (pilot) |
|---------|----------|-----------------|
| Web data API | `VITE_API_BASE_URL` | `https://api-next-staging.example.com` |
| Web auth API | `VITE_AUTH_API_BASE_URL` | `https://api-next-staging.example.com` |
| Web cohort | `VITE_CUTOVER_COHORT` | `pilot` |
| Web gates | `VITE_CUTOVER_REQUIRE_PARITY`, `VITE_CUTOVER_REQUIRE_SLO`, `VITE_CUTOVER_REQUIRE_ROLLBACK_DRILL` | `true` |
| Mobile data API | `EXPO_PUBLIC_API_BASE_URL` | `https://api-next-staging.example.com` |
| Mobile auth API | `EXPO_PUBLIC_AUTH_API_URL` | `https://api-next-staging.example.com` |
| Mobile cohort | `EXPO_PUBLIC_CUTOVER_COHORT` | `pilot` |
| Mobile gates | `EXPO_PUBLIC_CUTOVER_REQUIRE_PARITY`, `EXPO_PUBLIC_CUTOVER_REQUIRE_SLO`, `EXPO_PUBLIC_CUTOVER_REQUIRE_ROLLBACK_DRILL` | `true` |
| api-next callbacks | `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | `https://api-next-staging.example.com` |
| QStash | `QSTASH_TOKEN`, signing keys | Staging project or shared |
| Cron auth | `CRON_SECRET` | Staging secret |
| CORS | `CORS_ALLOWED_ORIGINS` | `https://web-staging.example.com` |

**Auth vs data base URLs:** `VITE_AUTH_API_BASE_URL` and `EXPO_PUBLIC_AUTH_API_URL` are separate env vars from the data base URL. At cutover they typically match the api-next host, but keep both set explicitly — web auth (`apps/web/src/auth/httpClient.ts`) and mobile transport (`apps/mobile/src/api/httpClient.ts`) read the auth-specific names.

#### `ramp` — production clients on api-next

| Surface | Variable | Production (ramp) |
|---------|----------|-------------------|
| Web data API | `VITE_API_BASE_URL` | `https://api-next.example.com` |
| Web auth API | `VITE_AUTH_API_BASE_URL` | `https://api-next.example.com` |
| Web cohort | `VITE_CUTOVER_COHORT` | `ramp` |
| Mobile data API | `EXPO_PUBLIC_API_BASE_URL` | `https://api-next.example.com` |
| Mobile auth API | `EXPO_PUBLIC_AUTH_API_URL` | `https://api-next.example.com` |
| Mobile cohort | `EXPO_PUBLIC_CUTOVER_COHORT` | `ramp` |
| api-next callbacks | `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | `https://api-next.example.com` |
| QStash | `QSTASH_TOKEN`, signing keys | Production keys |
| Cron auth | `CRON_SECRET` | Production secret |
| CORS | `CORS_ALLOWED_ORIGINS` | `https://web.example.com` |

Express API remains deployable for rollback during `ramp`. Observe stability for **7 calendar days** (`REQUIRED_STABILITY_DAYS` in `apps/backend/src/decommission/contracts.ts`) before advancing to `full`.

#### `full` — Express API stopped

Same production env as `ramp` for client and api-next URLs; set `VITE_CUTOVER_COHORT` / `EXPO_PUBLIC_CUTOVER_COHORT` to `full`. Stop the Express API process in production (task 6.15); keep migration CLI scripts in `apps/backend`.

### Rollback env snapshot

Before any cohort advance, record the **current** Express URLs in a secure ops doc or password manager. Use these values to revert client traffic in under 15 minutes (task 6.10).

| Surface | Variable | Snapshot (fill before cutover) |
|---------|----------|--------------------------------|
| Web data API | `VITE_API_BASE_URL` | _Express production URL_ |
| Web auth API | `VITE_AUTH_API_BASE_URL` | _Express production URL_ |
| Mobile data API | `EXPO_PUBLIC_API_BASE_URL` | _Express production URL_ |
| Mobile auth API | `EXPO_PUBLIC_AUTH_API_URL` | _Express production URL_ |

**Client rollback drill (staging or ramp):**

1. Record start time.
2. Revert web env `VITE_API_BASE_URL` + `VITE_AUTH_API_BASE_URL` to Express snapshot.
3. Revert mobile env `EXPO_PUBLIC_API_BASE_URL` + `EXPO_PUBLIC_AUTH_API_URL` to Express snapshot.
4. Redeploy / reload clients.
5. Verify: session refresh or re-login succeeds; notes list loads.
6. Record elapsed time (target **< 15 minutes**).

Distinct from the Phase 5 **worker** rollback drill (maintenance path). This drill validates **client URL** recovery only.

### Local dev CORS defaults (unchanged)

`http://localhost:5173`, `http://127.0.0.1:5173` from `createApiServer.ts` defaults when `CORS_ALLOWED_ORIGINS` is unset in development.

### Related docs

- [Phase 6 tasks](../../docs/2026-06-26-api-next-migration-phase-6-tasks.md) — operational task breakdown
- [Migration plan](../../docs/2026-06-26-api-next-migration-plan.md) — parent architecture