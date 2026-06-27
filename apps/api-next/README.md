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
# or from repo root (after task 0.2):
# npm run dev:api-next
```

Listens on [http://localhost:3001](http://localhost:3001).

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