# Cutover Rollout Runbook

## Scope

This runbook governs web and mobile client cutover from Convex transport to Express APIs using gated cohort progression.

## Cohort Stages

1. shadow: internal-only validation traffic.
2. pilot: limited trusted-user cohort.
3. ramp: controlled percentage rollout.
4. full: full production traffic.

Progression is linear. Do not skip from shadow directly to full.

## Required Gates Before Advancing

All gates must pass for the active cohort before advancing.

- parity gate: web/mobile behavior matches baseline acceptance checks.
- SLO gate: error rate, latency, and retry metrics are within threshold for the cohort window.
- rollback drill gate: rollback rehearsal has completed successfully for the target cohort.

If any gate fails, rollout is blocked.

## Parity Evidence

Collect and attach evidence for each cohort:

- web smoke checks for notes, reminders, subscriptions, and trash flows.
- mobile offline create/delete sync checks and ownership safeguards.
- regression suite results for cutover gate tests.

## SLO Thresholds

Suggested baseline thresholds per cohort window:

- API non-2xx rate <= 1.0%
- p95 API latency <= 1000 ms for critical note/reminder/subscription paths
- auth refresh failure rate <= 0.5%

If thresholds are exceeded, stop advancement and execute rollback trigger review.

## Rollback Trigger Conditions

Trigger rollback immediately when any condition is met:

- parity regression affecting write/read correctness.
- sustained SLO breach over agreed observation window.
- authentication instability or repeated unauthorized loops.

## Rollback Drill Procedure

1. Identify active cohort and incident owner.
2. Freeze progression to next cohort.
3. Disable cutover cohort advancement flags.
4. Verify web and mobile clients return to previously stable cohort behavior.
5. Re-run smoke checks and capture post-rollback evidence.
6. Record timeline, owner decisions, and sign-off timestamp.

## Sign-off Requirements

Each cohort requires explicit sign-off before progression:

- release owner sign-off
- on-call/incident owner sign-off
- quality reviewer sign-off

Record sign-off timestamps and evidence links in the checklist artifact.
