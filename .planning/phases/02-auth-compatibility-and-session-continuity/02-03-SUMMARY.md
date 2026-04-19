---
phase: 02-auth-compatibility-and-session-continuity
plan: 03
subsystem: auth
tags: [react, react-native, session-upgrade, secure-store, cookies]
requires:
  - phase: 02-02
    provides: /api/auth register/login/refresh/logout/upgrade-session routes
provides:
  - Web and mobile auth HTTP clients for the Express auth API
  - Silent legacy userId-only bootstrap upgrade on both platforms
  - Platform-preserving session storage semantics (web cookie model, mobile secure-store model)
affects: [AUTH-01, AUTH-03, AUTH-04, AUTH-05, web-auth-bootstrap, mobile-auth-bootstrap]
tech-stack:
  added: []
  patterns: [platform-auth-client-abstraction, silent-legacy-session-upgrade]
key-files:
  created:
    - apps/web/src/auth/httpClient.ts
    - apps/mobile/src/auth/httpClient.ts
  modified:
    - apps/web/src/auth/session.ts
    - apps/web/src/auth/AuthContext.tsx
    - apps/mobile/src/auth/session.ts
    - apps/mobile/src/auth/AuthContext.tsx
    - apps/web/.env.example
    - apps/mobile/.env.example
    - apps/web/tests/landingSession.test.ts
    - apps/mobile/tests/unit/auth.sessionLifecycle.test.ts
key-decisions:
  - 'Use optional auth API clients so Convex-based fallback behavior remains intact when auth API env vars are absent.'
  - 'Persist access token only for client runtime continuity; never persist web refresh token in localStorage.'
patterns-established:
  - 'Silent continuity upgrade: detect legacy userId-only sessions and call upgrade-session during bootstrap.'
  - 'Platform-specific auth transport: credentials+cookie web flow and secure-store JSON token mobile flow.'
requirements-completed: [AUTH-01, AUTH-03, AUTH-04, AUTH-05]
duration: 41 min
completed: 2026-04-18
---

# Phase 02 Plan 03: Client Session Continuity Wiring Summary

**Web and mobile auth contexts now consume the new backend auth API with silent legacy upgrade behavior while preserving each platform’s storage model.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-04-18T11:48:00Z
- **Completed:** 2026-04-18T12:29:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Added platform-specific auth API clients and integrated them into auth context login/register/bootstrap flows.
- Added legacy userId-only session detection and automatic `upgrade-session` bootstrap behavior on both web and mobile.
- Preserved web cookie transport behavior and mobile secure-store token behavior without removing Convex fallback paths.
- Updated env examples and targeted tests covering legacy upgrade detection and session lifecycle behavior.

## Task Commits

1. **Task 1: Create platform-specific auth HTTP clients and session contracts** - `4a30bbb` (feat)
2. **Task 2: Update web auth bootstrap and runtime flows for seamless upgrade** - `b4a38ff` (feat)
3. **Task 3: Update mobile auth bootstrap and secure-store token lifecycle** - `da8358e` (feat)
4. **Plan metadata:** pending phase docs commit

## Files Created/Modified

- `apps/web/src/auth/httpClient.ts` - Web auth API client with credentials-included cookie transport.
- `apps/mobile/src/auth/httpClient.ts` - Mobile auth API client returning JSON token payloads.
- `apps/web/src/auth/session.ts` - Legacy web session detection and access-token-aware session contract.
- `apps/mobile/src/auth/session.ts` - Mobile session token fields and legacy userId loader.
- `apps/web/src/auth/AuthContext.tsx` - Web bootstrap/login/register/logout integration with backend auth APIs.
- `apps/mobile/src/auth/AuthContext.tsx` - Mobile bootstrap refresh/upgrade and auth API integration with secure-store continuity.
- `apps/web/.env.example` and `apps/mobile/.env.example` - New auth API base URL configuration docs.
- `apps/web/tests/landingSession.test.ts` and `apps/mobile/tests/unit/auth.sessionLifecycle.test.ts` - Added legacy continuity/session coverage.

## Decisions Made

- Keep `createWebAuthHttpClient` and `createMobileAuthHttpClient` optional to preserve compatibility when auth API URL is not configured.
- Keep merge/local-user-data flows intact and layer auth API integration around them to avoid regressions in existing migration behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Workspace-wide mobile typecheck reports pre-existing React Native JSX typing issues unrelated to this plan’s changed files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 2 auth continuity is wired end-to-end for backend + web + mobile.
- Phase verification can now validate AUTH requirement coverage against implementation and tests.

---

_Phase: 02-auth-compatibility-and-session-continuity_
_Completed: 2026-04-18_
