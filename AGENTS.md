# ai-note-keeper Development Guidelines

Auto-generated from all feature plans.

## Active Technologies

- TypeScript monorepo with React, React Native / Expo, Convex, and shared packages
- Mobile client: Expo React Native app
- Web client: Vite + React app
- Backend: `apps/backend` with Convex API and worker support
- Shared code: `packages/*`

## Project Structure

```text
android/                 # native Android wrapper for mobile app
apps/
  backend/              # backend services and Convex-powered API/worker runtime
  mobile/               # Expo React Native mobile app
  web/                  # frontend web app
convex/                  # legacy Convex schema, functions, and generated types
packages/                # shared packages, constants, hooks, auth, tokens, types, utils
tests/                   # integration / contract / runtime test suites
docs/                    # documentation and runbooks
```

## Commands

- `npm run lint`
- `npm test`
- `npm run dev`
- `npm run dev:web`
- `npm run dev:mobile`
- `npm run build:web`
- `npm run build:mobile`

## Code Style

TypeScript (React for web, React Native/Expo for Android): follow standard TypeScript and React conventions.

<!-- MANUAL ADDITIONS START -->

- Don't run build android to verify changes. just run lint, test (if needed) and typecheck
<!-- MANUAL ADDITIONS END -->
