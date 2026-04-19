---
phase: 03
slug: notes-and-adjacent-domain-api-parity
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-04-19
---

# Phase 03 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**          | node:test (backend), jest contract tests                                                                                                                                              |
| **Config file**        | `apps/backend/tsconfig.json`, root `jest` config in `package.json`                                                                                                                    |
| **Quick run command**  | `npm --workspace apps/backend run test`                                                                                                                                               |
| **Full suite command** | `npm --workspace apps/backend run test && npm test -- tests/contract/notes.crud.test.ts tests/contract/subscriptions.reminders.test.ts tests/contract/aiNoteCapture.contract.test.ts` |
| **Estimated runtime**  | ~90 seconds                                                                                                                                                                           |

---

## Sampling Rate

- **After every task commit:** Run `npm --workspace apps/backend run test`
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                        | Threat Ref | Secure Behavior                                                          | Test Type        | Automated Command                                                                                                                                                                     | File Exists | Status  |
| -------- | ---- | ---- | ---------------------------------- | ---------- | ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- |
| 03-01-01 | 01   | 1    | NOTE-01, NOTE-02                   | T-03-01    | Authenticated ownership + LWW enforcement                                | unit/integration | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-01-02 | 01   | 1    | NOTE-03, NOTE-04                   | T-03-02    | Replay-safe dedupe + deterministic sync under concurrency                | integration      | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-02-01 | 02   | 2    | SUBS-01, SUBS-02                   | T-03-05    | Server-owned reminder derivation + ownership checks                      | unit/integration | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-02-02 | 02   | 2    | DEVC-01, DEVC-02                   | T-03-06    | Idempotent device token writes; no `notification_ledger` backend surface | unit/integration | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-03-01 | 03   | 2    | AICP-01, AICP-02                   | T-03-09    | DTO parity and deterministic provider-failure fallback                   | unit/integration | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-03-02 | 03   | 2    | AICP-03                            | T-03-10    | Input validation + endpoint-level throttling                             | integration      | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-04-01 | 04   | 3    | NOTE-01, SUBS-01, DEVC-01, AICP-03 | T-03-12    | Authenticated route mounting and stable error contracts                  | integration      | `npm --workspace apps/backend run test`                                                                                                                                               | ✅          | pending |
| 03-04-02 | 04   | 3    | NOTE-03, AICP-02                   | T-03-13    | Replay/fallback parity checks in end-to-end route tests                  | contract         | `npm --workspace apps/backend run test && npm test -- tests/contract/notes.crud.test.ts tests/contract/subscriptions.reminders.test.ts tests/contract/aiNoteCapture.contract.test.ts` | ✅          | pending |

_Status: pending, green, red, flaky_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior                                                            | Requirement | Why Manual                      | Test Instructions                                                                               |
| ------------------------------------------------------------------- | ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Verify no backend `notification_ledger` exposure in API docs/routes | DEVC-02     | Architectural boundary sign-off | Inspect backend route registry and SQL migrations; confirm absence of table/repository/endpoint |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
