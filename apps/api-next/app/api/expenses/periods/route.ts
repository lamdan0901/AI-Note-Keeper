import { NextResponse } from "next/server";

import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createCreatePeriodHandler } from "@/handlers/expenses/create-period";
import { createListPeriodsHandler } from "@/handlers/expenses/list-periods";
import { createExpensePeriodBodySchema } from "@/handlers/expenses/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const listPeriodsHandler = withApiHandler(
  async (ctx) => {
    const handler = createListPeriodsHandler((await getComposedServices()).expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

const createPeriodHandler = withApiHandler(
  async (ctx) => {
    const handler = createCreatePeriodHandler((await getComposedServices()).expensesService);
    const result = await handler(toAuthenticatedContext(ctx));
    return NextResponse.json(result, { status: 201 });
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { body: createExpensePeriodBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = listPeriodsHandler;
export const POST = createPeriodHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });