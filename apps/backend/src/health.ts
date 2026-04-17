export type HealthStatus = {
  ok: true;
  service: 'backend';
};

export function createHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: 'backend',
  };
}
