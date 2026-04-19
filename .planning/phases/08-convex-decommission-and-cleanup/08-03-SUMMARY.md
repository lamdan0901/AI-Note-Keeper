# 08-03 Summary - Mobile Stage-A Convex Runtime Cleanup

## Outcome

Removed remaining Convex runtime coupling from mobile auth/reminder/trash/sync paths, removed hasConvexClient UI feature gates, and cleaned mobile dependency and build configuration surfaces for Express-only operation.

## Delivered Changes

- Refactored mobile runtime modules off Convex imports and env dependency:
  - apps/mobile/App.tsx
  - apps/mobile/src/auth/AuthContext.tsx
  - apps/mobile/src/reminders/headless.ts
  - apps/mobile/src/reminders/ui/RescheduleOverlay.tsx
  - apps/mobile/src/screens/TrashScreen.tsx
  - apps/mobile/src/sync/fetchReminder.ts
  - apps/mobile/src/sync/noteSync.ts
  - apps/mobile/src/screens/SettingsScreen.tsx
  - apps/mobile/src/components/BottomTabBar.tsx
- Finalized naming/config cleanup and guard coverage:
  - apps/mobile/src/voice/aiIntentClient.ts
  - apps/mobile/src/screens/NotesScreen.tsx
  - apps/mobile/tests/unit/aiIntentClient.test.ts
  - apps/mobile/package.json
  - apps/mobile/.env.example
  - apps/mobile/eas.json
  - tests/integration/decommission.mobile-runtime.test.ts

## Verification

- `npm run -s test -- tests/integration/decommission.mobile-runtime.test.ts`
  - PASS (3 tests)
- `Select-String -Path "apps/mobile/.env.example","apps/mobile/eas.json","apps/mobile/package.json" -Pattern 'EXPO_PUBLIC_CONVEX_URL|"convex"'`
  - PASS (no matches)

## Guard Coverage

- Mobile source scan fails on any `convex/*` runtime import or generated Convex API import.
- App shell and key UI components no longer use `hasConvexClient` gating.
- Mobile env/EAS/package manifests no longer expose `EXPO_PUBLIC_CONVEX_URL` or `convex` dependency.