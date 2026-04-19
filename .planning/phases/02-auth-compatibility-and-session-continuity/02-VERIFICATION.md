---
phase: 02-auth-compatibility-and-session-continuity
verified: 2026-04-18T11:25:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
gaps: []
---

# Phase 2: Auth Compatibility and Session Continuity Verification Report

**Phase Goal:** Users can authenticate securely under the new token model without lockout or forced re-onboarding.
**Verified:** 2026-04-18T11:25:00Z
**Status:** passed
**Re-verification:** Yes - AUTH-03 remediation verified

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New users can register with unique credentials and receive valid session tokens.                                                     | VERIFIED | Registration flow exists in apps/backend/src/auth/service.ts and uniqueness check is enforced by findByUsername before createUser. Routes return access token and transport-specific refresh handling in apps/backend/src/auth/routes.ts. Backend auth tests passed in npm --workspace apps/backend run test.                                                                                                                                                                                                              |
| 2   | Existing users with legacy salt:sha256 credentials can log in and are lazily upgraded to argon2id.                                   | VERIFIED | Legacy verifier and needsUpgrade signal implemented in apps/backend/src/auth/passwords.ts. Lazy upgrade call to updatePasswordHash is in login flow in apps/backend/src/auth/service.ts. Covered by apps/backend/src/tests/auth/passwords.test.ts.                                                                                                                                                                                                                                                                         |
| 3   | Existing clients holding raw userId sessions can exchange to JWT sessions through upgrade endpoint without forced re-authentication. | VERIFIED | upgrade-session accepts tokenless legacy payloads only when ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN=true, a future LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL is configured, and production additionally sets ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION=true in apps/backend/src/auth/service.ts. Tests cover default-deny, production-deny, migration-window allow, signed-token success, device mismatch rejection, and wrong-issuer rejection in apps/backend/src/tests/auth/service.upgradeSession.test.ts. |
| 4   | Refreshing a session rotates token pair, rejects reuse of prior refresh token, and logout revokes active refresh token.              | VERIFIED | Rotation and replay detection implemented in apps/backend/src/auth/repositories/refresh-tokens-repository.ts and wired via refresh flow in apps/backend/src/auth/service.ts. Logout revokes only located token hash in service.logout. Covered by repository and route tests in apps/backend/src/tests/auth/refresh-tokens-repository.test.ts and apps/backend/src/tests/auth/routes.test.ts.                                                                                                                              |
| 5   | New credential material is generated and verified with argon2id by default.                                                          | VERIFIED | hashPasswordArgon2id uses @node-rs/argon2 and verifyPassword recognizes argon2id hashes in apps/backend/src/auth/passwords.ts; tested in apps/backend/src/tests/auth/passwords.test.ts.                                                                                                                                                                                                                                                                                                                                    |
| 6   | Token signing and verification contracts are explicit for access and refresh payloads.                                               | VERIFIED | AccessTokenPayload and RefreshTokenPayload are distinct in apps/backend/src/auth/contracts.ts and enforced by createTokenFactory in apps/backend/src/auth/tokens.ts; rejection-path tests exist in apps/backend/src/tests/auth/tokens.test.ts.                                                                                                                                                                                                                                                                             |
| 7   | Web auth state uses cookie-backed transport and does not persist refresh tokens to localStorage.                                     | VERIFIED | Web client sends credentials include and platform hint in apps/web/src/auth/httpClient.ts; web session model in apps/web/src/auth/session.ts stores only userId/username/accessToken (no refresh token field). Route transport writes cookie for web in apps/backend/src/auth/http.ts and apps/backend/src/tests/auth/routes.test.ts validates cookie path.                                                                                                                                                                |
| 8   | Mobile auth state uses secure storage token material and continuity-aware bootstrap.                                                 | VERIFIED | SecureStore load/save/clear implemented in apps/mobile/src/auth/session.ts. Mobile auth client and bootstrap integration are wired in apps/mobile/src/auth/httpClient.ts and apps/mobile/src/auth/AuthContext.tsx. Mobile unit tests pass for lifecycle and legacy upgrade payload handling.                                                                                                                                                                                                                               |
| 9   | Refresh/logout preserve multi-session expectations by revoking only current session context.                                         | VERIFIED | refresh rotate updates one token hash row and inserts replacement, logout revokes lookup by current hash only in apps/backend/src/auth/repositories/refresh-tokens-repository.ts and apps/backend/src/auth/service.ts; covered by repository tests for concurrent sessions.                                                                                                                                                                                                                                                |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact                                                        | Expected                                            | Status   | Details                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| apps/backend/src/auth/passwords.ts                              | argon2id + legacy verifier                          | VERIFIED | Substantive implementation and tested behavior for both algorithms.                                                      |
| apps/backend/src/auth/tokens.ts                                 | access/refresh issue + verify + hashing             | VERIFIED | Separate payload contracts, jose verify, and refresh token hashing present.                                              |
| apps/backend/src/auth/repositories/users-repository.ts          | user create/find/update hash                        | VERIFIED | SQL-backed repository methods implemented and consumed by service.                                                       |
| apps/backend/src/auth/repositories/refresh-tokens-repository.ts | multi-session insert/find/revoke/rotate             | VERIFIED | Targeted revoke/rotate semantics with replay detection and tests.                                                        |
| apps/backend/src/auth/service.ts                                | register/login/refresh/logout/upgrade orchestration | VERIFIED | Service flow is substantive and wired; controlled migration-window tokenless upgrade resolves AUTH-03 continuity safely. |
| apps/backend/src/auth/routes.ts                                 | endpoint wiring and transport handling              | VERIFIED | All required endpoints implemented and tested through createApiServer route integration.                                 |
| apps/web/src/auth/httpClient.ts                                 | cookie transport client                             | VERIFIED | Uses credentials include and web platform header for auth endpoints.                                                     |
| apps/web/src/auth/AuthContext.tsx                               | bootstrap/login/register/logout integration         | VERIFIED | Auth API client usage and legacy upgrade invocation implemented.                                                         |
| apps/web/src/auth/session.ts                                    | legacy detection + local session model              | VERIFIED | userId-only legacy detection exists; no refresh-token persistence.                                                       |
| apps/mobile/src/auth/httpClient.ts                              | mobile JSON token transport                         | VERIFIED | Mobile platform header and JSON payload routes implemented.                                                              |
| apps/mobile/src/auth/AuthContext.tsx                            | bootstrap/refresh/upgrade/logout integration        | VERIFIED | Secure-store session + API refresh/upgrade/logout flows are wired.                                                       |
| apps/mobile/src/auth/session.ts                                 | secure store persistence and legacy payload parsing | VERIFIED | SecureStore-based persistence with legacy userId parsing present.                                                        |

