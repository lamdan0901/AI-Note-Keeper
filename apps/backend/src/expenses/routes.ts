import type { RequestHandler } from 'express';
import { Router } from 'express';

import {
  requireAccessUserOrWebGuest,
  type AuthenticatedRequest,
} from '../auth/access-middleware.js';
import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import {
  createExpensePeriodBodySchema,
  createExpenseRowBodySchema,
  expensePeriodByMonthQuerySchema,
  expensePeriodIdParamsSchema,
  expenseRowIdParamsSchema,
  patchExpensePeriodSchemaBodySchema,
  patchExpenseRowBodySchema,
  updateExpenseSettingsBodySchema,
  type ExpenseCells,
  type ExpenseTableSchema,
} from './contracts.js';
import { createExpensesService, type ExpensesService } from './service.js';

type ExpensesRoutesDeps = Readonly<{
  service?: ExpensesService;
  requireAccess?: RequestHandler;
}>;

const getUserId = (request: AuthenticatedRequest): string => {
  return request.authUser.userId;
};

export const createExpensesRoutes = (deps: ExpensesRoutesDeps = {}): Router => {
  const service = deps.service ?? createExpensesService();
  const requireAccess = deps.requireAccess ?? requireAccessUserOrWebGuest();
  const router = Router();

  router.get(
    '/settings',
    requireAccess,
    withErrorBoundary(async (request, response) => {
      const settings = await service.getOrCreateSettings({
        userId: getUserId(request as AuthenticatedRequest),
      });
      response.status(200).json({ settings });
    }),
  );

  router.put(
    '/settings',
    requireAccess,
    validateRequest({ body: updateExpenseSettingsBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const body = request.body as Readonly<{
        defaultSchema: ExpenseTableSchema;
        seedRows?: ReadonlyArray<{
          expense: string;
          amount?: number;
          comment?: string;
        }>;
      }>;

      const settings = await service.updateSettings({
        userId,
        defaultSchema: body.defaultSchema,
        seedRows: body.seedRows,
      });

      response.status(200).json({ settings });
    }),
  );

  router.get(
    '/periods',
    requireAccess,
    withErrorBoundary(async (request, response) => {
      const periods = await service.listPeriodSummaries({
        userId: getUserId(request as AuthenticatedRequest),
      });
      response.status(200).json({ periods });
    }),
  );

  router.get(
    '/periods/current',
    requireAccess,
    withErrorBoundary(async (request, response) => {
      const result = await service.getOrCreateCurrentPeriod({
        userId: getUserId(request as AuthenticatedRequest),
      });
      response.status(200).json(result);
    }),
  );

  router.get(
    '/periods/by-month',
    requireAccess,
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const parsedQuery = expensePeriodByMonthQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new AppError({
          code: 'validation',
          details: {
            issues: parsedQuery.error.issues.map((issue) => ({
              path: issue.path.join('.') || 'query',
              message: issue.message,
              code: issue.code,
            })),
          },
        });
      }

      const { year, month } = parsedQuery.data;

      const result = await service.findPeriodByMonth({ userId, year, month });
      if (!result) {
        throw new AppError({
          code: 'not_found',
          message: `Expense period not found for ${year}-${month}`,
        });
      }

      response.status(200).json(result);
    }),
  );

  router.post(
    '/periods',
    requireAccess,
    validateRequest({ body: createExpensePeriodBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const body = request.body as Readonly<{ year: number; month: number }>;

      const result = await service.createPeriod({
        userId,
        year: body.year,
        month: body.month,
      });

      response.status(201).json(result);
    }),
  );

  router.get(
    '/periods/:periodId/trash',
    requireAccess,
    validateRequest({ params: expensePeriodIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { periodId } = request.params as Readonly<{ periodId: string }>;

      const rows = await service.listTrashRows({ periodId, userId });
      response.status(200).json({ rows });
    }),
  );

  router.get(
    '/periods/:periodId/trash',
    requireAccess,
    validateRequest({ params: expensePeriodIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { periodId } = request.params as Readonly<{ periodId: string }>;

      const rows = await service.listTrashRows({ periodId, userId });
      response.status(200).json({ rows });
    }),
  );

  router.get(
    '/periods/:periodId',
    requireAccess,
    validateRequest({ params: expensePeriodIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { periodId } = request.params as Readonly<{ periodId: string }>;

      const result = await service.getPeriodWithRows({ periodId, userId });
      response.status(200).json(result);
    }),
  );

  router.patch(
    '/periods/:periodId/schema',
    requireAccess,
    validateRequest({
      params: expensePeriodIdParamsSchema,
      body: patchExpensePeriodSchemaBodySchema,
    }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { periodId } = request.params as Readonly<{ periodId: string }>;
      const body = request.body as Readonly<{ schema: ExpenseTableSchema }>;

      const period = await service.updatePeriodSchema({
        periodId,
        userId,
        schema: body.schema,
      });

      response.status(200).json({ period });
    }),
  );

  router.post(
    '/periods/:periodId/rows',
    requireAccess,
    validateRequest({
      params: expensePeriodIdParamsSchema,
      body: createExpenseRowBodySchema,
    }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { periodId } = request.params as Readonly<{ periodId: string }>;
      const body = request.body as Readonly<{ cells?: ExpenseCells }>;

      const row = await service.createRow({
        periodId,
        userId,
        cells: body.cells,
      });

      response.status(201).json({ row });
    }),
  );

  router.patch(
    '/rows/:rowId',
    requireAccess,
    validateRequest({
      params: expenseRowIdParamsSchema,
      body: patchExpenseRowBodySchema,
    }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { rowId } = request.params as Readonly<{ rowId: string }>;
      const body = request.body as Readonly<{ cells?: ExpenseCells; position?: number }>;

      const row = await service.updateRow({
        rowId,
        userId,
        cells: body.cells,
        position: body.position,
      });

      response.status(200).json({ row });
    }),
  );

  router.delete(
    '/rows/:rowId',
    requireAccess,
    validateRequest({ params: expenseRowIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { rowId } = request.params as Readonly<{ rowId: string }>;

      const row = await service.deleteRow({ rowId, userId });
      response.status(200).json({ row });
    }),
  );

  router.post(
    '/rows/:rowId/restore',
    requireAccess,
    validateRequest({ params: expenseRowIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { rowId } = request.params as Readonly<{ rowId: string }>;

      const row = await service.restoreRow({ rowId, userId });
      response.status(200).json({ row });
    }),
  );

  return router;
};