---
phase: 08
slug: convex-decommission-and-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 08 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Framework**          | Jest + node:test                                                                                                            |
| **Config file**        | jest.config.js                                                                                                              |
| **Quick run command**  | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/decommission*.test.js"`                      |
| **Full suite command** | `npm run lint ; npm run -s test -- tests/integration/cutover.cohort-gates.test.ts tests/integration/decommission.*.test.ts` |
| **Estimated runtime**  | ~90 seconds                                                                                                                 |

---

## Sampling Rate

- **After every task commit:** Run `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/decommission*.test.js"` for backend decommission contracts and relevant targeted integration tests for touched files.
- **After every plan wave:** Run `npm run lint ; npm run -s test -- tests/integration/cutover.cohort-gates.test.ts tests/integration/decommission.*.test.ts`.
- **Before `/gsd-verify-work`:** Full suite command must be green.
- **Max feedback latency:** 120 seconds.

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Threat Ref        | Secure Behavior                                                      | Test Type   | Automated Command                                                                                                                                                                      | File Exists         | Status           |
| -------- | ---- | ---- | ----------- | ----------------- | -------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------- | --------------- | ----- | ---------- |
| 08-01-01 | 01   | 1    | DECM-01     | T-08-01 / T-08-02 | Stability and evidence gates fail closed                             | unit        | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/decommission.stabilityGate.test.js"`                                                                    | ✅                  | ⬜ pending       |
| 08-01-02 | 01   | 1    | DECM-01     | T-08-03           | Runbook/checklist enforce release-owner sign-off and archive fields  | integration | `Select-String -Path "docs/cutover-rollout-runbook.md",".planning/phases/08-convex-decommission-and-cleanup/08-decommission-checklist.md" -Pattern "7 calendar day                     | release owner       | pre-decommission | reconcile"`     | ✅    | ⬜ pending |
| 08-02-01 | 02   | 2    | DECM-01     | T-08-05           | Web runtime no longer depends on Convex imports/env                  | integration | `npm run -s test -- tests/integration/decommission.web-runtime.test.ts`                                                                                                                | ❌ W0               | ⬜ pending       |
| 08-02-02 | 02   | 2    | DECM-01     | T-08-06           | Web package/env cleanup blocks Convex runtime reintroduction         | integration | `npm --workspace apps/web run test -- tests/decommission.web-runtime.test.ts`                                                                                                          | ❌ W0               | ⬜ pending       |
| 08-03-01 | 03   | 2    | DECM-01     | T-08-07           | Mobile runtime no longer depends on Convex imports/env               | integration | `npm run -s test -- tests/integration/decommission.mobile-runtime.test.ts`                                                                                                             | ❌ W0               | ⬜ pending       |
| 08-03-02 | 03   | 2    | DECM-01     | T-08-08           | Mobile package/env/eas cleanup blocks Convex runtime reintroduction  | integration | `npm run -s test -- tests/integration/decommission.mobile-runtime.test.ts`                                                                                                             | ❌ W0               | ⬜ pending       |
| 08-04-01 | 04   | 3    | DECM-01     | T-08-09           | Finalize guard enforces ordered archive prerequisites before disable | unit        | `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/decommission.finalizeGuard.test.js"`                                                                    | ❌ W0               | ⬜ pending       |
| 08-04-02 | 04   | 3    | DECM-01     | T-08-10           | Final runbook mandates controlled operator disable flow              | integration | `Select-String -Path "docs/cutover-rollout-runbook.md","docs/migration-runbook.md",".planning/phases/08-convex-decommission-and-cleanup/08-final-disable-runbook.md" -Pattern "Stage B | controlled shutdown | disable Convex   | release owner"` | ❌ W0 | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky_

---

## Wave 0 Requirements

- [ ] `tests/integration/decommission.web-runtime.test.ts` - web runtime no-Convex assertion scaffold.
- [ ] `tests/integration/decommission.mobile-runtime.test.ts` - mobile runtime no-Convex assertion scaffold.
- [ ] `apps/backend/src/tests/decommission.finalizeGuard.test.ts` - finalize gate contract test scaffold.

---

## Manual-Only Verifications

| Behavior                                                   | Requirement | Why Manual                                                      | Test Instructions                                                                                                                        |
| ---------------------------------------------------------- | ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Final disable execution in production Convex control plane | DECM-01     | Requires operator credentials and external control-plane action | Follow `.planning/phases/08-convex-decommission-and-cleanup/08-final-disable-runbook.md` and attach executed evidence to phase checklist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
