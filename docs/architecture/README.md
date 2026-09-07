# Architecture

This document describes how the Like Honey platform is structured and the rules
that keep it secure and maintainable.

## Monorepo layout

```
apps/
  web/    Frontend — customer storefront + administration (Next.js 16)
  api/    Backend API — Hono on Cloudflare Workers
packages/
  db/     Neon PostgreSQL access (Drizzle ORM) — backend only
  shared/ Types, Zod contracts, API contracts, constants, utilities
  ui/     Future Like Honey Design System (React)
  config/ Reusable configuration (shared ESLint base)
```

## Backend boundary (strict)

The browser must **never** reach Neon PostgreSQL directly, and the frontend must
**never** contain database credentials or connection strings.

Expected request flow:

```
Browser
  → Like Honey API (apps/api, Cloudflare Workers)
    → Business logic
      → Neon PostgreSQL (packages/db)
      → Cloudflare R2 (media, future)
```

- Database writes belong to backend logic.
- Sensitive R2 operations belong to the backend.
- `packages/db` may only be imported from backend processes.

## Database access transport

`packages/db/src/client.ts` provides `getDb()` / `getDbTransaction()` for the
local Workers edge (workerd), where a socket created inside one request handler
may **never** be reused by another:

- **Plain queries** ride a shared Neon `Pool` with `poolQueryViaFetch = true`,
  i.e. stateless HTTPS through the Neon drive API — safe across requests.
- **`db.transaction(...)`** must be a real PostgreSQL transaction, so it opens a
  fresh, request-scoped `Client` (WebSocket), runs the whole callback against it
  and closes it afterwards. The `Pool` fallback path (`await pool.connect()`)
  that drizzle's `neon-serverless` driver uses by default is deliberately
  shadowed because it would keep a socket alive across handlers.
- The HTTP `neon-http` driver is **not** used for transactions (it has none);
  the WebSocket transport is retained because inventory movements and product
  materialization require genuine atomic transactions (see INVENTORY_RULES.md).

The development `DATABASE_URL` lives only in git-ignored local files
(`packages/db/.env` for Drizzle tooling, `apps/api/.dev.vars` for the local
Worker); `.env.example` / `.dev.vars.example` are scrubbed templates.

## API versioning

Every production endpoint is served under `/api/v1/...`. The version constants
(`API_VERSION`, `API_PREFIX`) live in `@likehoney/shared` so every layer shares a
single source of truth, and every request input shape is validated there with
Zod contracts before it reaches a service. `GET /health` is the unversioned
liveness probe.

Phase 3B administrative endpoints (all under `GET/POST/PATCH/DELETE` as
documented in the route modules of `apps/api/src/routes/`):

| Domain           | Base path                                                          | Scope                           |
| ---------------- | ------------------------------------------------------------------ | ------------------------------- |
| Categories       | `/api/v1/categories`                                               | CRUD + slug/code rules          |
| Suppliers        | `/api/v1/suppliers`                                                | CRUD + soft-disable safety      |
| Products         | `/api/v1/products`                                                 | CRUD + SKU/pricing shapes       |
| Variants/options | `/api/v1/variants` (+ nested `POST /products/:productId/variants`) | SKU generation, label recompute |
| Inventory        | `/api/v1/inventory`                                                | atomic movements + ledger       |
| Media            | `/api/v1/media`                                                    | multipart uploads + R2 stream   |
| Settings / zones | `/api/v1/settings`                                                 | typed settings + delivery zones |
| Staff / RBAC     | `/api/v1/staff`                                                    | staff, roles, permissions       |

Every route is gated by the RBAC foundation middleware (`requirePermission`),
which resolves the requesting staff member's effective permission codes from
the role graph on each call. The acting staff identity is carried by the
`X-Staff-Id` header as a **development placeholder** — real authentication
(sessions/credentials) is a separately approved phase, and this middleware is
the boundary any future auth provider must satisfy. The Admin browser resolves
the selected development staff id synchronously at request time from a single
identity source of truth and sends it as `X-Staff-Id`; this is development-only.

