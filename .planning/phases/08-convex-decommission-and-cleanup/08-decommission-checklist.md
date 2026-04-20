# Phase 8 Decommission Checklist

Status: in_progress
Phase: 08-convex-decommission-and-cleanup
Owner: [release owner]
Updated: [YYYY-MM-DD]

## Stability Hold Gate (7 calendar day)

- [ ] 7 calendar day full-cohort window complete.
- [ ] Daily log file attached: `08-daily-stability-log.md`.
- [ ] Every daily row contains regression, smoke, and SLO pass evidence.

## Rollback Archive Requirements

- [ ] pre-decommission git tag created and recorded: `[tag]`
- [ ] final reconcile report attached: `[link or artifact path]`
- [ ] rollback checkpoint evidence attached: `[link or artifact path]`
- [ ] checklist artifact finalized and archived

## Final Authorization

- release owner: `[name]`
- release owner sign-off timestamp: `[ISO-8601]`
- on-call reviewer sign-off timestamp: `[ISO-8601]`
- quality reviewer sign-off timestamp: `[ISO-8601]`

## Final Disable Metadata

- Stage-A verification marker attached: `[08-02-SUMMARY and 08-03-SUMMARY]`
- finalize guard command output attached: `[path]`
- finalize guard pass timestamp: `[ISO-8601]`
- final-disable-complete: `[true|false]`
- disable executed by: `[operator identity]`
- disable executed at: `[ISO-8601]`
- rollback reference: `[ticket/runbook link]`
