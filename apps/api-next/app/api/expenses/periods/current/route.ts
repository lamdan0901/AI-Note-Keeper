import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createGetCurrentPeriodHandler } from "@/handlers/expenses/get-current-period";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const getCurrentPeriodHandler = withApiHandler(
  async (ctx) => {
    const handler = createGetCurrentPeriodHandler(getComposedServices().expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = getCurrentPeriodHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });