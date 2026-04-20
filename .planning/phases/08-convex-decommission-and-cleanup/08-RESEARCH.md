# Phase 08 Research: Convex Decommission and Cleanup

Date: 2026-04-19
Phase: 08-convex-decommission-and-cleanup
Requirements: DECM-01

## Inputs Reviewed

- .planning/ROADMAP.md
- .planning/REQUIREMENTS.md
- .planning/STATE.md
- .planning/PROJECT.md
- .planning/phases/08-convex-decommission-and-cleanup/08-CONTEXT.md
- .planning/phases/07-web-and-mobile-cutover-to-express-apis/07-05-SUMMARY.md
- docs/CONVEX_TO_EXPRESS_MIGRATION.md
- docs/migration-runbook.md
- docs/cutover-rollout-runbook.md
- apps/web/src/auth/AuthContext.tsx
- apps/web/src/pages/reminders.tsx
- apps/mobile/App.tsx
- apps/mobile/src/auth/AuthContext.tsx
- apps/mobile/src/reminders/headless.ts
- apps/mobile/src/reminders/ui/RescheduleOverlay.tsx
- apps/mobile/src/screens/TrashScreen.tsx
- apps/mobile/src/sync/fetchReminder.ts
- apps/mobile/src/sync/noteSync.ts
- apps/mobile/src/screens/SettingsScreen.tsx
- apps/mobile/src/components/BottomTabBar.tsx
- package.json
- apps/web/package.json
- apps/mobile/package.json
- apps/web/.env.example
- apps/mobile/.env.example
- apps/mobile/eas.json

## Locked Decision Fidelity (from CONTEXT.md)

- D-01: 7-day full-cohort stability window before retirement.
- D-02: Daily automated regression plus daily web/mobile critical-flow smoke checks.
- D-03: Existing runbook SLO thresholds are hard shutdown gates.
- D-04: Release owner is the final sign-off authority.
- D-05: Required order is final reconcile -> archive/tag -> cleanup deps/imports/env -> disable Convex last.
- D-06: Two-stage cleanup with explicit verification gate between Stage A and Stage B.
- D-07: Mandatory rollback archive before disable includes pre-decommission tag, final reconciliation report, checklist artifact, and sign-offs.
- D-08: Final shutdown is controlled through explicit runbook operator steps, then final disable.

No deferred ideas exist for this phase.

## Current Baseline

- Phase 7 delivered cohort-gate logic and cutover governance, but Convex runtime imports and env wiring still exist in active web/mobile runtime files.
- Convex dependencies remain in root and app package manifests (`package.json`, `apps/web/package.json`, `apps/mobile/package.json`).
- Convex environment variables remain in web/mobile env examples and mobile EAS config.
- Existing runbooks define parity and SLO gates but do not yet codify phase-8 stability hold, decommission archive completeness, and final shutdown procedure details.

## Decommission Strategy

### Stage A (reversible cleanup)

- Remove runtime Convex imports/usages from web and mobile code paths and route all remaining paths through Express transport.
- Remove Convex dependency and env wiring from app-level configs after runtime code no longer depends on it.
- Add automated no-runtime-Convex assertions for web/mobile source trees to prevent regressions.

### Stage B (irreversible shutdown gate)

- Enforce ordered finalization gate that requires reconcile artifact plus rollback archive completeness before disable.
- Persist operator-facing runbook/checklist artifacts with release-owner-only final sign-off and explicit execution steps for disable.
- Execute final disable only after Stage A verification pass and all archive/sign-off artifacts are present.

## Security and Reliability Risks

1. Premature disable risk.

- Mitigation: enforce ordered finalization guard requiring reconcile and archive artifacts before any disable step (D-05, D-07, D-08).

2. Evidence spoofing or incomplete sign-off.

- Mitigation: explicit checklist schema with required sign-off fields and release-owner identity gate (D-04, D-07).

3. Hidden Convex runtime coupling after cleanup.

- Mitigation: source-scan regression tests that fail on `convex/*` runtime imports in web/mobile source.

4. Stability-window under-observation.

- Mitigation: codify 7-day gate and daily required evidence rows with fail-closed evaluation (D-01, D-02, D-03).

## Recommended Plan Split

- Plan 08-01: codify decommission governance and stability/archive contracts.
- Plan 08-02: Stage A web cleanup (remove runtime Convex coupling and web config dependency).
- Plan 08-03: Stage A mobile cleanup (remove runtime Convex coupling and mobile config dependency).
- Plan 08-04: Stage B finalization gate and controlled shutdown runbook/operator flow.

This split preserves D-06 by separating reversible cleanup (plans 08-02/08-03) from irreversible final disable controls (plan 08-04).

## Validation Architecture

### Tooling

- Frameworks: Jest (workspace/root integration tests), node:test for backend modules.
- Quick command:
  - `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/decommission*.test.js"`
- Full command:
  - `npm run lint ; npm run -s test -- tests/integration/cutover.cohort-gates.test.ts tests/integration/decommission.*.test.ts`

### Sampling Strategy

- After each task commit: run quick command for touched subsystem tests.
- After each plan completion: run full command for phase-8 coverage subset.
- Before `/gsd-verify-work`: run lint plus full phase-8 integration subset.

### Required New Tests

- `apps/backend/src/tests/decommission.stabilityGate.test.ts`
- `apps/backend/src/tests/decommission.finalizeGuard.test.ts`
- `tests/integration/decommission.web-runtime.test.ts`
- `tests/integration/decommission.mobile-runtime.test.ts`

### Acceptance Signals

- Stability-window evaluator fails closed when any daily evidence is missing or thresholds fail.
- Web and mobile runtime scans report no active `convex/*` runtime imports.
- Finalize guard blocks disable when reconcile/tag/checklist/sign-off artifacts are incomplete.
- Runbook and checklist encode release-owner-only final sign-off and explicit shutdown sequence.

## Recommendation

Proceed with planning and execution using current stack and internal tooling only. No new external dependency is required for phase 8.
