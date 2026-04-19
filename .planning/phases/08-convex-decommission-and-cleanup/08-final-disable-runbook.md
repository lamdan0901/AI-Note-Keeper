# Phase 8 Final Disable Runbook

## Stage B Purpose

This runbook defines the controlled shutdown sequence to disable Convex only after Stage-A cleanup and archive prerequisites are verified.

## Mandatory Preconditions

- Stage-A summaries are complete:
  - `08-02-SUMMARY.md`
  - `08-03-SUMMARY.md`
- Reconcile artifact is present and current.
- Pre-decommission tag and rollback archive are attached.
- Release owner sign-off is recorded.
- Finalize guard passes.

## Finalize Guard Command

Run from repository root:

```bash
npm --workspace apps/backend run decommission:finalize-guard -- \
  --stage-a-verified true \
  --stage-a-verified-at <ISO-8601> \
  --reconcile <path-to-final-reconcile-artifact> \
  --pre-decommission-tag <git-tag> \
  --checklist .planning/phases/08-convex-decommission-and-cleanup/08-decommission-checklist.md \
  --release-owner-sign-off-at <ISO-8601>
```

If the command reports blocked reasons, stop immediately and resolve missing prerequisites.

## Controlled Shutdown Steps

1. Confirm all mandatory preconditions in `08-decommission-checklist.md`.
2. Execute finalize guard and attach command output to the checklist.
3. Perform Convex disable through the approved operator channel.
4. Record `final-disable-complete`, operator identity, timestamp, and rollback reference.
5. Acquire final release owner sign-off timestamp.

## Rollback Checkpoint

If post-disable validation fails:

1. Halt additional rollout changes.
2. Use rollback artifacts and pre-decommission tag to restore prior state.
3. Document incident details in checklist and migration runbook.