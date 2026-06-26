/**
 * Task 1.15 — simulates Vite web client auth cookie flow against api-next.
 * Not committed as a permanent test; run manually during Phase 1 verification.
 */
const API_BASE = "http://localhost:3001";
const WEB_ORIGIN = "http://localhost:5173";

const results = [];

const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`${mark}: ${name}${detail ? ` — ${detail}` : ""}`);
};

const parseCookieHeader = (setCookieHeaders) => {
  const jar = new Map();
  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    jar.set(key, value);
  }
  return jar;
};

const extractSetCookies = (response) => {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
};

const cookieHeaderFromJar = (jar) =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

const authHeaders = {
  "content-type": "application/json",
  "x-client-platform": "web",
  Origin: WEB_ORIGIN,
};

const username = `webverify-${Date.now()}`;
const password = "password-123-verify";

// 1. CORS preflight
const preflight = await fetch(`${API_BASE}/api/auth/login`, {
  method: "OPTIONS",
  headers: {
    Origin: WEB_ORIGIN,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type,x-client-platform",
  },
});

record(
  "CORS preflight status 204",
  preflight.status === 204,
  `status=${preflight.status}`,
);
record(
  "CORS Allow-Origin matches Vite",
  preflight.headers.get("access-control-allow-origin") === WEB_ORIGIN,
  preflight.headers.get("access-control-allow-origin") ?? "(missing)",
);
record(
  "CORS Allow-Credentials true",
  preflight.headers.get("access-control-allow-credentials") === "true",
  preflight.headers.get("access-control-allow-credentials") ?? "(missing)",
);

// 2. Register (sets initial cookie)
const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ username, password }),
});

const registerBody = await registerRes.json().catch(() => null);
const registerCookies = extractSetCookies(registerRes);
const jar = parseCookieHeader(registerCookies);

record("Register succeeds", registerRes.status === 201, `status=${registerRes.status}`);
record(
  "Register sets ank_refresh_token cookie",
  jar.has("ank_refresh_token") && jar.get("ank_refresh_token").length > 0,
  registerCookies.join(" | ") || "(no Set-Cookie)",
);
record(
  "Register cookie is HttpOnly",
  registerCookies.some((c) => /httponly/i.test(c)),
  registerCookies[0] ?? "(none)",
);
record(
  "Register response has accessToken",
  typeof registerBody?.accessToken === "string" && registerBody.accessToken.length > 0,
  registerBody?.accessToken ? "present" : "missing",
);

const initialRefresh = jar.get("ank_refresh_token");

// 3. Refresh with cookie only (empty body)
const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
  method: "POST",
  headers: {
    ...authHeaders,
    cookie: cookieHeaderFromJar(jar),
  },
  body: JSON.stringify({}),
});

const refreshBody = await refreshRes.json().catch(() => null);
const refreshCookies = extractSetCookies(refreshRes);
const refreshJar = parseCookieHeader(refreshCookies);
const rotatedRefresh = refreshJar.get("ank_refresh_token");

record("Refresh succeeds with cookie only", refreshRes.status === 200, `status=${refreshRes.status}`);
record(
  "Refresh rotates ank_refresh_token",
  typeof rotatedRefresh === "string" &&
    rotatedRefresh.length > 0 &&
    rotatedRefresh !== initialRefresh,
  rotatedRefresh ? "new token issued" : "no rotation",
);
record(
  "Refresh returns new accessToken",
  typeof refreshBody?.accessToken === "string" && refreshBody.accessToken.length > 0,
  refreshBody?.accessToken ? "present" : "missing",
);

// Use rotated cookie for logout
if (rotatedRefresh) {
  jar.set("ank_refresh_token", rotatedRefresh);
}

// 4. Logout clears cookie
const logoutRes = await fetch(`${API_BASE}/api/auth/logout`, {
  method: "POST",
  headers: {
    ...authHeaders,
    cookie: cookieHeaderFromJar(jar),
  },
  body: JSON.stringify({}),
});

const logoutCookies = extractSetCookies(logoutRes);
const logoutJar = parseCookieHeader(logoutCookies);
const clearedValue = logoutJar.get("ank_refresh_token");

record("Logout succeeds", logoutRes.status === 204, `status=${logoutRes.status}`);
record(
  "Logout clears ank_refresh_token",
  logoutCookies.some((c) => c.includes("ank_refresh_token=")) &&
    (clearedValue === "" || /max-age=0/i.test(logoutCookies.join("; "))),
  logoutCookies.join(" | ") || "(no Set-Cookie)",
);

// 5. Post-logout refresh should fail
const postLogoutRefresh = await fetch(`${API_BASE}/api/auth/refresh`, {
  method: "POST",
  headers: {
    ...authHeaders,
    cookie: cookieHeaderFromJar(jar),
  },
  body: JSON.stringify({}),
});

record(
  "Refresh fails after logout",
  postLogoutRefresh.status === 401,
  `status=${postLogoutRefresh.status}`,
);

const failed = results.filter((r) => !r.passed);
console.log(`\n--- Summary: ${results.length - failed.length}/${results.length} passed ---`);
if (failed.length > 0) {
  process.exit(1);
}