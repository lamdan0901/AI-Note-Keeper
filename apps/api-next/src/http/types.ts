import type { NextRequest, NextResponse } from "next/server";

export type AuthUser = Readonly<{
  userId: string;
  username: string;
}>;

export type RequestContext = Readonly<{
  request: NextRequest;
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
  cookies: Readonly<Record<string, string>>;
  clientIp: string | null;
  forwardedProto: string | null;
  authUser?: AuthUser;
}>;

export type AuthenticatedContext = RequestContext & Readonly<{ authUser: AuthUser }>;

export type RouteContext = Readonly<{
  params: Promise<Readonly<Record<string, string>>>;
}>;

export const EMPTY_ROUTE_CONTEXT: RouteContext = {
  params: Promise.resolve({}),
};

export type PostHandlerHook = (
  ctx: RequestContext,
  response: NextResponse,
  result?: unknown,
) => NextResponse | void | Promise<NextResponse | void>;