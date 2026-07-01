import { NextResponse } from "next/server";

import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createCreateRowHandler } from "@/handlers/expenses/create-row";
import {
  createExpenseRowBodySchema,
  expensePeriodIdParamsSchema,
} from "@/handlers/expenses/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const createRowHandler = withApiHandler(
  async (ctx) => {
    const handler = createCreateRowHandler((await getComposedServices()).expensesService);
    const result = await handler(toAuthenticatedContext(ctx));
    return NextResponse.json(result, { status: 201 });
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: {
      params: expensePeriodIdParamsSchema,
      body: createExpenseRowBodySchema,
    },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = createRowHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });