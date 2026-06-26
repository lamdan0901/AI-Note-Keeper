import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";

import {
  applyCorsHeaders,
  createIsAllowedOrigin,
  handleCorsPreflight,
  resolveEffectiveAllowedOrigins,
} from "../src/http/cors";
import { withApiHandler } from "../src/http/with-api-handler";

const restoreEnv = (
  snapshot: Readonly<{ nodeEnv?: string; corsAllowedOrigins?: string }>,
): void => {
  if (snapshot.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = snapshot.nodeEnv;
  }

  if (snapshot.corsAllowedOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = snapshot.corsAllowedOrigins;
  }
};

const snapshotEnv = (): Readonly<{ nodeEnv?: string; corsAllowedOrigins?: string }> => ({
  nodeEnv: process.env.NODE_ENV,
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
});

afterEach(() => {
  // Individual tests restore their own env; this is a safety net for failures.
});

test("resolveEffectiveAllowedOrigins uses dev defaults when env is unset", () => {
  const snapshot = snapshotEnv();
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  try {
    assert.deepStrictEqual(resolveEffectiveAllowedOrigins(), [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
  } finally {
    restoreEnv(snapshot);
  }
});

test("resolveEffectiveAllowedOrigins denies all in production when env is empty", () => {
  const snapshot = snapshotEnv();
  process.env.NODE_ENV = "production";
  process.env.CORS_ALLOWED_ORIGINS = "";

  try {
    assert.deepStrictEqual(resolveEffectiveAllowedOrigins(), []);
  } finally {
    restoreEnv(snapshot);
  }
});

test("handleCorsPreflight returns 204 with CORS headers for allowed dev origin", () => {
  const snapshot = snapshotEnv();
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  try {
    const request = new NextRequest("http://localhost:3001/api/sample", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    const response = handleCorsPreflight(request);

    assert.ok(response);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.equal(
      response.headers.get("access-control-allow-methods"),
      "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    );
    assert.equal(
      response.headers.get("access-control-allow-headers"),
      "authorization,content-type",
    );
    assert.equal(response.headers.get("vary"), "Origin");
  } finally {
    restoreEnv(snapshot);
  }
});

test("handleCorsPreflight returns 204 without allow-origin for disallowed origin", () => {
  const snapshot = snapshotEnv();
  process.env.NODE_ENV = "production";
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

  try {
    const request = new NextRequest("http://localhost:3001/api/sample", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });

    const response = handleCorsPreflight(request);

    assert.ok(response);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    restoreEnv(snapshot);
  }
});

test("applyCorsHeaders omits allow-origin for disallowed origin on non-preflight", () => {
  const snapshot = snapshotEnv();
  process.env.NODE_ENV = "production";
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

  try {
    const request = new NextRequest("http://localhost:3001/api/sample", {
      headers: { Origin: "https://evil.example.com" },
    });
    const baseResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const response = applyCorsHeaders(request, baseResponse);

    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    restoreEnv(snapshot);
  }
});

test("withApiHandler applies CORS headers on successful responses", async () => {
  const snapshot = snapshotEnv();
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  try {
    const handler = withApiHandler(async () => ({ message: "ok" }));
    const request = new NextRequest("http://localhost:3001/api/sample", {
      headers: { Origin: "http://localhost:5173" },
    });
    const response = await handler(request);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  } finally {
    restoreEnv(snapshot);
  }
});

test("withApiHandler short-circuits OPTIONS preflight before handler", async () => {
  const snapshot = snapshotEnv();
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  try {
    let handlerInvoked = false;
    const handler = withApiHandler(async () => {
      handlerInvoked = true;
      return { shouldNotRun: true };
    });

    const request = new NextRequest("http://localhost:3001/api/sample", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    });
    const response = await handler(request);

    assert.equal(handlerInvoked, false);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  } finally {
    restoreEnv(snapshot);
  }
});

test("createIsAllowedOrigin returns false for every origin when production list is empty", () => {
  const snapshot = snapshotEnv();
  process.env.NODE_ENV = "production";
  process.env.CORS_ALLOWED_ORIGINS = "";

  try {
    const isAllowedOrigin = createIsAllowedOrigin();
    assert.equal(isAllowedOrigin("http://localhost:5173"), false);
    assert.equal(isAllowedOrigin("https://app.example.com"), false);
  } finally {
    restoreEnv(snapshot);
  }
});