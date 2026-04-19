# Phase 5: Worker, Push, Merge, and Throttle Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves alternatives considered.

**Date:** 2026-04-19
**Phase:** 05-worker-push-merge-and-throttle-hardening
**Areas discussed:** Worker job topology and watermark flow, Push retry and token hygiene semantics, Merge preflight/apply strategy contracts, Throttle + lock behavior under concurrency

---

## Worker job topology and watermark flow

| Option | Description | Selected |
|--------|-------------|----------|
| Scanner + queued fan-out jobs | Scanner finds due reminders and enqueues per-reminder jobs | ✓ |
| Single monolithic cron handler | Scan + send inline in one handler | |
| Scanner + transactional outbox relay | Outbox table + relay worker | |

| Option | Description | Selected |
|--------|-------------|----------|
| Advance after enqueue batch commit | Protects against crash-induced reminder gaps | ✓ |
| Advance at scan start | Can skip due reminders on crash | |
| Advance after all push success | Can stall watermark too aggressively | |

| Option | Description | Selected |
|--------|-------------|----------|
| eventId = noteId + triggerTime (unique guard) | Stable parity identity for dedupe | ✓ |
| noteId only | Collides recurring occurrences | |
| Random UUID per enqueue | Prevents dedupe across retries | |

| Option | Description | Selected |
|--------|-------------|----------|
| At-least-once + idempotent handlers | Reliable with retry/restart safety | ✓ |
| At-most-once | Can lose reminders under transient failures | |
| Fire-and-forget | Weak reliability semantics | |

**User's choice:** Parity-safe queue fan-out, commit-gated watermark, stable event identity, at-least-once semantics.

---

## Push retry and token hygiene semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Keep parity retries (2 attempts: ~30s, ~60s) | Matches existing behavior | ✓ |
| Expand retries with exponential jitter | Better outage tolerance, parity drift risk | |
| Queue default retries only | Less explicit behavior control | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per-device retry | Isolates failures and preserves successes | ✓ |
| Per-reminder batch retry | Can duplicate already-successful deliveries | |
| Hybrid buckets | More complexity than needed now | |

| Option | Description | Selected |
|--------|-------------|----------|
| Delete on UNREGISTERED immediately | Stops repeated invalid sends | ✓ |
| Mark then purge later | Adds intermediate token state management | |
| Never auto-delete | Preserves failures indefinitely | |

| Option | Description | Selected |
|--------|-------------|----------|
| Record terminal failure and continue | Observability without blocking flow | ✓ |
| Requeue indefinitely | Retry storm risk | |
| Fail whole reminder execution | One bad token can block valid deliveries | |

**User's choice:** Keep current retry profile and strict unregistered-token cleanup with non-blocking terminal-failure handling.

---

## Merge preflight/apply strategy contracts

| Option | Description | Selected |
|--------|-------------|----------|
| Keep parity preflight summary fields | Maintains existing contract expectations | ✓ |
| Minimal booleans only | Drops useful context for clients/tests | |
| Detailed per-record diffs | Out of parity scope | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep strategy enum `cloud|local|both` | Direct parity with current contract | ✓ |
| Rename to wins/both labels | Clearer labels, parity drift | |
| Accept both alias sets | More complexity and validation surface | |

| Option | Description | Selected |
|--------|-------------|----------|
| Single explicit transaction per apply | Prevents partial merges | ✓ |
| Multi-step non-transactional | Partial-failure risk | |
| Per-table mini-transactions | Cross-table consistency risk | |

| Option | Description | Selected |
|--------|-------------|----------|
| Shared resolveMergeResolution semantics | Canonical deterministic behavior | ✓ |
| Newest updatedAt wins | Potential semantic drift | |
| Prefer local on conflicts | Strategy drift from current behavior | |

**User's choice:** Preserve parity contract fields/enums and enforce transactional apply with shared merge resolver.

---

## Throttle + lock behavior under concurrency

| Option | Description | Selected |
|--------|-------------|----------|
| Keep threshold/base/max parity constants | Matches existing anti-abuse model | ✓ |
| Stricter constants | Safer but non-parity | |
| Milder constants | More permissive, weaker abuse control | |

| Option | Description | Selected |
|--------|-------------|----------|
| Key throttle by `toUserId` | Protects target account merge path | ✓ |
| Key by source device | Weaker target-account protection | |
| Key by IP only | Weak parity and mobile-network ambiguity | |

| Option | Description | Selected |
|--------|-------------|----------|
| Row locks (`FOR UPDATE`) in txn | Deterministic concurrent state transitions | ✓ |
| Advisory locks only | Less portable/explicit in parity tests | |
| No lock (optimistic only) | Race risk | |

| Option | Description | Selected |
|--------|-------------|----------|
| `rate_limit` + retry metadata | Stable error contract with actionable cooldown | ✓ |
| Generic forbidden | Loses retry semantics | |
| Silent delay | Opaque to clients | |

**User's choice:** Keep parity anti-abuse constants and enforce lock-safe transactional throttling with explicit `rate_limit` metadata.

---

## the agent's Discretion

- Queue/job naming conventions and internal payload DTO naming.
- Observability payload schema for terminal push failures.
- Lock timeout/retry tuning details that do not alter selected semantics.

## Deferred Ideas

None.
