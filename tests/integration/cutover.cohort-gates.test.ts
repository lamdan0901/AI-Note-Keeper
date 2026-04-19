import { describe, expect, it } from '@jest/globals';

import {
  evaluateCutoverGate as evaluateWebCutoverGate,
  evaluateWebCohortTransition,
  readWebCutoverConfig,
  type CutoverConfig as WebCutoverConfig,
} from '../../apps/web/src/config/cutover';
import {
  evaluateCutoverGate as evaluateMobileCutoverGate,
  evaluateMobileCohortTransition,
  readMobileCutoverConfig,
  type CutoverConfig as MobileCutoverConfig,
} from '../../apps/mobile/src/config/cutover';

const webConfig: WebCutoverConfig = {
  cohort: 'pilot',
  requireParity: true,
  requireSlo: true,
  requireRollbackDrill: true,
};

const mobileConfig: MobileCutoverConfig = {
  cohort: 'pilot',
  requireParity: true,
  requireSlo: true,
  requireRollbackDrill: true,
};

describe('cutover cohort gates', () => {
  it('config parsing rejects unknown cohorts and missing gate env vars', () => {
    expect(() =>
      readWebCutoverConfig({
        VITE_CUTOVER_COHORT: 'unknown',
        VITE_CUTOVER_REQUIRE_PARITY: 'true',
        VITE_CUTOVER_REQUIRE_SLO: 'true',
        VITE_CUTOVER_REQUIRE_ROLLBACK_DRILL: 'true',
      }),
    ).toThrow('Unsupported VITE_CUTOVER_COHORT value');

    expect(() =>
      readMobileCutoverConfig({
        EXPO_PUBLIC_CUTOVER_COHORT: 'pilot',
        EXPO_PUBLIC_CUTOVER_REQUIRE_PARITY: 'true',
        EXPO_PUBLIC_CUTOVER_REQUIRE_SLO: undefined,
        EXPO_PUBLIC_CUTOVER_REQUIRE_ROLLBACK_DRILL: 'true',
      }),
    ).toThrow('EXPO_PUBLIC_CUTOVER_REQUIRE_SLO is required');
  });

  it('canAdvance=true only when parity, slo, and rollback drill all pass', () => {
    const webResult = evaluateWebCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: true,
        sloPassed: true,
        rollbackDrillPassed: true,
      },
      webConfig,
    );

    const mobileResult = evaluateMobileCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: true,
        sloPassed: true,
        rollbackDrillPassed: true,
      },
      mobileConfig,
    );

    expect(webResult).toEqual({ canAdvance: true });
    expect(mobileResult).toEqual({ canAdvance: true });
  });

  it('returns deterministic blocked reasons for each failed gate', () => {
    const webParity = evaluateWebCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: false,
        sloPassed: true,
        rollbackDrillPassed: true,
      },
      webConfig,
    );
    const webSlo = evaluateWebCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: true,
        sloPassed: false,
        rollbackDrillPassed: true,
      },
      webConfig,
    );
    const webRollback = evaluateWebCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: true,
        sloPassed: true,
        rollbackDrillPassed: false,
      },
      webConfig,
    );

    expect(webParity).toEqual({ canAdvance: false, reason: 'parity_failed' });
    expect(webSlo).toEqual({ canAdvance: false, reason: 'slo_failed' });
    expect(webRollback).toEqual({ canAdvance: false, reason: 'rollback_drill_incomplete' });

    const mobileParity = evaluateMobileCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: false,
        sloPassed: true,
        rollbackDrillPassed: true,
      },
      mobileConfig,
    );
    const mobileSlo = evaluateMobileCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: true,
        sloPassed: false,
        rollbackDrillPassed: true,
      },
      mobileConfig,
    );
    const mobileRollback = evaluateMobileCutoverGate(
      {
        cohort: 'pilot',
        parityPassed: true,
        sloPassed: true,
        rollbackDrillPassed: false,
      },
      mobileConfig,
    );

    expect(mobileParity).toEqual({ canAdvance: false, reason: 'parity_failed' });
    expect(mobileSlo).toEqual({ canAdvance: false, reason: 'slo_failed' });
    expect(mobileRollback).toEqual({ canAdvance: false, reason: 'rollback_drill_incomplete' });
  });

  it('prevents skipping directly to full cohort rollout', () => {
    const webResult = evaluateWebCohortTransition(
      {
        currentCohort: 'shadow',
        targetCohort: 'full',
        parityPassed: true,
        sloPassed: true,
        rollbackDrillPassed: true,
      },
      webConfig,
    );

    const mobileResult = evaluateMobileCohortTransition(
      {
        currentCohort: 'shadow',
        targetCohort: 'full',
        parityPassed: true,
        sloPassed: true,
        rollbackDrillPassed: true,
      },
      mobileConfig,
    );

    expect(webResult).toEqual({ canAdvance: false, reason: 'cohort_order_blocked' });
    expect(mobileResult).toEqual({ canAdvance: false, reason: 'cohort_order_blocked' });
  });
});
