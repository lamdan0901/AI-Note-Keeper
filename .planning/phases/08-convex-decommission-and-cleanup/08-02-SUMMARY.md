# 08-02 Summary - Web Stage-A Convex Runtime Cleanup

## Outcome

Removed remaining Convex runtime coupling from active web auth and reminders flows, added a regression scanner that blocks Convex runtime import reintroduction, and cleaned web package/env configuration to Express-only operation.

## Delivered Changes

- Refactored web auth runtime to remove Convex client imports/fallback paths:
  - apps/web/src/auth/AuthContext.tsx
- Replaced reminders page Convex hooks with Express API transport:
  - apps/web/src/pages/reminders.tsx
- Added decommission source-scan integration test:
  - tests/integration/decommission.web-runtime.test.ts
- Removed web Convex config/dependency surface:
  - apps/web/package.json
  - apps/web/.env.example

## Verification

- `npm run -s test -- tests/integration/decommission.web-runtime.test.ts`
  - PASS (2 tests)
- `npm --workspace apps/web run build`
  - PASS

## Guard Coverage

- Web source scanner fails if any `apps/web/src/**` file imports `convex/*` or generated Convex API bindings.
- Auth context and env template no longer reference `VITE_CONVEX_URL`.