For development only, `GET /api/v1/staff/dev-options` bootstraps the Admin
identity picker with the minimal active-staff options (`{id, nameAr, nameEn}` —
no emails, phones, permissions, or secrets). It is served only when the method
request sets `APP_ENV=development` (explicit, fail-closed), additionally
restricted to loopback hosts, and returns **404** (never 401/403) in any
non-development environment so the route is not advertised in production.

Error responses are machine-coded (`error.code` in stable ASCII, e.g.
`validation_error`, `insufficient_stock`, `db_unavailable`) so the Arabic-first
/ English UI can localize them — raw internals are never leaked to clients.

## Environments

Two strict environments:

| Environment | Resource                                                | Content        |
| ----------- | ------------------------------------------------------- | -------------- |
| Development | Development Neon database/branch; development R2 bucket | Test data only |
| Production  | Real Like Honey database; production R2 bucket          | Real data      |

- Never hard-code database URLs.
- Never copy production credentials into local examples.
- AI agents may only use development resources.
- Never run migrations against a non-development database.

Development database (Phase 3A): the Neon development branch —
`likehoneydb` on the shared `ep-*-pooler.c-5.eu-central-1.aws.neon.tech`
endpoint — is provisioned with the single `0000_*` schema migration (see
`packages/db/drizzle/`). Migrations are applied with
`pnpm --filter @likehoney/db db:migrate` against development only. Dev-only
test data is inserted by the idempotent, URL-guarded seed script
`packages/db/scripts/seed-dev.mjs` (RBAC bootstrap only).

## Media storage

Cloudflare **R2** stores product images, product videos, and content media.
**Neon** stores metadata and references only — never image/video binary content.

Interactions with the bucket go through `apps/api/src/media/storage.ts`, a
provider-neutral `MediaStorage` abstraction (put/get/delete) backed by an R2
implementation; the Worker streams object bodies to clients through
`GET /api/v1/media/stream` rather than exposing signed URLs. The `MEDIA_BUCKET`
binding is declared in the API Worker's Wrangler configuration. When the bucket
is not bound, media routes answer `media_unconfigured` (503).

## Payments

V1 ships **Cash on Delivery only** and must not contain fake payment flows.
Future electronic payment (e.g., Bank of Palestine) will be added only after
separate approval. When added, it must use a **provider abstraction** so new
providers can be introduced without rewriting checkout, and payment webhooks must
be **idempotent** by design.

## Future authentication

V1 has no customer accounts. The backend now carries an **authorization
foundation**: staff identity, roles and permission assignments are modeled and
every admin route enforces permission codes. There is deliberately **no
authentication yet** — no passwords, sessions, or credentials — and no auth
framework is installed. The identity header described above is a placeholder;
real authentication must be added in a separately approved phase behind the
existing `requirePermission` middleware. The `/api/v1/staff/dev-options`
endpoint exists only in an explicit development environment
(`APP_ENV=development`, set in the git-ignored local `.dev.vars`) and is never
exposed in production.

## Inventory safety (permanent rule)

Inventory is shared between physical store sales and online orders.

- Never update stock with an unsafe _read → subtract in memory → write_ pattern.
- Critical inventory mutations must use **atomic PostgreSQL operations** and/or
  properly designed transactions.
- Design must prevent overselling, negative stock, duplicate deductions, and
  race conditions.

## Deployment target

The production target is **Cloudflare Workers** (web via [vinext](https://vinext.dev),
API via Hono + Wrangler). The future website domain is expected to be
`likehoney2024.com` but is **not yet guaranteed or registered** — do not hard-code it.

## Rendering / performance approach (future)

Optimized media, code splitting, proper caching, minimal client JavaScript,
responsive images, sensible loading states, and SSR/static generation where
appropriate. Nothing is pre-optimized during Phase 0.
