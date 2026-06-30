import { withApiHandler } from "@/http/with-api-handler";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async () => ({ message: "Hello from the backend API!" }),
  { requireHealthyDependencies: true, cors: true },
);