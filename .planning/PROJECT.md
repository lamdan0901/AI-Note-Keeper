# AI Note Keeper: Convex to Express Migration

## What This Is

This project migrates AI Note Keeper from a Convex-centric backend to an Express plus PostgreSQL backend while preserving behavior parity for web and mobile users. The migration is phase-based and prioritizes correctness, compatibility, and operational safety over feature expansion. Existing client-facing behavior remains stable during cutover, with legacy session and password compatibility preserved.

## Core Value

Migrate backend infrastructure to Express/PostgreSQL with no user-facing regressions in core notes, reminders, subscriptions, and session flows.

## Requirements

### Validated

- ✓ Convex-backed auth, notes, reminders, subscriptions, push, and AI capture flows exist and are currently serving web/mobile clients — existing
- ✓ Shared cross-surface domain utilities exist in packages/shared and are already relied on by runtime logic and tests — existing
- ✓ Mobile offline/local persistence and notification workflows operate today and must be preserved across backend cutover — existing

### Active

- [ ] Build and harden Express/PostgreSQL backend foundation with migration tooling, health probes, and standardized error contracts
- [ ] Reach behavior parity for auth, notes sync, reminders, subscriptions, device tokens, and AI endpoints under HTTP APIs
- [ ] Replace scheduler/crons with durable worker execution using pg-boss and a dedicated worker process
- [ ] Execute deterministic Convex to PostgreSQL data migration with reconciliation and rollback checkpoints
- [ ] Cut over web and mobile clients to Express APIs behind feature flags, then decommission Convex safely

### Out of Scope

- New realtime channel (SSE/WebSocket) during migration window — polling parity is the migration strategy
- Non-parity product feature expansion unrelated to migration goals — scope is infrastructure and behavior parity first
- appwrite-functions changes unless explicitly requested later — excluded from this migration plan

## Context

- Current architecture is a multi-surface app with active Convex backend logic and a partial Express/PostgreSQL migration scaffold in apps/backend.
- Migration source of truth is docs/CONVEX_TO_EXPRESS_MIGRATION.md with explicit phase sequencing, constraints, and cutover gates.
- Existing contract and integration tests define parity expectations for notes, reminders, subscriptions, AI capture, and merge-security behavior.
- The migration approach is brownfield: preserve behavior first, then swap runtime components under stable client contracts.

## Constraints

- **Shared package reuse**: packages/shared remains unchanged and is imported by the new backend — prevents semantic drift in core logic.
- **Auth/session model**: JWT access plus rotating refresh tokens with hashed refresh token storage — improves session security while preserving compatibility.
- **Legacy compatibility**: Existing clients with raw userId must upgrade via POST /auth/upgrade-session — prevents forced re-auth cutover failures.
- **Password migration**: Support legacy salt:sha256 and lazily upgrade to argon2id on login — avoids lockout during transition.
- **Background execution**: Deferred work uses pg-boss and cron runs in a dedicated worker process — required reliability model.
- **Polling contract gate**: Notes sync on focus plus 30-second polling is mandatory before web cutover — explicit go-live gate.
- **Reminder safety guards**: Preserve MAX_LOOKBACK_MS and cron_state.key uniqueness semantics — protects cron correctness and upsert behavior.
- **Notification ledger boundary**: notification_ledger stays mobile-local SQLite only, never PostgreSQL — preserves client-local dedupe design.
- **Migration timing**: Export/import/reconcile tooling starts early, not only at final cutover — reduces late-stage migration risk.

## Key Decisions

| Decision                                                                             | Rationale                                                        | Outcome   |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------- |
| Keep behavior parity as primary migration objective                                  | Reduces user-facing risk and supports controlled cutover         | — Pending |
| Use Express + PostgreSQL layered architecture (routes/services/repositories/jobs/db) | Improves separation of concerns and operational control          | — Pending |
| Use pg-boss for deferred jobs and dedicated worker for cron                          | Durable job processing replaces in-memory or implicit scheduling | — Pending |
| Ship polling parity before web cutover                                               | Ensures stable sync behavior before infrastructure switch        | — Pending |
| Support legacy session and password upgrade paths                                    | Preserves continuity for existing installed clients/users        | — Pending |
| Reuse packages/shared domain logic instead of reimplementation                       | Maintains semantic parity and lowers regression risk             | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via /gsd-transition):

1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via /gsd-complete-milestone):

1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-04-18 after initialization_
