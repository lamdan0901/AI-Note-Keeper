import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";

import { AppError } from "@backend/middleware/error-middleware";

import { toErrorResponse } from "../../src/http/errors";

import { GET as sampleHandler } from "../../app/api/sample/route";
import { GET as healthLiveHandler } from "../../app/health/live/route";
import { GET as healthReadyHandler } from "../../app/health/ready/route";
import type { RouteContext } from "../../src/http/types";

export type RouteHandler = (
  request: NextRequest,
  routeContext?: RouteContext,
) => Promise<Response>;

export type RouteRegistration = Readonly<{
  method: string;
  pathname: string;
  handler: RouteHandler;
  /** Dynamic segment pattern (e.g. `/api/notes/:noteId/restore`). */
  pattern?: string;
  /** Preserve exact raw request body bytes (for QStash signature verification etc.). */
  rawBody?: boolean;
}>;

export type NextTestServer = Readonly<{
  baseUrl: string;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}>;

export type StartNextTestServerOptions = Readonly<{
  routes?: ReadonlyArray<RouteRegistration>;
  readyTimeoutMs?: number;
  readyProbePath?: string;
}>;

const defaultRoutes: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/health/live", handler: healthLiveHandler },
  { method: "GET", pathname: "/health/ready", handler: healthReadyHandler },
  { method: "GET", pathname: "/api/sample", handler: sampleHandler },
];

const buildRouteKey = (method: string, pathname: string): string => {
  return `${method.toUpperCase()} ${pathname}`;
};

type ResolvedRoute = Readonly<{
  handler: RouteHandler;
  params: Readonly<Record<string, string>>;
  rawBody?: boolean;
}>;

const isDynamicSegment = (segment: string): boolean => {
  return segment.startsWith(":") && segment.length > 1;
};

const matchRoutePattern = (
  pattern: string,
  pathname: string,
): Readonly<Record<string, string>> | null => {
  const patternSegments = pattern.split("/").filter((segment) => segment.length > 0);
  const pathSegments = pathname.split("/").filter((segment) => segment.length > 0);

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];

    if (isDynamicSegment(patternSegment)) {
      params[patternSegment.slice(1)] = pathSegment;
      continue;
    }

    if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return params;
};

const buildRouteMap = (
  routes: ReadonlyArray<RouteRegistration>,
): ReadonlyMap<string, RouteHandler> => {
  const map = new Map<string, RouteHandler>();

  for (const route of routes) {
    if (!route.pattern) {
      map.set(buildRouteKey(route.method, route.pathname), route.handler);
    }
  }

  return map;
};

// Track rawBody intent for direct (non-pattern) routes by key.
const buildRawBodyDirectMap = (
  routes: ReadonlyArray<RouteRegistration>,
): ReadonlyMap<string, boolean> => {
  const map = new Map<string, boolean>();
  for (const route of routes) {
    if (!route.pattern && route.rawBody) {
      map.set(buildRouteKey(route.method, route.pathname), true);
    }
  }
  return map;
};

const buildPatternRoutes = (
  routes: ReadonlyArray<RouteRegistration>,
): ReadonlyArray<RouteRegistration> => {
  return routes.filter((route) => route.pattern !== undefined);
};

const readRequestBody = async (request: IncomingMessage): Promise<Buffer | undefined> => {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Array<Buffer> = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
};

const toNextRequest = async (
  incoming: IncomingMessage,
  baseUrl: string,
  /** When true, body is passed as the original text string to preserve byte-for-byte fidelity (e.g. QStash signatures). */
  preserveRawBody = false,
): Promise<NextRequest> => {
  const url = new URL(incoming.url ?? "/", baseUrl);
  const headers = new Headers();

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    headers.set(key, value);
  }

  const body = await readRequestBody(incoming);
  const rawBodyText = body ? body.toString("utf8") : undefined;

  // Use the original string when raw preservation is requested.
  // This avoids any Uint8Array round-tripping that could affect signature verification.
  const bodyInit = preserveRawBody && rawBodyText !== undefined ? rawBodyText : rawBodyText !== undefined ? new Uint8Array(body!) : undefined;

  return new NextRequest(url, {
    method: incoming.method,
    headers,
    body: bodyInit,
  });
};

const writeResponse = async (nodeResponse: ServerResponse, response: Response): Promise<void> => {
  nodeResponse.statusCode = response.status;

  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });

  const body = Buffer.from(await response.arrayBuffer());
  nodeResponse.end(body);
};

