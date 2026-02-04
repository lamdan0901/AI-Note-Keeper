import { sha256 } from "js-sha256";

export type ScheduleHashInput = {
  triggerAt: number;
  repeatRule: string;
  active: boolean;
  snoozedUntil?: number | null;
  title?: string | null;
  repeatConfig?: Record<string, unknown> | null;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, stableValue(val)]);
    return Object.fromEntries(entries);
  }
  return value;
};

const normalize = (value: ScheduleHashInput): string =>
  JSON.stringify({
    triggerAt: value.triggerAt,
    repeatRule: value.repeatRule,
    active: value.active,
    snoozedUntil: value.snoozedUntil ?? null,
    title: value.title ?? null,
    repeatConfig: value.repeatConfig ? stableValue(value.repeatConfig) : null,
  });

export const computeScheduleHash = (value: ScheduleHashInput): string => {
  const payload = normalize(value);
  return sha256(payload);
};
