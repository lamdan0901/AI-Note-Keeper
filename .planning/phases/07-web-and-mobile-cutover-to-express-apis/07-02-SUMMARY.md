# 07-02 Summary - Web Notes, Reminders, and Subscriptions Cutover

## Outcome

Migrated core web domain services from Convex transport to Express API transport and added polling/focus refresh behavior for notes.

## Delivered Changes

- Migrated notes service to Express transport:
  - apps/web/src/services/notes.ts
- Migrated reminders service to Express transport:
  - apps/web/src/services/reminders.ts
- Migrated subscriptions service to Express transport:
  - apps/web/src/services/subscriptions.ts
- Added focus + interval refresh behavior on notes page:
  - apps/web/src/pages/NotesPage.tsx
- Added web domain transport tests:
  - apps/web/tests/notes.expressApi.test.ts
  - apps/web/tests/subscriptions.expressApi.test.ts
- Added backend subscriptions trash endpoints to support web/mobile parity:
  - apps/backend/src/subscriptions/routes.ts
  - apps/backend/src/subscriptions/service.ts
  - apps/backend/src/tests/subscriptions/routes.test.ts

## Verification

- `npm --workspace apps/web run -s test -- tests/notes.expressApi.test.ts tests/subscriptions.expressApi.test.ts`
  - PASS
- `npm --workspace apps/web run -s lint`
  - PASS for web package
- Backend subscriptions route unit test execution is currently blocked in this environment by existing root Jest ESM configuration (`jose` parsing in CommonJS mode).

## Notes

- Notes polling interval is fixed at 30 seconds with explicit focus-trigger refresh.
- Subscriptions trash list and empty-trash capabilities are now available through Express routes.
