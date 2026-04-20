---
phase: 05-worker-push-merge-and-throttle-hardening
reviewed: 2026-04-19T04:51:14.7597169Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - apps/backend/src/jobs/push/contracts.ts
  - apps/backend/src/jobs/push/push-delivery-service.ts
  - apps/backend/src/jobs/push/push-job-handler.ts
  - apps/backend/src/jobs/reminders/contracts.ts
  - apps/backend/src/jobs/reminders/cron-state-repository.ts
  - apps/backend/src/jobs/reminders/dispatch-due-reminders.ts
  - apps/backend/src/jobs/reminders/due-reminder-scanner.ts
  - apps/backend/src/merge/contracts.ts
  - apps/backend/src/merge/repositories/merge-repository.ts
  - apps/backend/src/merge/routes.ts
  - apps/backend/src/merge/service.ts
  - apps/backend/src/reminders/service.ts
  - apps/backend/src/runtime/createApiServer.ts
  - apps/backend/src/tests/jobs/push-delivery-service.test.ts
  - apps/backend/src/tests/jobs/push-job-handler.test.ts
  - apps/backend/src/tests/jobs/reminder-dispatch.test.ts
  - apps/backend/src/tests/merge/routes.test.ts
  - apps/backend/src/tests/merge/service.test.ts
  - apps/backend/src/tests/parity/phase4.http.contract.test.ts
  - apps/backend/src/tests/parity/phase5.http.contract.test.ts
  - apps/backend/src/tests/parity/phase5.security-boundary.test.ts
  - apps/backend/src/tests/parity/phase5.worker.contract.test.ts
  - apps/backend/src/worker/boss-adapter.ts
  - apps/backend/src/worker/contracts.ts
  - apps/backend/src/worker/index.ts
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-19T04:51:14.7597169Z  
**Depth:** standard  
**Files Reviewed:** 25  
**Status:** issues

## Summary

Reviewed all phase-05 source changes for worker push/retry handling, reminder dispatch, merge flow, runtime wiring, and phase parity/security tests (including regression fix commit 3d9765d).

Primary risk is a destructive merge edge case that can erase a user's own notes/subscriptions/tokens when `toUserId` equals the authenticated user and `strategy=local`. Two additional correctness/reliability risks were found in merge event transfer edge cases and worker retry shutdown accounting.

## Critical Issues

### CR-01: Self-merge with `strategy=local` can delete user data

**File:** `apps/backend/src/merge/service.ts:350`  
**File:** `apps/backend/src/merge/service.ts:360`  
**File:** `apps/backend/src/merge/repositories/merge-repository.ts:428`  
**File:** `apps/backend/src/merge/repositories/merge-repository.ts:430`  
**File:** `apps/backend/src/merge/contracts.ts:48`

**Issue:**
`apply()` allows `fromUserId === toUserId`, then calls `replaceTargetWithSource()`. In that repository method, target rows are deleted first and then reassigned from source. If source and target are the same user, deletes happen first and reassignment updates no rows, causing data loss.

**Fix:**
Reject same-account merges before transaction mutations (service-level guard is mandatory; route/schema guard is optional but recommended).

```ts
// merge/service.ts
const assertDistinctMergeUsers = (fromUserId: string, toUserId: string): void => {
  if (fromUserId === toUserId) {
    throw new AppError({
      code: 'validation',
      message: 'Source and target users must be different for merge.',
    });
  }
};

// In both preflight and apply:
assertDistinctMergeUsers(input.fromUserId, input.toUserId);
```

## Warnings

### WR-01: `both` strategy can drop source events for event-only source snapshots

**File:** `apps/backend/src/merge/repositories/merge-repository.ts:533`

**Issue:**
`sourceUserId` is derived from notes/subscriptions/tokens only:
`source.notes[0]?.userId ?? source.subscriptions[0]?.userId ?? source.tokens[0]?.userId`.
If source has only `note_change_events` (possible after note cleanup history), `sourceUserId` is `undefined`, so no source-side event ownership migration occurs under `mergeSourceIntoTarget()`.

**Fix:**
Pass explicit `sourceUserId` from service into repository transaction API, or at least include `source.events[0]?.userId` in fallback derivation.

```ts
const sourceUserId =
  source.notes[0]?.userId ??
  source.subscriptions[0]?.userId ??
  source.tokens[0]?.userId ??
  source.events[0]?.userId;
```

### WR-02: Worker tracks only one in-flight push retry promise

**File:** `apps/backend/src/worker/boss-adapter.ts:143`  
**File:** `apps/backend/src/worker/boss-adapter.ts:274`

**Issue:**
Retry timers can fire close together, but `inFlightPushJob` stores only one promise reference. A later retry overwrites an earlier one, and `stop()` awaits only the latest reference. This can allow unfinished retry handlers to outlive shutdown.

**Fix:**
Track all active retry promises in a set and await `Promise.allSettled()` during stop.

```ts
const inFlightPushJobs = new Set<Promise<void>>();

const retryPromise = (async () => {
  try {
    await pushJobHandlerRef.handle(...);
  } finally {
    inFlightPushJobs.delete(retryPromise);
  }
})();

inFlightPushJobs.add(retryPromise);

// On stop:
await Promise.allSettled([...inFlightPushJobs]);
```

---

_Reviewed: 2026-04-19T04:51:14.7597169Z_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_
