import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createFindPeriodByMonthHandler } from "@/handlers/expenses/find-period-by-month";
import { expensePeriodByMonthQuerySchema } from "@/handlers/expenses/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const findPeriodByMonthHandler = withApiHandler(
  async (ctx) => {
    const handler = createFindPeriodByMonthHandler(getComposedServices().expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { query: expensePeriodByMonthQuerySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = findPeriodByMonthHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });