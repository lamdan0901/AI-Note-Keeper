# @ai-note-keeper/api-next

Next.js App Router backend for ai-note-keeper. Runs alongside the Express API on port **3001** (Express stays on **3000**).

## Layout

- `app/` — App Router route tree (not under `src/app`)
- `src/server/`, `src/http/`, `src/db/` — support code imported via `@/*`

## TypeScript path aliases

| Alias | Maps to |
|-------|---------|
| `@/*` | `./src/*` |
| `@backend/*` | `../backend/src/*` |

Import backend domain code without copying it:

```ts
import { evaluateReadiness } from "@backend/health/readiness.js";
```

Backend uses ESM (`"type": "module"`, `NodeNext`) with explicit `.js` extensions in import specifiers.

| Context | Import style |
|---------|--------------|
| `tsc --noEmit` | `@backend/health/readiness.js` (verified in `src/server/backend-alias-esm-typecheck.ts`) |
| `next dev` / routes | `@backend/health/readiness` (extensionless — webpack `extensionAlias` resolves `.js` specifiers to `.ts`) |

`next.config.ts` sets `turbopack.root` to the monorepo root and `webpack.resolve.extensionAlias` so dev (`next dev --webpack`) and production builds can resolve backend `.js` specifiers to `.ts` sources. Turbopack does not yet support `extensionAlias`; the dev script uses `--webpack` until that gap closes.

Run `npm run typecheck` (or `npm --workspace apps/api-next run typecheck` from repo root) to verify alias resolution.

### ESM + cross-app import fallback

`@backend/*` is resolved by TypeScript and Next.js (Turbopack/webpack) during `next dev` and `next build`. If runtime alias friction appears in `next start` or production bundles:

1. **Preferred:** Extract shared domain code to `packages/backend-core` and depend on it from both `apps/backend` and `apps/api-next`.
2. **Short-term:** Use relative imports from api-next into `../backend/src/...` with explicit `.js` extensions.
3. **Build step:** Compile backend to `dist/` and point api-next imports at published workspace output.

See parent plan § ESM + Cross-App Imports for full context.

## API routes

Every route handler file must declare Node runtime:

```ts
export const runtime = "nodejs";
```

Do not use the Edge runtime; this service depends on Node-only packages (`pg`, `@node-rs/argon2`, etc.).

## Development

```bash
npm run dev
# or from repo root (after task 0.2):
# npm run dev:api-next
```

Listens on [http://localhost:3001](http://localhost:3001).