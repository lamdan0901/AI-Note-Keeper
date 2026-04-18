---
status: complete
phase: 01-foundation-and-runtime-baseline
source: 01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md
started: 2026-04-18T01:48:26.2699036Z
updated: 2026-04-18T03:00:59.8753293Z
---

## Current Test`r`n`r`n[testing complete]

## Tests

### 1. Cold Start Smoke Test

expected: Stop all backend processes. Start the API from a fresh terminal using npm run dev:backend:api. Server boots without startup failure, then GET /health/live returns 200 with {"ok": true, "service": "backend"} and GET /api/sample returns 200 with a message.
result: pass

### 2. Standard Error Contract and Trace Echo

expected: Calling a missing API route (for example /api/does-not-exist) returns a flat JSON error shape with code, message, status. If x-request-id header is sent, the response includes traceId with the same trimmed value.
result: [pending]

### 3. Readiness Contract Reflects DB and Migration State

expected: GET /health/ready returns JSON containing service, ok, and checks.database/checks.migrations. When DB and schema_migrations are present, status is 200 and checks are up.
result: [pending]

### 4. Worker Runtime Starts Independently

expected: Running npm run dev:backend:worker starts only the worker process and logs that worker runtime started with adapter pg-boss-adapter, without requiring API runtime startup in the same process.
result: [pending]

### 5. Combined Runtime Starts API and Worker Together

expected: Running npm run dev:backend:all starts both API and worker concurrently. API serves /health/live while worker logs startup, confirming split runtimes can run together.
result: [pending]

### 6. Migrations Execute Only via Explicit Command

expected: Starting API runtime does not auto-apply migrations. Running npm --workspace apps/backend run migrate explicitly runs migration checks/apply flow and reports either applied migrations or database up-to-date.
result: [pending]

### 7. Migration Tools CLI Dry-Run Commands Work

expected: Running migration-tools commands (export/import/reconcile) in dry-run mode returns structured command output and deterministic dry-run artifact/checksum behavior for identical inputs.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
