import {
  REQUIRED_STABILITY_DAYS,
  type DailyStabilityEvidence,
  type DecommissionGateReason,
  type StabilityGateInput,
  type StabilityGateResult,
} from './contracts.js';

const buildFlagReason = (
  value: boolean | undefined,
  missingReason: DecommissionGateReason,
  failedReason: DecommissionGateReason,
): DecommissionGateReason | null => {
  if (value === undefined) {
    return missingReason;
  }

  if (!value) {
    return failedReason;
  }

  return null;
};

const evaluateDayEvidence = (day: DailyStabilityEvidence): ReadonlyArray<DecommissionGateReason> => {
  const results = [
    buildFlagReason(day.regressionPassed, 'daily_regression_missing', 'daily_regression_failed'),
    buildFlagReason(day.smokePassed, 'daily_smoke_missing', 'daily_smoke_failed'),
    buildFlagReason(day.sloPassed, 'daily_slo_missing', 'daily_slo_failed'),
  ].filter((reason): reason is DecommissionGateReason => reason !== null);

  return results;
};

const unique = (values: ReadonlyArray<DecommissionGateReason>): ReadonlyArray<DecommissionGateReason> => {
  return Array.from(new Set(values));
};

export const evaluateDecommissionStabilityGate = (input: StabilityGateInput): StabilityGateResult => {
  const reasons: DecommissionGateReason[] = [];

  // D-01: fail closed unless 7 full-cohort calendar days are observed.
  if (input.daysObserved < REQUIRED_STABILITY_DAYS) {
    reasons.push('insufficient_days_observed');
  }

  // D-02 and D-03: every observed day must carry explicit regression/smoke/SLO evidence.
  for (let index = 0; index < input.daysObserved; index += 1) {
    const day = input.dailyEvidence[index];
    if (!day) {
      reasons.push('missing_daily_evidence');
      continue;
    }

    reasons.push(...evaluateDayEvidence(day));
  }

  const dedupedReasons = unique(reasons);

  return {
    pass: dedupedReasons.length === 0,
    reasons: dedupedReasons,
  };
};