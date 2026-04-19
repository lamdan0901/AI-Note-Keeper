# Phase 4: Reminder Domain Parity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves alternatives considered.

**Date:** 2026-04-19
**Phase:** 04-reminder-domain-parity
**Areas discussed:** Reminder HTTP Contract, Acknowledge/Snooze State Transitions, Recurrence + Timezone Policy, Change Events + Dedupe, Update Conflict Policy, Canonical Recurrence Patch Semantics

---

## Reminder HTTP Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated reminder routes | `/api/reminders` with dedicated CRUD + action endpoints | Yes |
| Extend notes sync only | No dedicated reminder action routes | |
| Hybrid | Sync plus dedicated action endpoints | |

**User's choice:** Dedicated reminder routes.
**Notes:** Missing reminder behavior kept parity-style nullable/false contract; list supports optional `updatedSince`; auth user identity derived from token only.

---

## Acknowledge/Snooze State Transitions

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Convex parity | `done=true` on ack(done), recurring computes next trigger, unschedule when finished | Yes |
| Mark done=false for recurring | consume-occurrence semantics only | |
| Split by repeat kind | behavior varies by repeat kind | |

**User's choice:** Keep Convex parity transition matrix.
**Notes:** One-time + future snooze honors snoozed schedule on ack; snooze sets `snoozedUntil`, `nextTriggerAt`, `scheduleStatus=scheduled`, `active=true`; recurrence fields remain untouched.

---

## Recurrence + Timezone Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Shared utility only | Use `packages/shared/utils/recurrence.ts` as sole recurrence engine | Yes |
| Hybrid shared + SQL helpers | mixed compute paths | |
| Backend-specific implementation | reimplement recurrence in backend | |

**User's choice:** Shared utility only, with strict timezone validation.
**Notes:** Writes must use valid IANA timezone; invalid timezone returns validation error; DST behavior must match shared utility semantics exactly.

---

## Change Events + Dedupe

| Option | Description | Selected |
|--------|-------------|----------|
| Existing unique tuple | dedupe on noteId + userId + operation + payloadHash | Yes |
| payloadHash only | global hash dedupe | |
| noteId + changedAt | time-window dedupe | |

**User's choice:** Keep existing tuple-based dedupe.
**Notes:** Event writes happen only on effective state changes; preserve immediate enqueue hook for parity in this phase; payload hash is server-derived and default `deviceId` is `web` when absent.

---

## Update Conflict Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Strict greater-than | apply only when `incoming.updatedAt > existing.updatedAt` | Yes |
| Greater-than-or-equal | apply when equal or newer | |
| Arrival-order wins | ignore timestamp ordering | |

**User's choice:** Strict greater-than LWW.
**Notes:** Equal timestamp ties are deterministic no-op; stale/no-op responses return current persisted state; repeated stale attempts remain silent-idempotent.

---

## Canonical Recurrence Patch Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Omitted vs null preserved | omitted keeps server value; null clears | Yes |
| Omitted treated as null | missing recurrence fields clear values | |
| Full recurrence block required globally | reject all partial recurrence updates | |

**User's choice:** Preserve omitted-vs-null semantics.
**Notes:** Rule applies to `repeat`, `startAt`, `baseAtLocal`, `nextTriggerAt`, `lastFiredAt`, and `lastAcknowledgedAt`. If `repeat` is present it must be fully valid for its kind; recurrence definition changes trigger server-side recompute of `nextTriggerAt`.

---

## the agent's Discretion

- Final route/repository/service file split and naming under backend architecture.
- Internal SQL/query implementation details that do not alter locked behavior.

## Deferred Ideas

None.
