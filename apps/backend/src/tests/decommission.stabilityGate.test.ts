import assert from 'node:assert/strict';
import test from 'node:test';

import { REQUIRED_STABILITY_DAYS, type DailyStabilityEvidence } from '../decommission/contracts.js';
import { evaluateDecommissionStabilityGate } from '../decommission/stabilityGate.js';

const buildEvidence = (
  overrides: Partial<DailyStabilityEvidence> = {},
  dayIndex = 1,
): DailyStabilityEvidence => {
  return {
    day: `2026-04-${String(dayIndex).padStart(2, '0')}`,
    regressionPassed: true,
    smokePassed: true,
    sloPassed: true,
    ...overrides,
  };
};

test('fails when observed days are fewer than the required seven-day window', () => {
  const evidence = Array.from({ length: REQUIRED_STABILITY_DAYS - 1 }, (_, index) =>
    buildEvidence({}, index + 1),
  );

  const result = evaluateDecommissionStabilityGate({
    daysObserved: REQUIRED_STABILITY_DAYS - 1,
    dailyEvidence: evidence,
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.reasons, ['insufficient_days_observed']);
});

test('fails when any day is missing regression or smoke evidence', () => {
  const evidence = Array.from({ length: REQUIRED_STABILITY_DAYS }, (_, index) =>
    buildEvidence({}, index + 1),
  );

  evidence[2] = buildEvidence({ regressionPassed: undefined }, 3);
  evidence[4] = buildEvidence({ smokePassed: undefined }, 5);

  const result = evaluateDecommissionStabilityGate({
    daysObserved: REQUIRED_STABILITY_DAYS,
    dailyEvidence: evidence,
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.reasons, ['daily_regression_missing', 'daily_smoke_missing']);
});

test('fails when any day violates slo pass criteria', () => {
  const evidence = Array.from({ length: REQUIRED_STABILITY_DAYS }, (_, index) =>
    buildEvidence({}, index + 1),
  );

  evidence[6] = buildEvidence({ sloPassed: false }, 7);

  const result = evaluateDecommissionStabilityGate({
    daysObserved: REQUIRED_STABILITY_DAYS,
    dailyEvidence: evidence,
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.reasons, ['daily_slo_failed']);
});

test('passes when all seven days contain explicit pass evidence', () => {
  const evidence = Array.from({ length: REQUIRED_STABILITY_DAYS }, (_, index) =>
    buildEvidence({}, index + 1),
  );

  const result = evaluateDecommissionStabilityGate({
    daysObserved: REQUIRED_STABILITY_DAYS,
    dailyEvidence: evidence,
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});