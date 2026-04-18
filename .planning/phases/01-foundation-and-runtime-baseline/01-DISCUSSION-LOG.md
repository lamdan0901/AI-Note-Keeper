# Phase 1: Foundation and Runtime Baseline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 01-foundation-and-runtime-baseline
**Areas discussed:** Error contract shape, Readiness and startup gates, HTTP and worker split model, Migration tooling depth

---

## Error Contract Shape

### Base response shape

| Option                     | Description                                                                                                                          | Selected |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Flat error object          | `{ code, message, status, details?, traceId? }` for non-2xx only; matches current middleware output and is fastest to keep parity    | ✓        |
| Envelope for all responses | `{ success, data, error }` across both success and failure responses; more uniform long-term but requires wider endpoint changes now |          |
| Hybrid transition          | Keep flat errors now, add optional envelope later via versioned contract                                                             |          |
| Agent decides              | Capture intent and let planning pick exact schema details                                                                            |          |

**User's choice:** Flat error object

### Trace ID behavior

| Option                              | Description                                                                                                         | Selected |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| Include traceId when provided       | Echo x-request-id when present, otherwise omit; aligns with existing middleware behavior and avoids fabricating IDs | ✓        |
| Always generate and include traceId | Backend generates one for every request to maximize observability; adds middleware work now                         |          |
| Do not expose traceId to clients    | Keep trace IDs internal only, return code/message/status/details externally                                         |          |
| Agent decides                       | Leave this to implementation details during planning                                                                |          |

**User's choice:** Include traceId when provided

### Details payload policy

| Option                   | Description                                                                                            | Selected |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | -------- |
| Safe structured details  | Include machine-readable field-level details for known client errors, but never internals/stack traces | ✓        |
| Minimal only             | Return only code/message/status, no details payloads                                                   |          |
| Verbose in non-prod only | Detailed payloads in dev/staging, minimal in production                                                |          |
| Agent decides            | Decide exact detail policy later in planning                                                           |          |

**User's choice:** Safe structured details

### Rate limit payload metadata

| Option                  | Description                                                                           | Selected |
| ----------------------- | ------------------------------------------------------------------------------------- | -------- |
| Yes include retry hints | Add retryAfterSeconds and/or resetAt when available so clients can back off correctly | ✓        |
| No payload hints        | Only status/code/message; clients infer from headers or generic retry logic           |          |
| Headers only            | Expose rate limit metadata only via headers, keep body unchanged                      |          |
| Agent decides           | Leave this as implementation-level detail                                             |          |

**User's choice:** Yes include retry hints

---

## Readiness and Startup Gates

### Readiness criteria

| Option                                       | Description                                                            | Selected |
| -------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| DB connectivity plus schema_migrations check | Ready only when DB reachable and migration tracking table is queryable | ✓        |
| DB connectivity only                         | Simpler and faster; skips migration-state verification                 |          |
| App process only                             | Same as liveness; no dependency checks                                 |          |
| Agent decides                                | Let planning decide exact readiness probes                             |          |

**User's choice:** DB connectivity plus schema_migrations check

### Startup failure policy

| Option                            | Description                                                                          | Selected |
| --------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Invalid config and DB unavailable | Fail fast when env is invalid or initial DB check fails; avoid serving partial state | ✓        |
| Invalid config only               | Allow server boot even if DB is down; readiness remains false until recovered        |          |
| Never hard-stop after boot        | Always run and report unhealthy through probes only                                  |          |
| Agent decides                     | Leave startup strictness to planner                                                  |          |

**User's choice:** Invalid config and DB unavailable

### Migration execution mode

| Option                            | Description                                                                 | Selected |
| --------------------------------- | --------------------------------------------------------------------------- | -------- |
| Separate explicit migrate command | Keep migrations out of server boot; run via dedicated command/pipeline gate | ✓        |
| Auto-run on server startup        | Server attempts migrations before listening                                 |          |
| Hybrid by environment             | Auto-run in dev, explicit in staging/prod                                   |          |
| Agent decides                     | Planner chooses migration execution mode                                    |          |

**User's choice:** Separate explicit migrate command

### Degraded dependency behavior

| Option                                                                    | Description                                                       | Selected |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| Serve only health endpoints, fail API requests with stable internal error | Keeps observability alive and prevents partial incorrect behavior | ✓        |
| Keep serving all requests with best effort                                | Try to process requests despite dependency issues                 |          |
| Terminate process and rely on orchestrator restart                        | Crash on critical dependency loss for quick replacement           |          |
| Agent decides                                                             | Leave outage policy as implementation detail                      |          |

**User's choice:** Serve only health endpoints, fail API requests with stable internal error

---

## HTTP and Worker Split Model

### Runtime boundary

