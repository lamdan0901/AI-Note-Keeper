# Testing Patterns

**Analysis Date:** 2026-04-17

## Test Framework

**Runners in use:**

- Jest (root + many contract/mobile tests).
- Vitest (web workspace tests in `apps/web/tests`).
- Node test runner (`node:test`) for migration backend tests compiled under `apps/backend/src/tests`.

**Assertion libraries:**

- Jest/Vitest built-in `expect` matchers.
- Node `assert/strict` in backend migration-side tests.

**Run commands:**

```bash
npm test                                   # Root Jest run
npm run lint                               # Static checks at workspace level
npm --workspace apps/web run test          # Web tests (Vitest)
npm --workspace apps/backend run test      # Backend build + node:test suite
```

## Test File Organization

**Location patterns:**

- Root contract and integration tests: `tests/contract`, `tests/integration`, `tests/mobile`.
- Mobile app tests: `apps/mobile/tests/unit`, `apps/mobile/tests/integration`.
- Web app tests: `apps/web/tests`.
- Backend migration tests: `apps/backend/src/tests`.

**Naming:**

- Uniform `*.test.ts` naming.
- Descriptive behavior labels in filenames (`reminders.ackReminder.test.ts`, `offlineCreateSync.test.ts`).

## Test Structure

**Common structure:**

- `describe` blocks by domain and scenario.
- explicit setup/reset in `beforeEach`.
- clear arrange/act/assert flow for contract behavior.

**Representative patterns:**

- Mocked Convex runtime boundary in contract tests (`tests/contract/notes.crud.test.ts`).
- Unit tests around pure data transformation/scheduling helpers (`apps/mobile/tests/unit/*`, `apps/web/tests/*`).
- Integration tests for offline and reminder flows in mobile.

## Mocking

**Framework use:**

- Jest module mocking is common (`jest.mock(...)`).
- Vitest uses `vi.fn`, `vi.spyOn`, `vi.restoreAllMocks`.

**What is commonly mocked:**

- Convex generated server bindings in contract tests.
- Storage and native platform APIs (`AsyncStorage`, `SecureStore`, UUID providers).
- Time (`Date.now`) in recurrence/reminder tests.

**What is usually not mocked:**

- Shared pure helper algorithms (for example recurrence and hash helpers) in direct utility tests.

## Fixtures and Factories

**Patterns observed:**

- In-test builders/factories are used heavily (`makeDraft`, `makeNote`, `baseNote` objects).
- Reusable test doubles are often local to file rather than centralized fixture directories.

## Coverage and Quality Signals

**Current state:**

- No single enforced coverage gate discovered in checked-in CI workflows (none found under `.github/workflows`).
- Migration documentation indicates broad parity verification goals and significant contract test usage.

**Strengths:**

- Good breadth of domain contract tests across notes/reminders/subscriptions/AI merge paths.
- Backend SQL/index migration assertions exist (`apps/backend/src/tests/reminder-indexes.test.ts`).

**Gaps:**

- Some integration tests are intentionally skipped/placeholders (for example `apps/mobile/tests/integration/offlineCreateSync.test.ts`).
- Mixed runners increase cognitive overhead and can cause duplicated setup patterns.

## Test Types

**Contract tests:**

- Validate behavioral parity of Convex domain logic and migration expectations.
- Located primarily under `tests/contract`.

**Unit tests:**

- Focus on utility behavior, payload shaping, auth/session state transitions.
- Located under web/mobile app test directories.

**Integration tests:**

- Exercise cross-module flows such as offline sync and wake/reconcile behavior.

## Common Patterns

**Async testing:**

- async/await and promise-based assertions are standard.
- Network/provider boundaries usually mocked.

**Error testing:**

- Explicit assertions for invalid input and fallback behavior.
- Backend error middleware has direct response shape tests.

**Snapshot testing:**

- No broad snapshot-testing convention observed in sampled test suites.

## Guidance for New Tests

- Place tests adjacent to runtime ownership: root contract for domain parity, app-local tests for client behavior.
- Reuse existing mock style per runner instead of introducing new frameworks.
- Prefer deterministic time-dependent tests by stubbing `Date.now`.
- Add integration tests when modifying sync/cron/push flows because these are high-regression paths.

---

_Testing analysis: 2026-04-17_
_Update when test runner strategy or coverage enforcement changes_
