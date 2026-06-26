import type { NextRequest } from "next/server";

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
}>;

export type RouteContext = Readonly<{
  params?: Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
}>;