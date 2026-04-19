export const REQUIRED_STABILITY_DAYS = 7;

export type DecommissionGateReason =
  | 'insufficient_days_observed'
  | 'missing_daily_evidence'
  | 'daily_regression_missing'
  | 'daily_regression_failed'
  | 'daily_smoke_missing'
  | 'daily_smoke_failed'
  | 'daily_slo_missing'
  | 'daily_slo_failed';

export type DailyStabilityEvidence = Readonly<{
  day: string;
  regressionPassed?: boolean;
  smokePassed?: boolean;
  sloPassed?: boolean;
}>;

export type StabilityGateInput = Readonly<{
  daysObserved: number;
  dailyEvidence: ReadonlyArray<DailyStabilityEvidence>;
}>;

export type StabilityGateResult = Readonly<{
  pass: boolean;
  reasons: ReadonlyArray<DecommissionGateReason>;
}>;