/**
 * Verifies ESM `.js` import specifiers typecheck against backend sources (task 0.3).
 * Not imported by routes — `tsc --noEmit` validates this file directly.
 */
import type { ReadinessStatus } from "@backend/health/readiness.js";
import { evaluateReadiness } from "@backend/health/readiness.js";

export type EsmReadinessStatusProbe = ReadinessStatus;
export type EsmEvaluateReadinessProbe = typeof evaluateReadiness;