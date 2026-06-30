import { NextResponse } from "next/server";

import { evaluateReadiness } from "@/server/backend-alias-smoke";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "api-next",
    backendAliasResolved: typeof evaluateReadiness === "function",
  });
}