const resolveRoute = (
  routeMap: ReadonlyMap<string, RouteHandler>,
  patternRoutes: ReadonlyArray<RouteRegistration>,
  method: string,
  pathname: string,
): ResolvedRoute | undefined => {
  const normalizedMethod = method.toUpperCase();
  const direct = routeMap.get(buildRouteKey(normalizedMethod, pathname));
  if (direct) {
    // Direct routes don't have rawBody flag attached here; caller can fall back to registration scan if needed.
    return { handler: direct, params: {} };
  }

  for (const route of patternRoutes) {
    if (route.method.toUpperCase() !== normalizedMethod || !route.pattern) {
      continue;
    }

    const params = matchRoutePattern(route.pattern, pathname);
    if (params) {
      return { handler: route.handler, params, rawBody: route.rawBody };
    }
  }

  if (normalizedMethod === "OPTIONS") {
    return resolveRoute(routeMap, patternRoutes, "GET", pathname);
  }

  return undefined;
};

const waitForServerReady = async (
  fetchFn: (pathname: string) => Promise<Response>,
  pathname: string,
  deadlineMs: number,
): Promise<void> => {
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(pathname);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the in-process server accepts connections.
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for Next test server readiness at ${pathname}`);
};

/**
 * In-process contract-test server for api-next route handlers.
 *
 * Dispatches HTTP requests to App Router `route.ts` exports over an ephemeral
 * localhost port (no `next dev` on :3001). Phase 1 auth routes can register
 * additional handlers via `routes`.
 */
export const startNextTestServer = async (
  options: StartNextTestServerOptions = {},
): Promise<NextTestServer> => {
  const routes = [...defaultRoutes, ...(options.routes ?? [])];
  const routeMap = buildRouteMap(routes);
  const rawBodyDirectMap = buildRawBodyDirectMap(routes);
  const patternRoutes = buildPatternRoutes(routes);
  const readyTimeoutMs = options.readyTimeoutMs ?? 5_000;
  const readyProbePath = options.readyProbePath ?? "/health/live";

  const server = await new Promise<Server>((resolve, reject) => {
    const httpServer = createServer((incoming, nodeResponse) => {
      void (async () => {
        try {
          const address = httpServer.address();
          if (!address || typeof address === "string") {
            throw new Error("Expected TCP server address info for Next test server");
          }

          const baseUrl = `http://127.0.0.1:${address.port}`;
          const requestUrl = new URL(incoming.url ?? "/", baseUrl);
          const resolved = resolveRoute(
            routeMap,
            patternRoutes,
            incoming.method ?? "GET",
            requestUrl.pathname,
          );

          if (!resolved) {
            const notFoundResponse = toErrorResponse(
              new AppError({ code: "not_found" }),
              new NextRequest(requestUrl, { method: incoming.method ?? "GET" }),
            );
            await writeResponse(nodeResponse, notFoundResponse);
            return;
          }

          const directRaw = rawBodyDirectMap.get(
            buildRouteKey((incoming.method ?? "GET").toUpperCase(), requestUrl.pathname),
          );
          const wantsRaw = resolved.rawBody === true || directRaw === true;

          const request = await toNextRequest(incoming, baseUrl, wantsRaw);
          const response = await resolved.handler(request, {
            params: Promise.resolve(resolved.params),
          });
          await writeResponse(nodeResponse, response);
        } catch (error) {
          nodeResponse.statusCode = 500;
          nodeResponse.end(
            error instanceof Error ? error.message : "Next test server handler failed",
          );
        }
      })();
    });

    httpServer.listen(0, "127.0.0.1", () => resolve(httpServer));
    httpServer.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address info for Next test server");
  }

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  const fetchFromServer = (pathname: string, init?: RequestInit): Promise<Response> => {
    const url = pathname.startsWith("http") ? pathname : `${baseUrl}${pathname}`;
    return fetch(url, init);
  };

  await waitForServerReady(fetchFromServer, readyProbePath, readyTimeoutMs);

  return {
    baseUrl,
    fetch: fetchFromServer,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

export const getHealthLive = (server: NextTestServer): Promise<Response> => {
  return server.fetch("/health/live");
};

export const getHealthReady = (server: NextTestServer): Promise<Response> => {
  return server.fetch("/health/ready");
};

export const getSample = (server: NextTestServer): Promise<Response> => {
  return server.fetch("/api/sample");
};

/**
 * Helper for registering the internal QStash scheduled-task route (and similar raw-body routes).
 * Pass this in the `routes` array to startNextTestServer.
 */
export const createInternalRawRoute = (
  method: string,
  pathname: string,
  handler: RouteHandler,
): RouteRegistration => ({
  method,
  pathname,
  handler,
  rawBody: true,
});