# Phase 2: Auth Compatibility and Session Continuity - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver secure JWT auth while preserving legacy password and session upgrade paths. This phase covers register, login, refresh, logout, legacy userId session upgrade, and lazy password hash migration. It does not include broader notes, reminder, or subscription parity.

</domain>

<decisions>
## Implementation Decisions

### Session transport and storage

- **D-01:** Web sessions should use httpOnly cookies, while mobile sessions should persist tokens in secure storage.
- **D-02:** The client architecture should treat web and mobile as different storage surfaces rather than forcing one shared token persistence model.

### Legacy session upgrade

- **D-03:** Existing raw userId sessions should upgrade silently at app bootstrap when detected.
- **D-04:** The upgrade path should preserve continuity without forcing a re-authentication step for already signed-in users.

### Session scope and revocation

- **D-05:** Multiple concurrent sessions are allowed for the same account.
- **D-06:** Refresh rotation and logout should revoke only the current refresh token, not every active session for the user.

### Credential migration

- **D-07:** New registrations should use argon2id.
- **D-08:** Legacy salt:sha256 passwords should continue to authenticate and be upgraded lazily on successful login.

</decisions>

<specifics>
## Specific Ideas

- The continuity goal is seamless bootstrap upgrade rather than a forced login screen.
- The current web and mobile clients already keep local auth state separately, so the phase should preserve that split while replacing Convex auth calls.
- The refresh token table already exists with a user_id and token_hash model, which fits a multi-session design.

</specifics>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and constraints

- `.planning/ROADMAP.md` - Phase 2 scope, success criteria, and dependency order.
- `.planning/REQUIREMENTS.md` - AUTH-01 through AUTH-05 requirement definitions.
- `.planning/PROJECT.md` - Core value, legacy compatibility constraints, and auth/session model.
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md` - Authoritative migration plan for JWT, refresh rotation, legacy upgrade-session, and lazy hash migration.

### Prior phase and research context

- `.planning/phases/01-foundation-and-runtime-baseline/01-CONTEXT.md` - Baseline error contract, health, and runtime constraints that auth routes should inherit.
- `.planning/research/ARCHITECTURE.md` - Auth upgrade flow, dependency ordering, and recommended build order.
- `.planning/research/FEATURES.md` - Auth/session parity framing, migration priorities, and anti-features to avoid.
- `.planning/research/STACK.md` - Recommended auth stack choices, including jose, argon2, and rate-limiting support.
- `.planning/research/PITFALLS.md` - Auth-specific security pitfalls and recovery guidance.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `apps/web/src/auth/AuthContext.tsx` and `apps/mobile/src/auth/AuthContext.tsx`: existing auth state orchestration and session bootstrap patterns that can be adapted to Express.
- `apps/web/src/auth/session.ts` and `apps/mobile/src/auth/session.ts`: current local session storage helpers that show how each surface persists auth state today.
- `apps/backend/src/db/migrations/00001_users.sql`: user table shape for auth identity and password fields.
- `apps/backend/src/db/migrations/00008_refresh_tokens.sql`: refresh token persistence model already supports hashed token storage and user linkage.
- `apps/backend/src/errors/catalog.ts` and `apps/backend/src/middleware/error-middleware.ts`: stable error contract primitives that auth endpoints should reuse.

### Established Patterns

- Current client auth is session-state driven and expects bootstrap validation rather than a fully stateless API swap.
- The backend already favors explicit error categories and status mapping, so auth failures should fit the existing contract.
- Shared domain semantics are treated as migration invariants, so auth changes should not duplicate unrelated app logic.

### Integration Points

- Web auth provider and auth dialog should switch from Convex mutations to Express auth endpoints.
- Mobile auth provider should continue to own bootstrap/session continuity logic while changing backend calls.
- Express auth routes will likely center on register, login, refresh, logout, and POST /auth/upgrade-session.
- Refresh token rotation must integrate with the existing refresh_tokens table and user identity records.

</code_context>

<deferred>
## Deferred Ideas

None - the discussion stayed within phase scope.

</deferred>

---

_Phase: 02-auth-compatibility-and-session-continuity_
_Context gathered: 2026-04-18_