### Key Link Verification

| From                                        | To                                                              | Via                                                                    | Status | Details                                                                           |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| apps/backend/src/runtime/createApiServer.ts | apps/backend/src/auth/routes.ts                                 | createAuthRoutes mount on /api/auth                                    | WIRED  | API server mounts auth router directly.                                           |
| apps/backend/src/auth/routes.ts             | apps/backend/src/auth/service.ts                                | injected/default AuthService                                           | WIRED  | createAuthRoutes defaults to createAuthService and handlers call service methods. |
| apps/backend/src/auth/service.ts            | apps/backend/src/auth/repositories/refresh-tokens-repository.ts | insert/rotate/findByTokenHash/revokeById                               | WIRED  | Session issuance, refresh, and logout all invoke repository methods.              |
| apps/backend/src/config.ts                  | apps/backend/src/auth/tokens.ts                                 | readAuthConfig passed into createTokenFactory                          | WIRED  | Token factory reads auth config and validates issuer/audience/secrets.            |
| apps/web/src/auth/AuthContext.tsx           | apps/web/src/auth/httpClient.ts                                 | createWebAuthHttpClient usage in bootstrap/login/register/logout       | WIRED  | Web context calls client methods when API base URL is configured.                 |
| apps/mobile/src/auth/AuthContext.tsx        | apps/mobile/src/auth/httpClient.ts                              | createMobileAuthHttpClient usage in init/login/register/refresh/logout | WIRED  | Mobile context consistently calls mobile client for auth endpoints.               |
| apps/mobile/src/auth/session.ts             | expo-secure-store                                               | SecureStore get/set/delete auth session                                | WIRED  | Session persistence exclusively uses SecureStore APIs.                            |