| Option                                  | Description                                                            | Selected |
| --------------------------------------- | ---------------------------------------------------------------------- | -------- |
| Two entrypoints in same backend package | Keep one codebase with separate start commands (api and worker)        | ✓        |
| Separate backend-worker package now     | Hard isolation early, but adds packaging and CI complexity immediately |          |
| Single process until later phase        | Defer split and keep one runtime temporarily                           |          |
| Agent decides                           | Let planner choose boundary strategy                                   |          |

**User's choice:** Two entrypoints in same backend package

### Shared infra scope

| Option                                                                          | Description                                                       | Selected |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| Share config, db pool factory, error utilities; keep runtime bootstrap separate | Avoid duplication while preserving process-specific startup logic | ✓        |
| Share almost everything including bootstrap                                     | Max reuse but risks coupling process concerns                     |          |
| Minimal sharing                                                                 | Duplicate bootstrap and infra wiring to maximize independence     |          |
| Agent decides                                                                   | Defer exact sharing boundaries to planning                        |          |

**User's choice:** Share config, db pool factory, error utilities; keep runtime bootstrap separate

### Queue foundation depth

| Option                                                  | Description                                                                       | Selected |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| Define pg-boss adapter interface + worker boot scaffold | Honors worker split requirement and early tooling without full job implementation | ✓        |
| Implement full queue processing now                     | More complete, but likely scope creep into later hardening phase                  |          |
| No queue code yet                                       | Defer all worker infra to later phases                                            |          |
| Agent decides                                           | Planner chooses queue scaffolding depth                                           |          |

**User's choice:** Define pg-boss adapter interface + worker boot scaffold

### Dev run model

| Option                                     | Description                                                                      | Selected |
| ------------------------------------------ | -------------------------------------------------------------------------------- | -------- |
| Independent command, optional parallel run | Run api and worker separately, with convenience script to start both when needed | ✓        |
| Always bundled into API dev command        | Single command simplicity, weaker boundary testing                               |          |
| Worker disabled in dev until later         | Focus only on API foundation now                                                 |          |
| Agent decides                              | Leave dev orchestration choice to planner                                        |          |

**User's choice:** Independent command, optional parallel run

---

## Migration Tooling Depth

### Tooling scope in Phase 1

| Option                                                      | Description                                                                    | Selected |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| CLI skeleton commands with typed options and no-op adapters | Establish contracts now and enable rehearsal design without full data movement | ✓        |
| Partially working export/import against sample entities     | More functional but higher scope in foundation phase                           |          |
| Design docs only, no code                                   | Lowest effort, weaker early rehearsal signal                                   |          |
| Agent decides                                               | Planner decides scaffolding depth                                              |          |

**User's choice:** CLI skeleton commands with typed options and no-op adapters

### Dry-run output contract

| Option                                                           | Description                                             | Selected |
| ---------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| Deterministic summary report plus machine-readable JSON artifact | Supports CI checks and repeatable rehearsal comparisons | ✓        |
| Console logs only                                                | Simple but hard to diff/verify over time                |          |
| JSON artifact only                                               | Automation-friendly, less human-readable by default     |          |
| Agent decides                                                    | Leave output format to implementation                   |          |

**User's choice:** Deterministic summary report plus machine-readable JSON artifact

### Checkpoint and resume depth

| Option                                                                   | Description                                                        | Selected |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| Define checkpoint schema and resume validation, no production import yet | Lock deterministic resume rules early without full migration logic | ✓        |
| Basic resume flag placeholder only                                       | Minimal placeholder, details deferred                              |          |
| Implement full checkpoint persistence now                                | Comprehensive but likely exceeds phase scope                       |          |
| Agent decides                                                            | Planner picks checkpoint depth                                     |          |

**User's choice:** Define checkpoint schema and resume validation, no production import yet

### Reconciliation contract

| Option                                                                                              | Description                                                      | Selected |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| Report contract with counts/checksums/sampling placeholders and explicit pass-fail threshold fields | Matches roadmap gates while deferring full reconciliation engine | ✓        |
| Counts only                                                                                         | Simpler but misses checksum/drift readiness                      |          |
| No reconciliation contract yet                                                                      | Delay all reconcile semantics to Phase 6                         |          |
| Agent decides                                                                                       | Leave reconcile contract to future planning                      |          |

**User's choice:** Report contract with counts/checksums/sampling placeholders and explicit pass-fail threshold fields

---

## the agent's Discretion

- Artifact naming details, schema versioning, and exact JSON layout for migration dry-run reports.
- Internal module arrangement for worker adapter/scaffold while preserving selected runtime boundaries.
- Low-level readiness probe implementation details (timeouts, query shape) that preserve selected semantics.

## Deferred Ideas

None.
