import type { ComposedServices } from "@/server/compose-services";

export type MaintenanceTelemetry = Readonly<{
  remindersRepair: boolean;
  subscriptionsDispatch: boolean;
  pushRetryCallback: boolean;
}>;

/**
 * Reports whether Phase 5 maintenance paths are wired in composition.
 * Test-only telemetry — not exposed on public /health/ready responses.
 */
export const getMaintenanceTelemetry = (services: ComposedServices): MaintenanceTelemetry => ({
  remindersRepair: services.reminderRepairJob !== undefined,
  subscriptionsDispatch: services.subscriptionReminderDispatchJob !== undefined,
  pushRetryCallback:
    services.pushJobHandler !== undefined &&
    services.pushRetryScheduler !== undefined &&
    services.pushQstashVerifierConfig !== undefined,
});