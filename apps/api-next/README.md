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

After Phase 5, the pg-boss worker (`dev:backend:worker`) is **optional** for local development. api-next cron routes and QStash callbacks replace the remaining worker jobs (subscription dispatch, push retry, repair). The legacy Express + worker stack (`dev:backend:all`) remains available until Phase 6 client cutover — unchanged.

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
| Full scheduler E2E | `npm run dev:api-next` + tunnel + `REMINDER_SCHEDULER_PROVIDER=qstash` + QStash envs | **No** | Per-reminder fire, repair cron, subscription dispatch, push retry — all via api-next. See § Staging QStash below. |
| Legacy Express parity | `npm run dev:backend:all` | **Yes** | Express API + worker on port **3000** until Phase 6 cutover. |

### Manual cron triggers (local)

Maintenance cron routes require `CRON_SECRET` (Bearer) or the Vercel cron header. Set `CRON_SECRET` in `apps/api-next/.env.local`, restart api-next, then:

```bash
# Subscription reminder scan + push enqueue
curl -s -X POST http://localhost:3001/cron/subscriptions-dispatch \
  -H "Authorization: Bearer $CRON_SECRET" | jq .

# Reminder repair / drift recovery
curl -s -X POST http://localhost:3001/cron/reminders-repair \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

Without `CRON_SECRET`, simulate a platform cron invocation in dev:

```bash
curl -s -X POST http://localhost:3001/cron/reminders-repair \
  -H "x-vercel-cron: 1" | jq .
```

`GET` is also supported on both cron paths (same auth).

### Env quick reference

| Variable | API-only dev | Full scheduler |
|----------|--------------|----------------|
| `REMINDER_SCHEDULER_PROVIDER` | `disabled` | `qstash` |
| `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | omit | required (public HTTPS; tunnel for local E2E) |
| `QSTASH_TOKEN`, signing keys | omit | required |
| `CRON_SECRET` | omit unless testing cron | required for manual cron triggers (or use `x-vercel-cron: 1` in dev) |

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

**Goal:** api-next + Postgres + QStash + Vercel Cron run for **24 hours** with the worker process stopped (scale to zero). No functional regressions vs the worker-backed staging baseline.

### Prerequisites

- Task 5.16 green: `npm run test:parity:next` (worker contract scenarios without pg-boss)
- Staging Postgres reachable (`DATABASE_URL` shared with `apps/backend`)
- Upstash QStash project with signing keys
- api-next deployed to a **public HTTPS** staging origin (Vercel or equivalent)
- `CRON_SECRET` set in staging env (for manual smoke; Vercel Cron uses `x-vercel-cron: 1`)

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

### 2. Configure Vercel Cron

`apps/api-next/vercel.json` defines platform cron schedules:

| Path | Schedule | Purpose |
|------|----------|---------|
| `/cron/reminders-repair` | `*/15 * * * *` | Drift recovery every 15 minutes |
| `/cron/subscriptions-dispatch` | `0 0 * * *` | Subscription reminder scan at UTC midnight |

Confirm jobs appear in the Vercel project → **Cron Jobs** tab after deploy. Manual trigger (optional):

```bash
curl -s -X POST "$STAGING_BASE/cron/reminders-repair" \
  -H "Authorization: Bearer $CRON_SECRET" | jq .

curl -s -X POST "$STAGING_BASE/cron/subscriptions-dispatch" \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

**Repair cron expect:** JSON summary from `reminderRepairJob.run()` (scanned/repaired counts).

**Subscription dispatch expect:** `SubscriptionReminderDispatchRunResult`:

```json
{
  "cronKey": "check-subscription-reminders",
  "since": "...",
  "now": "...",
  "scanned": 0,
  "enqueued": 0,
  "duplicates": 0
}
```

### 3. Stop the worker

Scale the pg-boss worker process to **zero** (or stop the worker container/service). Keep Express API running if staging clients still use port 3000 — api-next handles maintenance regardless.

Record baseline timestamp and confirm worker is not processing:

- No `[worker]` repair/subscription log lines after stop
- `pgboss` job polling idle (if observable)

### 4. Monitor for 24 hours

| Window | Check | Pass criteria |
|--------|-------|---------------|
| T+0–2h | Create one-time reminder (~5 min fire) | QStash `DELIVERED` → push notification received |
| T+0–2h | Repair cron | Vercel Cron logs or manual POST returns `200` + summary JSON every ≤15 min |
| T+0–24h | Recurring reminder | After fire, `nextTriggerAt` advanced; new QStash message scheduled |
| UTC midnight | Subscription dispatch cron | Cron invocation `200`; `scanned`/`enqueued` sensible; `duplicates` stable on replay |
| T+0–24h | Push retry (induced 429) | Register device token; trigger transient FCM failure; QStash delayed message to `/internal/push/retry` delivers within retry window |

**Log sources**

- Vercel → Functions / Cron execution logs for `/cron/*`
- Upstash QStash console → delivery status for scheduled-task and push/retry callbacks
- api-next function logs → no repeated `Invalid QStash signature` or `Invalid cron authorization`

**Regression vs worker baseline**

- Reminder fires on schedule (not missed beyond repair cron recovery)
- Subscription renewal reminders still enqueue and deliver
- Push retries complete after transient failures (not stuck until process restart)

### 5. Rollback drill (< 15 minutes)

Run once during the 24h window (or immediately after) to prove recovery path:

1. **Pause Vercel Cron** — disable `reminders-repair` and `subscriptions-dispatch` jobs in Vercel dashboard (prevents duplicate maintenance with worker).
2. **Scale worker up** — restart worker service (`npm run dev:backend:worker` locally; redeploy/scale staging worker in prod).
3. **Verify worker health** — worker logs show `[worker] runtime started`; repair interval and subscription dispatch timer active.
4. **Confirm maintenance resumed** — worker repair/subscription log lines within one interval; optional manual repair cron on api-next returns `200` but is no longer the primary path.
5. **Re-enable Vercel Cron** — after rollback drill completes, re-enable crons and scale worker back to zero to continue the 24h test.

**Target:** steps 1–4 complete in under 15 minutes.

If api-next internal routes fail catastrophically (not just cron), keep worker running and leave Vercel Cron disabled until routes are fixed. Per-reminder QStash callbacks still target api-next in `qstash` mode — Express worker does not replace Phase 3 scheduled-task delivery.

### Automated coverage (no staging deploy)

```bash
npm run test:parity:next
npm run test:api-next -- tests/readme-runbook.test.mjs
```

Use this runbook for staging 24h verification; use parity tests for CI gates.