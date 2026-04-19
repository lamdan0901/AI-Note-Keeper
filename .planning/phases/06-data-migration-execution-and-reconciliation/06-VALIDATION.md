---
phase: 06
slug: data-migration-execution-and-reconciliation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
---

# Phase 06 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test + TypeScript build |
| **Config file** | `apps/backend/tsconfig.json` |
| **Quick run command** | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools*.test.js"` |
| **Full suite command** | `npm --workspace apps/backend run test` |
| **Estimated runtime** | ~60-120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools*.test.js"`
- **After every plan wave:** Run `npm --workspace apps/backend run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | MIGR-01 | T-06-01 | Deterministic source ordering and serialization | unit | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools.export.test.js"` | ✅ | ⬜ pending |
| 06-01-02 | 01 | 1 | MIGR-01 | T-06-02 | Export artifact includes stable checksum and metadata | integration | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools.export.test.js"` | ✅ | ⬜ pending |
| 06-02-01 | 02 | 2 | MIGR-02 | T-06-03 | Import supports dry-run with zero writes | unit | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools.import.test.js"` | ✅ | ⬜ pending |
| 06-02-02 | 02 | 2 | MIGR-02 | T-06-04 | Import resume uses checkpoint boundary and avoids duplicates | integration | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools.import.test.js"` | ✅ | ⬜ pending |
| 06-03-01 | 03 | 3 | MIGR-03 | T-06-05 | Reconcile computes counts/checksums/sampling with explicit fail-closed thresholds | unit | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools.reconcile.test.js"` | ✅ | ⬜ pending |
| 06-03-02 | 03 | 3 | MIGR-04 | T-06-06 | Runbook defines rollback checkpoints and staging evidence criteria | docs | `rg "Rollback checkpoint|Staging rehearsal evidence|Sign-off thresholds" docs/migration-runbook.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Staging rehearsal sign-off by operator | MIGR-04 | Requires human review of operational readiness and rollback window | Follow runbook rehearsal checklist and capture sign-off artifact in phase summary |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
