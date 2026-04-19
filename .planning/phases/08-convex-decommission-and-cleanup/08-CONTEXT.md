# Phase 8: Convex Decommission and Cleanup - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Retire Convex runtime dependencies safely after sustained stability on Express/PostgreSQL for both web and mobile. This phase only covers decommission and cleanup sequencing, evidence, and rollback readiness. It does not add new product capabilities.

</domain>

<decisions>
## Implementation Decisions

### Stability window sign-off definition
- **D-01:** Final Convex retirement requires a 7 calendar day stability window with both clients running at full cohort.
- **D-02:** During the stability window, require daily automated regression runs plus daily critical-flow smoke checks across web and mobile.
- **D-03:** Use current runbook SLO thresholds as hard shutdown gates (not advisory).
- **D-04:** Final sign-off authority is release owner only.

### Decommission sequencing and rollback guard
- **D-05:** Required order is: final reconcile, archive and pre-decommission tag, dependency/import/env cleanup, then Convex disable last.
- **D-06:** Execute cleanup in two stages with a verification gate between Stage A cleanup and Stage B final disable.
- **D-07:** Required rollback archive before disable includes pre-decommission git tag, final reconciliation report, checklist artifact, and sign-offs.
- **D-08:** Final shutdown is controlled via explicit runbook operator steps, then final disable.

### the agent's Discretion
- Exact naming of scripts/check commands and commit breakdown inside each staged cleanup gate.
- Exact implementation details for evidence collection automation, as long as decisions D-01 through D-08 remain enforced.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and locked requirements
- `.planning/ROADMAP.md` - Phase 8 goal, dependency, and success criteria.
- `.planning/REQUIREMENTS.md` - DECM-01 requirement definition.
- `.planning/PROJECT.md` - parity-first migration constraints and decommission intent.

### Migration and decommission procedure
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md` - Phase 8 TODOs, deliverables, and exit criteria.
- `docs/migration-runbook.md` - reconciliation and migration operational checkpoints.
- `docs/cutover-rollout-runbook.md` - cohort gates, SLO policy, rollback triggers, and sign-off model.

### Existing cutover gate implementation
- `apps/web/src/config/cutover.ts` - web cohort and gate evaluation behavior.
- `apps/mobile/src/config/cutover.ts` - mobile cohort and gate evaluation behavior.
- `tests/integration/cutover.cohort-gates.test.ts` - deterministic gate behavior and blocked reason coverage.
- `.planning/phases/07-web-and-mobile-cutover-to-express-apis/07-cutover-checklist.md` - checklist artifact fields for evidence, rollback, and approvals.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/src/config/cutover.ts`: stable cutover gate primitives (`parity_failed`, `slo_failed`, `rollback_drill_incomplete`, cohort-order blocking).
- `apps/mobile/src/config/cutover.ts`: mirrored mobile gate logic, enabling cross-surface decommission gating consistency.
- `tests/integration/cutover.cohort-gates.test.ts`: direct regression safety net for gate policy changes.
- `.planning/phases/07-web-and-mobile-cutover-to-express-apis/07-cutover-checklist.md`: reusable operator checklist structure for final decommission sign-off records.

### Established Patterns
- Cohort progression is linear (`shadow -> pilot -> ramp -> full`) and blocks unsafe jumps.
- Parity, SLO, and rollback-drill checks are explicit, deterministic, and environment-driven.
- Migration safety relies on staged execution with documented rollback evidence before irreversible actions.

### Integration Points
- Phase 8 cleanup should integrate with existing web/mobile cutover config and tests before Convex disable.
- Final reconciliation and rollback archive must align with migration runbooks and phase-7 checklist evidence flow.
- Decommission automation should update workspace configuration surfaces where Convex env vars/dependencies currently remain.

</code_context>

<specifics>
## Specific Ideas

- Keep decommission discipline strict: reversible staged cleanup first, irreversible Convex disable only at the final gated step.
- Enforce daily confidence checks during the full-cohort stability window instead of one-time sign-off checks.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 08-convex-decommission-and-cleanup*
*Context gathered: 2026-04-19*
