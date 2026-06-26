# API Next Migration — Phase 0 Task Breakdown

Date: 2026-06-26

Parent plan: [2026-06-26-api-next-migration-plan.md](./2026-06-26-api-next-migration-plan.md)

**Phase:** 0 — Scaffold (2–3 days, PR #1)

**Goal:** Stand up `apps/api-next` with health endpoints, HTTP foundation, DB pool hardening, service composition, and auth-transport adapter stubs — ready for Phase 1 auth routes.

**Scope constraint (PR #1):** Touch only `apps/api-next/`, root `package.json` (add `dev:api-next` + `test:api-next` only), and `apps/api-next/.env.example`. No changes to `apps/backend` yet (import via `@backend/*` path alias only). Defer `test:parity:next` to Phase 1+ (see task 0.2).

---

## Summary

| # | Task | Type | Est. | Blocked by |
|---|------|------|------|------------|
| 0.1 | Bootstrap Next.js app | AFK | 2h | — |
| 0.2 | Wire monorepo workspace + root scripts | AFK | 1h | 0.1 |
| 0.3 | Configure TypeScript + `@backend/*` alias | AFK | 2h | 0.1 |
| 0.4 | Configure `next.config.ts` for Node runtime | AFK | 1h | 0.1 |
| 0.5 | Add `.env.example` with canonical env names | AFK | 1h | 0.1 |
| 0.6 | Harden DB pool error handling | AFK | 2h | 0.3 |
| 0.7 | Port service composition from `startApi.ts` | AFK | 3h | 0.3, 0.6 |
| 0.8 | Implement `AppError` → `NextResponse` mapper | AFK | 2h | 0.3 |
| 0.9 | Implement `withApiHandler` request wrapper | AFK | 3h | 0.8 |
| 0.10 | Port CORS middleware from `createApiServer.ts` | AFK | 2h | 0.9 |
| 0.11 | Port dependency gate module | AFK | 1h | 0.8, 0.7 |
| 0.12 | Build auth transport adapter for Next | AFK | 3h | 0.9 |
| 0.13 | Implement `/health/live` and `/health/ready` routes | AFK | 2h | 0.7, 0.9, 0.11 |
| 0.14 | Scaffold test harness (`next-test-server.ts`) | AFK | 3h | 0.13 |
| 0.15 | Phase 0 verification + exit criteria | AFK | 2h | 0.13, 0.14 |

**Total estimate:** ~2–3 days

---

## Phase 0 Exit Criteria (gate)

All of the following must pass before merging PR #1:

- [ ] `npm run dev:api-next` starts on port **3001**; Express continues on **3000**
- [ ] `curl localhost:3001/health/live` returns `{ "ok": true, "service": "backend" }`
- [ ] `curl localhost:3001/health/ready` returns the **exact same JSON shape** as Express (including `checks.database` and `checks.migrations`)
- [ ] Simulated pool idle error does **not** call `process.exit`; readiness returns 503 with `checks` down
- [ ] CORS preflight from `http://localhost:5173` succeeds (OPTIONS + credentials headers)
- [ ] `npm run lint` passes
- [ ] `npm --workspace apps/api-next run typecheck` passes
- [ ] `@backend/*` imports resolve in both `next dev` and typecheck (ESM `.js` extension caveat verified)

---

## Task Details

### 0.1 — Bootstrap Next.js app

**Type:** AFK  
**Blocked by:** None

**What to build**

Create `apps/api-next` using `create-next-app` with:

- App Router
- TypeScript
- ESLint (inherit monorepo config)
- **No** Tailwind
- **Do not** put App Router under `src/app` — keep route tree at root `app/`
- **Do** use root `src/` for support code (`src/server/`, `src/http/`, `src/db/`, etc.) per target layout
- Package name: `@ai-note-keeper/api-next`

**Acceptance criteria**

- [ ] `apps/api-next/package.json` exists with `"name": "@ai-note-keeper/api-next"`
- [ ] `app/` directory present (App Router)
- [ ] Dev server defaults to port **3001** (via `-p 3001` in dev script or `PORT` env)
- [ ] `export const runtime = 'nodejs'` documented as required for all future API routes

**Reference**

- Target layout: parent plan § Target Directory Layout

---

### 0.2 — Wire monorepo workspace + root scripts

**Type:** AFK  
**Blocked by:** 0.1

**What to build**

Register the new app in the monorepo and add root-level dev/test scripts.

**PR #1 root script scope (explicit):** Add exactly these two scripts to root `package.json`:

- `dev:api-next`
- `test:api-next`

Do **not** add `test:parity:next` in PR #1. The parent plan lists it under overall migration root scripts, but parity tests against `:3001` belong in Phase 1+ once auth routes exist. When added later, use Windows-safe env syntax (e.g. `cross-env API_TEST_BASE_URL=http://127.0.0.1:3001 ...`) — not bare POSIX `VAR=value` prefix.

**Files**

- Root `package.json`
- `apps/api-next/package.json` (dev/start/test scripts)

**Changes**

```json
// root package.json (PR #1 — add only these)
{
  "dev:api-next": "npm --workspace apps/api-next run dev",
  "test:api-next": "npm --workspace apps/api-next run test"
}
```

Optionally extend root `dev` to include api-next alongside backend/web/mobile when convenient.

**Acceptance criteria**

- [ ] Root `package.json` contains `dev:api-next` and `test:api-next` only (no `test:parity:next` in PR #1)
- [ ] `npm run dev:api-next` from repo root starts api-next on 3001
- [ ] `npm run test:api-next` from repo root runs api-next unit/contract tests
- [ ] Workspace `apps/*` picks up `apps/api-next` automatically (no manual workspaces entry needed if glob already covers `apps/*`)
- [ ] Express `dev:backend:api` still binds to 3000 without port conflict

---

### 0.3 — Configure TypeScript + `@backend/*` path alias

**Type:** AFK  
**Blocked by:** 0.1

**What to build**

Set up `apps/api-next/tsconfig.json` with path alias to import existing backend domain code without copying it.

```json
{
  "compilerOptions": {
    "paths": {
      "@backend/*": ["../backend/src/*"],
      "@/*": ["./src/*"]
    }
  }
}
```

Add `typecheck` script to `apps/api-next/package.json`.

**Acceptance criteria**

- [ ] `import { evaluateReadiness } from '@backend/health/readiness.js'` typechecks
- [ ] `next dev` starts without module-resolution errors for at least one `@backend/*` import used in a route
- [ ] Document fallback plan if runtime alias friction appears (extract to `packages/backend-core` or relative imports) — see parent plan § ESM + Cross-App Imports

**Risk note**

Backend uses `"type": "module"` with explicit `.js` extensions. Verify early; this is a go/no-go item for Phase 0.

---

### 0.4 — Configure `next.config.ts` for Node runtime

**Type:** AFK  
**Blocked by:** 0.1

**What to build**

```typescript
// next.config.ts
const nextConfig = {
  serverExternalPackages: ['pg', '@node-rs/argon2'],
};
export default nextConfig;
```

Ensure all API route files will use `export const runtime = 'nodejs'` (not Edge).

**Acceptance criteria**

- [ ] `pg` and `@node-rs/argon2` are not bundled into server chunks incorrectly
- [ ] No Edge runtime warnings when health routes are added

---

### 0.5 — Add `.env.example` with canonical env names

**Type:** AFK  
**Blocked by:** 0.1

**What to build**

Copy relevant vars from `apps/backend/.env.example` and add api-next-specific entries.

**Required vars**

| Variable | Notes |
|----------|-------|
| `API_NEXT_PORT` | Default `3001` |
| `DATABASE_URL` | Same Postgres as Express |
| `JWT_*` | Same secrets as backend |
| `REMINDER_SCHEDULER_CALLBACK_BASE_URL` | Canonical name (not `QSTASH_CALLBACK_BASE_URL`) |
| `QSTASH_TOKEN` | For callback testing (optional in pure local dev) |
| `QSTASH_CURRENT_SIGNING_KEY` | Optional until Phase 3 |
| `QSTASH_NEXT_SIGNING_KEY` | Optional until Phase 3 |
| `CORS_ALLOWED_ORIGINS` | Optional override; defaults match Express dev origins |

**Acceptance criteria**

- [ ] `apps/api-next/.env.example` documents all vars with comments
- [ ] Env names match `apps/backend/src/config.ts` and `reminders/runtime.ts` conventions
- [ ] Local dev note: QStash cannot reach localhost without tunnel (pointer to parent plan clarifications)

---

### 0.6 — Harden DB pool error handling

**Type:** AFK  
**Blocked by:** 0.3

**What to build**

`apps/backend/src/db/pool.ts` attaches `process.exit(-1)` to the **first** `pg.Pool` instance at creation time (inside `createPool()`). A wrapper that only re-attaches listeners *after* unrelated code has already queried via `@backend/db/pool` directly will be too late — the fatal handler may already be installed.

Implement `apps/api-next/src/db/pool.ts` that:

1. Re-exports query/connect API from `@backend/db/pool` — **this is the only allowed DB import path in api-next**
2. Exports `initializePoolErrorHandling()` that mirrors `startApi.ts` lines 63–73: `pool.removeAllListeners('error')` then soft `pool.on('error', ...)`
3. Exposes `isDependencyDegraded()` state for readiness + dependency gate
4. Calls `initializePoolErrorHandling()` from `compose-services.ts` during startup, using the same ordering as Express: pool may be created by the initial readiness probe first, then fatal listener is removed before the server accepts traffic

**Do not modify `apps/backend/src/db/pool.ts` in Phase 0** — wrap at the api-next layer.

**Import rule:** No file under `apps/api-next/` may import `@backend/db/pool` directly. All DB access goes through `@/db/pool` (the wrapper).

**Acceptance criteria**

- [ ] `initializePoolErrorHandling()` runs during api-next startup before route handlers serve requests
- [ ] Ordering matches Express: fatal `process.exit` listener from `createPool()` is removed via `removeAllListeners('error')` before idle errors can terminate the process
- [ ] Idle client error sets `dependencyDegraded = true` instead of exiting
- [ ] Error is logged (same message intent as Express: `[backend] database dependency degraded`)
- [ ] All api-next DB consumers import `@/db/pool` only (compose-services, readiness probe, health routes)
- [ ] Unit test: after init, simulated idle `pool` `'error'` event does not call `process.exit`; `isDependencyDegraded()` becomes `true`
- [ ] Next dev server survives simulated pool error (manual or unit test)

**Reference**

- `apps/backend/src/db/pool.ts` (lines 18–21 — current hard exit)
- `apps/backend/src/runtime/startApi.ts` (lines 61–73 — target behavior)
- Parent plan § DB Pool Decision

---

### 0.7 — Port service composition from `startApi.ts`

**Type:** AFK  
**Blocked by:** 0.3, 0.6

**What to build**

Create `apps/api-next/src/server/compose-services.ts` that replicates the wiring in `startApi.ts`:

- `createReminderSchedulerRuntime()`
- `createNotesService({ remindersRepository, schedulerService })` — special injection
- Default services for auth, subscriptions, expenses, device-tokens, merge, AI
- Export typed `ComposedServices` + `isDependencyDegraded()` accessor
- Export `createReadinessProbe()` using `evaluateReadiness` + wrapped pool from `@/db/pool` (not `@backend/db/pool`)
- Call `initializePoolErrorHandling()` during startup (after initial readiness probe, before services are used — mirror `startApi.ts` ordering)

Also create `apps/api-next/src/server/dependency-gate.ts` (or colocate gate logic) sourced from `apps/backend/src/health.ts` `createDependencyGate` behavior.

**Acceptance criteria**

- [ ] `composeServices()` returns the same service graph as `startApi.ts` (reminder runtime + notesService injection)
- [ ] `createReadinessProbe()` delegates to `@backend/health/readiness.js` `evaluateReadiness` and uses `@/db/pool` only
- [ ] `initializePoolErrorHandling()` is invoked during compose/startup before route handlers serve traffic
- [ ] `isDependencyDegraded()` reflects pool error state from 0.6
- [ ] No Express imports in compose module

**Reference**

- `apps/backend/src/runtime/startApi.ts` (lines 75–91)

---

### 0.8 — Implement `AppError` → `NextResponse` mapper

**Type:** AFK  
**Blocked by:** 0.3

**What to build**

Create two files:

**`apps/api-next/src/http/errors.ts`** — maps `@backend/middleware/error-middleware.js` `AppError` to `NextResponse.json(...)` with identical response body shape (`code`, `message`, `status`, `details`, `traceId`). Reuse `AppError` class from backend — do not duplicate error catalog logic.

**`apps/api-next/src/http/validate.ts`** — Next validation adapter mirroring `@backend/middleware/validate.js`:
- `parseOrThrow(schema, value)` converts `ZodError` → `AppError({ code: 'validation', details: { issues } })`
- `validateBody` / `validateParams` / `validateQuery` helpers for route handlers

**Error handling parity (important):** Express `errorMiddleware` does **not** handle raw `ZodError`. Validation failures are converted to `AppError` upstream by `validateRequest` / `parseOrThrow`. Therefore:
- `toErrorResponse` handles `AppError` and maps unknown errors → `AppError({ code: 'internal' })` (same as `toAppError` in `error-middleware.ts`)
- `ZodError` must never reach `toErrorResponse` in normal flow — routes use `validate.ts` first

**Acceptance criteria**

- [ ] `toErrorResponse(error, request)` handles `AppError` and unknown errors same as Express `errorMiddleware` / `toAppError`
- [ ] Raw `ZodError` passed to `toErrorResponse` maps to `internal` (proves validation adapter is the correct layer)
- [ ] `parseOrThrow` throws `AppError({ code: 'validation' })` with `details.issues` matching Express `toValidationIssues` shape
- [ ] Response body shape matches `ErrorResponseBody` from backend
- [ ] Client-correctable codes and rate-limit detail sanitization preserved (import helpers from backend if exported, or replicate minimal mapping)

**Reference**

- `apps/backend/src/middleware/error-middleware.ts` (lines 105–114 — `toAppError`, no Zod branch)
- `apps/backend/src/middleware/validate.ts` (lines 32–44 — `parseOrThrow`)

---

### 0.9 — Implement `withApiHandler` request wrapper

**Type:** AFK  
**Blocked by:** 0.8

**What to build**

Create `apps/api-next/src/http/with-api-handler.ts` — the core adapter replacing Express `withErrorBoundary` + route handlers.

Responsibilities:

1. Parse `NextRequest` → `RequestContext` (body, params, query, headers, client IP, cookies)
2. Optionally run validation via `validate.ts` helpers before handler (Zod → `AppError` — not `toErrorResponse`)
3. Invoke framework-agnostic handler: `(ctx) => result | AppError | Response`
4. Map result → `NextResponse.json(...)` with correct status
5. Catch errors → `toErrorResponse` (expects `AppError` or unknown — not raw `ZodError`)
6. Support optional middleware chain (for future rate limits, auth)

Define `RequestContext` type in `apps/api-next/src/http/types.ts`.

**Acceptance criteria**

- [ ] Handler returning plain object becomes JSON 200
- [ ] Handler throwing `AppError` returns correct status + body
- [ ] `params` from App Router dynamic segments are passed through
- [ ] Cookie header parsed (needed for Phase 1 refresh flow)
- [ ] `trust proxy` / `x-forwarded-proto` available on context for secure cookie logic

---

### 0.10 — Port CORS middleware from `createApiServer.ts`

**Type:** AFK  
**Blocked by:** 0.9

**What to build**

Create `apps/api-next/src/http/cors.ts` porting logic from `createApiServer.ts`:

- `CORS_ALLOWED_ORIGINS` env (comma-separated)
- Default dev origins: `http://localhost:5173`, `http://127.0.0.1:5173`
- Methods: `GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS`
- `Access-Control-Allow-Credentials: true`
- Preflight OPTIONS → 204

Integrate into `withApiHandler` or a `withCors` wrapper applied to route exports.

**Acceptance criteria**

- [ ] Preflight from `http://localhost:5173` returns 204 with correct CORS headers
- [ ] Disallowed origin does not get `Access-Control-Allow-Origin` on non-preflight
- [ ] Production with empty `CORS_ALLOWED_ORIGINS` denies all (matches Express behavior)

**Reference**

- `apps/backend/src/runtime/createApiServer.ts` (lines 66–114, 123–144)

---

### 0.11 — Port dependency gate module

**Type:** AFK  
**Blocked by:** 0.8, 0.7

**What to build**

Create `apps/api-next/src/server/dependency-gate.ts` (if not done in 0.7) that throws `AppError({ code: 'internal' })` when `isDependencyDegraded()` is true.

In Phase 0, wire the gate as an optional flag on `withApiHandler` (e.g. `{ requireHealthyDependencies: true }`) so Phase 1 can enable it on `/api/*` routes without refactoring.

**Acceptance criteria**

- [ ] When pool is degraded, gated handler returns 500 with `internal` error code
- [ ] Health endpoints (`/health/*`) are **not** gated (match Express: health stays online when degraded)
- [ ] Behavior matches `apps/backend/src/tests/health.test.ts` scenario "degraded dependencies keep health endpoints online and fail API routes"

**Reference**

- `apps/backend/src/health.ts` `createDependencyGate`
- `apps/backend/src/tests/health.test.ts` (line 79+)

---

### 0.12 — Build auth transport adapter for Next

**Type:** AFK  
**Blocked by:** 0.9

**What to build**

Express auth cookie helpers in `apps/backend/src/auth/http.ts` use `res.cookie()` and Express `Request`. Phase 1 `refresh` / `logout` routes call `resolveRefreshToken(request, body.refreshToken)` to read `ank_refresh_token` from the `Cookie` header. The Phase 0 adapter must cover **read and write** paths.

Create `apps/api-next/src/http/auth/transport.ts` with Next-compatible equivalents:

**Write path**
- `writeAuthTransport(request, response: NextResponse, tokenPair)` → sets `Set-Cookie` for `ank_refresh_token`
- `clearAuthTransport(request, response: NextResponse)` → clears cookie

**Read path**
- `parseCookies(request: NextRequest)` → `Record<string, string>` (mirror `parseCookies` in backend)
- `resolveRefreshToken(request: NextRequest, explicitToken?: string)` → `string | null` (explicit body token wins; else read `ank_refresh_token` cookie)

**Shared logic** (preserve parity with backend)
- `shouldUseCookieTransport`, `isSecureCookieRequest`, `resolveRefreshCookieSameSite`

Extract shared pure helpers from backend if needed, or duplicate minimally in api-next (no backend file changes in Phase 0).

**Acceptance criteria**

- [ ] Cookie name, path, httpOnly, sameSite, secure flags match Express behavior on write/clear
- [ ] `writeAuthTransport` returns `{ transport: 'cookie' | 'json' }` same as backend
- [ ] `resolveRefreshToken` returns explicit body token when provided (same precedence as Express)
- [ ] `resolveRefreshToken` reads `ank_refresh_token` from `Cookie` header when body token absent
- [ ] Adapter is callable from `withApiHandler` post-handler hook (stub usage OK — full auth routes come in Phase 1)
- [ ] Unit test (write): mock `NextRequest` with `Origin` header → `Set-Cookie` includes `ank_refresh_token`
- [ ] Unit test (read): mock `NextRequest` with `Cookie: ank_refresh_token=abc` → `resolveRefreshToken(req, undefined)` returns `'abc'`

**Reference**

- `apps/backend/src/auth/http.ts` (lines 51–82 read path; lines 84–149 write path)
- `apps/backend/src/auth/routes.ts` (lines 190, 221 — `resolveRefreshToken` usage)
- Parent plan § Post-Review Clarifications — Auth cookie transport

---

### 0.13 — Implement `/health/live` and `/health/ready` routes

**Type:** AFK  
**Blocked by:** 0.7, 0.9, 0.11

**What to build**

| Route | File | Behavior |
|-------|------|----------|
| `GET /health/live` | `app/health/live/route.ts` | Return `createHealthStatus()` from `@backend/health.js` |
| `GET /health/ready` | `app/health/ready/route.ts` | Call `createReadinessProbe()`; status 200 if `ok`, else 503 |

Both routes: `export const runtime = 'nodejs'`.

**Acceptance criteria**

- [ ] `/health/live` body: `{ "ok": true, "service": "backend" }`
- [ ] `/health/ready` body matches `ReadinessStatus` type exactly when DB is healthy
- [ ] `/health/ready` returns 503 when `dependencyDegraded` or DB unreachable
- [ ] Side-by-side `curl` against Express :3000 and Next :3001 produces identical JSON (status code may differ only when intentionally degraded)

**Reference**

- `apps/backend/src/health.ts`
- `apps/backend/src/health/readiness.ts`
- `apps/backend/src/runtime/createApiServer.ts` (lines 153–167)

---

### 0.14 — Scaffold test harness (`next-test-server.ts`)

**Type:** AFK  
**Blocked by:** 0.13

**What to build**

Create `apps/api-next/tests/support/next-test-server.ts` for in-process contract tests.

Preferred approach (per parent plan): use Next's internal request handler (`next()` + `handle`) rather than spawning `next dev` on port 3001.

Minimum for Phase 0:

- Helper to issue `GET /health/live` and `GET /health/ready` against in-process handler
- `package.json` `test` script using `node --test`

**Acceptance criteria**

- [ ] `npm --workspace apps/api-next run test` executes without port conflicts
- [ ] At least one test asserts `/health/live` response shape
- [ ] At least one test asserts `/health/ready` returns 503 when `dependencyDegraded` is mocked
- [ ] Harness is reusable for Phase 1 auth route tests

**Reference**

- `apps/backend/src/tests/support/http-test-server.ts` (pattern to adapt, not copy verbatim)
- Parent plan § Test Harness for api-next

---

### 0.15 — Phase 0 verification + exit criteria

**Type:** AFK  
**Blocked by:** 0.13, 0.14

**What to build**

Final integration check before opening PR #1.

**Checklist**

```bash
# Terminal 1 — Express (unchanged)
npm run dev:backend:api

# Terminal 2 — api-next
npm run dev:api-next

# Health parity
curl -s localhost:3000/health/live | jq .
curl -s localhost:3001/health/live | jq .
curl -s localhost:3000/health/ready | jq .
curl -s localhost:3001/health/ready | jq .

# CORS preflight
curl -s -X OPTIONS localhost:3001/health/live \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" -D -

# Quality gates
npm run lint
npm --workspace apps/api-next run typecheck
npm --workspace apps/api-next run test
```

**Acceptance criteria**

- [ ] All Phase 0 exit criteria (top of this doc) checked off
- [ ] No changes outside allowed scope (no `apps/backend` edits, no client changes)
- [ ] PR description links to this task doc + parent plan

---

## Suggested PR commit order

For a clean reviewable PR, implement in this order:

1. **0.1 → 0.5** — scaffold + config (app boots on 3001)
2. **0.8 → 0.10** — HTTP layer (errors, handler, CORS)
3. **0.6 → 0.7 → 0.11** — pool + services + gate
4. **0.12** — auth transport adapter
5. **0.13 → 0.14 → 0.15** — health routes + tests + verification

---

## Out of scope for Phase 0

Deferred to later phases (do not implement now):

- Auth routes (`/api/auth/*`) — Phase 1
- `GET /api/sample` — Phase 1
- Dependency gate enabled on `/api/*` routes — Phase 1 (module ready in 0.11)
- QStash internal callback + raw body — Phase 3
- Root `test:parity:next` script — Phase 1+ (use `cross-env` for Windows-safe `API_TEST_BASE_URL`)
- Parity test suite against 3001 — Phase 1+
- Extracting domain code to `packages/backend-core` — Phase 7 (unless alias friction forces earlier)
- Deleting stale `apps/backend/src/reminders/qstash-scheduler-provider.ts` — confirm no callers first, any phase

---

## Risk checkpoints (Phase 0 gate)

From parent plan go/no-go table:

| Check | How to verify |
|-------|---------------|
| DB connects | `/health/ready` shows `checks.database: "up"` |
| Health shape exact match | Side-by-side curl vs Express |
| Pool no hard-exit | Simulate idle error; process stays alive |
| Basic CORS | OPTIONS from `localhost:5173` succeeds |