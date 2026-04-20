# 07-01 Summary - Web Auth Transport Foundation

## Outcome

Established web authenticated HTTP transport with refresh-on-401 behavior and removed Convex provider dependency from web bootstrap.

## Delivered Changes

- Added web API transport contracts and HTTP client:
  - apps/web/src/api/contracts.ts
  - apps/web/src/api/httpClient.ts
- Extended web auth context with token access and refresh hooks:
  - apps/web/src/auth/AuthContext.tsx
- Removed Convex provider usage at app entry:
  - apps/web/src/main.tsx
- Added web auth transport regression tests:
  - apps/web/tests/auth.httpClient.test.ts

## Verification

- `npm --workspace apps/web run -s test -- tests/auth.httpClient.test.ts`
  - PASS
- `npm --workspace apps/web run -s lint`
  - PASS for web package

## Notes

- Auth transport now retries exactly once after refresh and fails closed on repeated 401.
- Refresh token remains cookie-driven via `credentials: include`; access token is provided by auth context callback.
