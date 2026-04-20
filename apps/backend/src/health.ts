import type { RequestHandler } from 'express';

import { AppError } from './middleware/error-middleware.js';

export type HealthStatus = Readonly<{
  ok: true;
  service: 'backend';
}>;

export function createHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: 'backend',
  };
}

export const createDependencyGate = (isDependencyDegraded: () => boolean): RequestHandler => {
  return (_request, _response, next) => {
    if (isDependencyDegraded()) {
      next(new AppError({ code: 'internal' }));
      return;
    }

    next();
  };
};