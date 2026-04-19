---
phase: 05-worker-push-merge-and-throttle-hardening
fixed_at: 2026-04-19T12:11:59.6771483+07:00
review_path: .planning/phases/05-worker-push-merge-and-throttle-hardening/05-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-04-19T12:11:59.6771483+07:00
**Source review:** .planning/phases/05-worker-push-merge-and-throttle-hardening/05-REVIEW.md
**Iteration:** 1

**Summary:**

- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: Self-merge with strategy=local can delete user data

**Status:** fixed
**Files modified:** apps/backend/src/merge/service.ts, apps/backend/src/tests/merge/service.test.ts
**Commit:** 51efb58
**Applied fix:** Added explicit same-account merge guard in merge service preflight/apply and added regression tests confirming validation rejection before transaction or mutation.

### WR-01: both strategy can drop source events for event-only source snapshots

**Status:** fixed: requires human verification
**Files modified:** apps/backend/src/merge/repositories/merge-repository.ts, apps/backend/src/merge/service.ts, apps/backend/src/tests/merge/service.test.ts
**Commit:** 443b7c7
**Applied fix:** Removed inferred source identity in repository merge transaction by threading explicit sourceUserId from service; updated merge transaction type and added regression coverage for event-only source snapshots.

### WR-02: Worker tracks only one in-flight push retry promise

**Status:** fixed: requires human verification
**Files modified:** apps/backend/src/worker/boss-adapter.ts, apps/backend/src/tests/worker-bootstrap.test.ts
**Commit:** 549624d
**Applied fix:** Replaced single in-flight retry promise with a tracker backed by a promise set, wired worker health to set state, and awaited all active retry promises during shutdown with Promise.allSettled().

---

_Fixed: 2026-04-19T12:11:59.6771483+07:00_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
