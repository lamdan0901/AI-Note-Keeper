export const cutoverCohortOrder = ['shadow', 'pilot', 'ramp', 'full'] as const;

export type CutoverCohort = (typeof cutoverCohortOrder)[number];

export type CutoverGateInput = Readonly<{
  cohort: CutoverCohort;
  parityPassed: boolean;
  sloPassed: boolean;
  rollbackDrillPassed: boolean;
}>;

export type CutoverGateResult = Readonly<{
  canAdvance: boolean;
  reason?: string;
}>;

export type CutoverConfig = Readonly<{
  cohort: CutoverCohort;
  requireParity: boolean;
  requireSlo: boolean;
  requireRollbackDrill: boolean;
}>;

export type CohortTransitionInput = Readonly<{
  currentCohort: CutoverCohort;
  targetCohort: CutoverCohort;
  parityPassed: boolean;
  sloPassed: boolean;
  rollbackDrillPassed: boolean;
}>;

const parseCutoverCohort = (value: string | undefined): CutoverCohort => {
  if (!value) {
    throw new Error('VITE_CUTOVER_COHORT is required');
  }

  if ((cutoverCohortOrder as readonly string[]).includes(value)) {
    return value as CutoverCohort;
  }

  throw new Error(`Unsupported VITE_CUTOVER_COHORT value: ${value}`);
};

const parseBooleanFlag = (name: string, value: string | undefined): boolean => {
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
};

export const readWebCutoverConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): CutoverConfig => {
  return {
    cohort: parseCutoverCohort(env.VITE_CUTOVER_COHORT),
    requireParity: parseBooleanFlag('VITE_CUTOVER_REQUIRE_PARITY', env.VITE_CUTOVER_REQUIRE_PARITY),
    requireSlo: parseBooleanFlag('VITE_CUTOVER_REQUIRE_SLO', env.VITE_CUTOVER_REQUIRE_SLO),
    requireRollbackDrill: parseBooleanFlag(
      'VITE_CUTOVER_REQUIRE_ROLLBACK_DRILL',
      env.VITE_CUTOVER_REQUIRE_ROLLBACK_DRILL,
    ),
  };
};

export const evaluateCutoverGate = (
  input: CutoverGateInput,
  config: CutoverConfig,
): CutoverGateResult => {
  if (config.requireParity && !input.parityPassed) {
    return { canAdvance: false, reason: 'parity_failed' };
  }

  if (config.requireSlo && !input.sloPassed) {
    return { canAdvance: false, reason: 'slo_failed' };
  }

  if (config.requireRollbackDrill && !input.rollbackDrillPassed) {
    return { canAdvance: false, reason: 'rollback_drill_incomplete' };
  }

  return { canAdvance: true };
};

export const evaluateWebCohortTransition = (
  input: CohortTransitionInput,
  config: CutoverConfig,
): CutoverGateResult => {
  const currentIndex = cutoverCohortOrder.indexOf(input.currentCohort);
  const targetIndex = cutoverCohortOrder.indexOf(input.targetCohort);

  if (currentIndex === -1 || targetIndex === -1) {
    return { canAdvance: false, reason: 'invalid_cohort' };
  }

  if (targetIndex > currentIndex + 1) {
    return { canAdvance: false, reason: 'cohort_order_blocked' };
  }

  return evaluateCutoverGate(
    {
      cohort: input.targetCohort,
      parityPassed: input.parityPassed,
      sloPassed: input.sloPassed,
      rollbackDrillPassed: input.rollbackDrillPassed,
    },
    config,
  );
};
