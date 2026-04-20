# Phase 8: Convex Decommission and Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-04-19T16:47:14.1009718+07:00
**Phase:** 08-convex-decommission-and-cleanup
**Areas discussed:** Stability window sign-off definition, Decommission sequencing and rollback guard

---

## Stability window sign-off definition

| Option           | Description                                                                           | Selected |
| ---------------- | ------------------------------------------------------------------------------------- | -------- |
| 72 hours minimum | Balances confidence and delivery speed; aligns with existing parity/SLO gate cadence. |          |
| 7 calendar days  | Higher confidence for rare edge regressions, slower decommission.                     | ✓        |
| 24 hours only    | Fastest path, highest regression risk after shutdown.                                 |          |

**User's choice:** 7 calendar days
**Notes:** Final shutdown must wait for sustained full-cohort stability.

| Option                                                       | Description                                                          | Selected |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | -------- |
| Daily automated + daily critical-flow smoke (web and mobile) | Catches regressions early and confirms real user paths continuously. | ✓        |
| Automated suite only                                         | Lower manual overhead, but can miss UX/runtime edge behavior.        |          |
| One-time pre-shutdown check only                             | Lowest effort, weakest confidence.                                   |          |

**User's choice:** Daily automated + daily critical-flow smoke (web and mobile)
**Notes:** Ongoing daily evidence is required during the full-window hold.

| Option                                       | Description                                            | Selected |
| -------------------------------------------- | ------------------------------------------------------ | -------- |
| Use current runbook thresholds as hard gates | Keeps policy consistent with existing cutover runbook. | ✓        |
| Tighten thresholds one step for final week   | Higher confidence, higher chance of delay/noise.       |          |
| Require parity only; SLO is advisory         | Faster but weaker operational guardrail.               |          |

**User's choice:** Use current runbook thresholds as hard gates
**Notes:** SLO gate remains mandatory for final retirement readiness.

| Option                                           | Description                                                 | Selected |
| ------------------------------------------------ | ----------------------------------------------------------- | -------- |
| Release owner + on-call owner + quality reviewer | Matches runbook sign-off model and balanced accountability. |          |
| Release owner only                               | Fastest, but single-point decision risk.                    | ✓        |
| Release owner + on-call owner                    | Strong ops view, less formal quality gate.                  |          |

**User's choice:** Release owner only
**Notes:** Final approval authority is centralized on release owner.

---

## Decommission sequencing and rollback guard

| Option                                                                      | Description                                                                    | Selected |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Reconcile -> archive/tag -> cleanup deps/imports/env -> disable Convex last | Keeps every step reversible until final shutdown and aligns with P8-01..P8-07. | ✓        |
| Cleanup deps/imports first, reconcile later, then disable                   | Can reduce work if reconciliation fails, but weakens rollback confidence.      |          |
| Disable Convex right after reconcile, cleanup afterward                     | Fastest shutdown, highest recovery risk if latent regression appears.          |          |

**User's choice:** Reconcile -> archive/tag -> cleanup deps/imports/env -> disable Convex last
**Notes:** Reversibility and rollback safety take priority over speed.

| Option                                           | Description                                                                   | Selected |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | -------- |
| Two stages with a verification gate between them | Stage A cleanup with tests, Stage B final disable after explicit pass.        | ✓        |
| One atomic decommission change                   | Simpler history, larger blast radius if rollback is needed.                   |          |
| Many incremental changes over time               | Lower per-change risk, but drifts decommission boundary and sign-off clarity. |          |

**User's choice:** Two stages with a verification gate between them
**Notes:** Staged execution with explicit pass/fail checkpoint is required.

| Option                                                                | Description                                           | Selected |
| --------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| Pre-decommission tag + final reconcile report + checklist + sign-offs | Strongest forensic and rollback readiness.            | ✓        |
| Pre-decommission git tag only                                         | Minimal archive, weaker evidence for incident review. |          |
| Checklist note only                                                   | Lowest overhead, insufficient rollback traceability.  |          |

**User's choice:** Pre-decommission tag + final reconcile report + checklist + sign-offs
**Notes:** Artifact completeness is mandatory before disable.

| Option                                                    | Description                                               | Selected |
| --------------------------------------------------------- | --------------------------------------------------------- | -------- |
| Controlled shutdown via runbook steps, then final disable | Keeps explicit operator checkpoints during final step.    | ✓        |
| Immediate permanent disable once sign-off is recorded     | Fastest path, minimal operational checkpoints.            |          |
| Keep Convex running in standby indefinitely               | Max rollback comfort, but does not complete decommission. |          |

**User's choice:** Controlled shutdown via runbook steps, then final disable
**Notes:** No immediate hard cut; execute controlled operator sequence.

---

## the agent's Discretion

- Script naming and exact command plumbing for staged cleanup checks.
- Internal automation structure for collecting daily evidence.

## Deferred Ideas

None.
