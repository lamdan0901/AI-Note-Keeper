---
phase: 02-auth-compatibility-and-session-continuity
plan: 01
subsystem: auth
tags: [argon2id, jwt, jose, postgres, refresh-tokens]
requires: []
provides:
  - Argon2id password hashing with legacy salt:sha256 compatibility verification
  - JWT access/refresh token primitives with issuer and audience validation
  - SQL repository contracts for users and refresh token lifecycle
affects: [02-02, 02-03, AUTH-01, AUTH-02, AUTH-04, AUTH-05]
tech-stack:
  added: [@node-rs/argon2, jose]
  patterns: [sql-repository, targeted-session-revocation, explicit-token-contracts]
key-files:
  created:
    - apps/backend/src/auth/contracts.ts
    - apps/backend/src/auth/passwords.ts
    - apps/backend/src/auth/tokens.ts
    - apps/backend/src/auth/repositories/users-repository.ts
    - apps/backend/src/auth/repositories/refresh-tokens-repository.ts
    - apps/backend/src/tests/auth/passwords.test.ts
    - apps/backend/src/tests/auth/tokens.test.ts
    - apps/backend/src/tests/auth/refresh-tokens-repository.test.ts
  modified:
    - apps/backend/src/config.ts
    - apps/backend/package.json
    - package-lock.json
key-decisions:
  - "Use argon2id for all new password hashes while preserving legacy salt:sha256 verification for lazy migration."
  - "Model refresh token lifecycle with hashed token rows and per-token revocation to preserve concurrent sessions."
patterns-established:
  - "Repository Pattern: auth data access is isolated behind users and refresh token repositories."
  - "Token contract separation: access and refresh payloads are explicitly typed and validated independently."
requirements-completed: [AUTH-01, AUTH-02, AUTH-04, AUTH-05]
duration: 59 min
completed: 2026-04-18
---

# Phase 02 Plan 01: Backend Auth Primitives Summary

**Argon2id auth primitives and replay-safe refresh token repositories now provide the secure foundation for Phase 2 HTTP auth flows.**

## Performance

- **Duration:** 59 min
- **Started:** 2026-04-18T10:00:00Z
- **Completed:** 2026-04-18T10:59:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added deterministic password verification with argon2id default and legacy compatibility metadata.
- Added JWT access/refresh token issuance and verification with explicit issuer/audience enforcement.
- Added SQL-first repositories that support multi-session refresh tokens and targeted revocation.
- Added focused backend tests that verify auth primitives and refresh lifecycle semantics.

## Task Commits

1. **Task 1: Define auth contracts and crypto primitives** - `adfb26b` (feat)
2. **Task 2: Build repository layer for multi-session refresh lifecycle** - `04a68ae` (feat)
3. **Plan metadata:** pending phase docs commit

## Files Created/Modified

- `apps/backend/src/auth/contracts.ts` - Shared auth token/password/repository contract types.
- `apps/backend/src/auth/passwords.ts` - Argon2id hash/verify and legacy salt:sha256 compatibility verification.
- `apps/backend/src/auth/tokens.ts` - Access/refresh token issuance, verification, and refresh token hashing.
- `apps/backend/src/auth/repositories/users-repository.ts` - SQL repository for user lookup/create/hash upgrades.
- `apps/backend/src/auth/repositories/refresh-tokens-repository.ts` - SQL repository for insert/find/revoke/rotate refresh token lifecycle.
- `apps/backend/src/tests/auth/passwords.test.ts` - Password hashing and legacy verification coverage.
- `apps/backend/src/tests/auth/tokens.test.ts` - Token verification and rejection-path coverage.
- `apps/backend/src/tests/auth/refresh-tokens-repository.test.ts` - Multi-session and replay detection coverage.

## Decisions Made

- Use production-strict auth env validation with safe dev defaults to avoid breaking local/test startup.
- Hash refresh tokens before persistence and use one-row revocation semantics for current-session-only logout.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Auth primitives are complete and tested.
- Phase 02-02 can consume the new service/repository/token contracts directly.

---

_Phase: 02-auth-compatibility-and-session-continuity_
_Completed: 2026-04-18_
