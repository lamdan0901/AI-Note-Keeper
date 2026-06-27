import { NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/http/errors";
import { readRawJsonBody } from "@/http/raw-body";

import {
  createScheduledTaskHandler,
  type ScheduledTaskHandlerDeps,
} from "./scheduled-task";

export const createScheduledTaskPostHandler = (deps: ScheduledTaskHandlerDeps) => {
  const handler = createScheduledTaskHandler(deps);

  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { rawBody, json } = await readRawJsonBody(request);
      const signature = request.headers.get("Upstash-Signature") ?? undefined;
      const result = await handler({
        rawBody,
        signature,
        parsedBody: json,
      });

      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      return toErrorResponse(error, request);
    }
  };
};