### Data-Flow Trace (Level 4)

| Artifact                             | Data Variable                            | Source                                                              | Produces Real Data                               | Status                                  |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| apps/backend/src/auth/routes.ts      | session tokens and user identity payload | AuthService results from repository-backed flows                    | Yes (DB queries in repositories)                 | FLOWING                                 |
| apps/backend/src/auth/service.ts     | user/session records                     | createUsersRepository and createRefreshTokensRepository SQL queries | Yes (SELECT/INSERT/UPDATE paths)                 | FLOWING                                 |
| apps/web/src/auth/AuthContext.tsx    | upgraded session on bootstrap            | webAuthClient.upgradeSession -> /api/auth/upgrade-session           | Conditional (explicit migration window required) | FLOWING for AUTH-03 in migration window |
| apps/mobile/src/auth/AuthContext.tsx | refreshed/upgraded auth session          | authHttpClient.refresh/upgradeSession -> /api/auth/\*               | Conditional (explicit migration window required) | FLOWING for AUTH-03 in migration window |

### Behavioral Spot-Checks

| Behavior                                                | Command                                                                                                             | Result                                                                                                         | Status |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| Backend auth flows and contracts execute                | npm --workspace apps/backend run test                                                                               | 45 tests passed, including production guard, migration-window tokenless upgrade, and signed-token claim checks | PASS   |
| Web legacy bootstrap helper behavior                    | npm --workspace apps/web run test -- tests/landingSession.test.ts                                                   | 5 tests passed, including legacy userId-only detection                                                         | PASS   |
| Mobile session lifecycle and anonymous merge continuity | npm test -- apps/mobile/tests/unit/auth.sessionLifecycle.test.ts apps/mobile/tests/unit/auth.anonymousMerge.test.ts | 20 tests passed across 2 suites                                                                                | PASS   |

### Requirements Coverage

| Requirement | Source Plan         | Description                                                                                                            | Status    | Evidence                                                                                                       |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| AUTH-01     | 02-01, 02-02, 02-03 | User can register with unique credentials and receive secure session tokens under JWT model                            | SATISFIED | register uniqueness + token issuance in service/routes; backend tests pass.                                    |
| AUTH-02     | 02-01, 02-02        | Existing user can log in with legacy salt:sha256 credentials and be upgraded lazily to argon2id without lockout        | SATISFIED | verifyPassword legacy path and login lazy upgrade in service; password tests pass.                             |
| AUTH-03     | 02-02, 02-03        | Existing client with legacy userId can exchange session identity via upgrade endpoint without forced re-authentication | SATISFIED | Controlled tokenless migration-window path in backend service plus targeted tests verifies continuity support. |
| AUTH-04     | 02-01, 02-02, 02-03 | Refresh token rotation revokes prior token and issues a new token pair on each refresh                                 | SATISFIED | refresh repository rotate + replay detection and route/service test coverage.                                  |
| AUTH-05     | 02-01, 02-02, 02-03 | Logout revokes active refresh token so future reuse is rejected                                                        | SATISFIED | logout lookup-by-hash then revokeById, with route tests for logout contract and repo targeted revoke behavior. |

### Anti-Patterns Found

No blocker anti-patterns found in the scanned backend/web/mobile auth files.

### Gaps Summary

No functional parity gaps remain for Phase 02, but AUTH-03 tokenless continuity is an explicit temporary security risk that must be tightly controlled operationally.

Residual risks after this verification:

- Tokenless continuity can impersonate known userId values if operators enable all override flags in production; this mode must be treated as temporary migration-only and disabled immediately after migration cutover.
- Operators must set LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL to a valid future timestamp when enabling ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN=true; an invalid or elapsed timestamp keeps tokenless upgrades denied.
- In production, tokenless mode remains denied unless ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION=true is explicitly set.
- After the migration window closes, stale legacy clients without token material will require a normal re-authentication path.

---

_Verified: 2026-04-18T11:25:00Z_
_Verifier: Claude (gsd-verifier)_
