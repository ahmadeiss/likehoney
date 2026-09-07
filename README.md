# Like Honey

Premium, bilingual (Arabic-first / English) commerce platform — customer
storefront, employee operations, and administration, engineered to a
professional production standard.

> **Status: Phase 0 (foundation).** The repository contains an architecture
> skeleton, quality tooling, and empty application foundations. No product
> functionality exists yet — nothing is claimed to be implemented that is not.

## Monorepo structure

```
apps/
  web/    Customer storefront + administration frontend (Next.js 16)
  api/    Backend API (Hono on Cloudflare Workers)
packages/
  db/     Neon PostgreSQL data access (Drizzle ORM) — backend only
  shared/ Types, Zod contracts, API contracts, constants, utilities
  ui/     Future Like Honey Design System (React)
  config/ Reusable project configuration (shared ESLint base)
docs/     Requirements, architecture, design, decisions
design-reference/  Brand + concept reference assets
```

## Stack

| Area           | Technology                                               |
| -------------- | -------------------------------------------------------- |
| Frontend       | Next.js 16 · React 19 · TypeScript · Tailwind CSS        |
| Web on Workers | [vinext](https://vinext.dev) (Vite) + Cloudflare Workers |
| Backend        | Hono · Cloudflare Workers · Wrangler                     |
| Database       | Neon PostgreSQL · Drizzle ORM · @neondatabase/serverless |
| Validation     | Zod                                                      |
| Tooling        | pnpm · ESLint · Prettier · EditorConfig · GitHub Actions |

## Prerequisites

- Node.js 24 LTS
- pnpm (pinned to the version in the root `packageManager` field — `pnpm@11.3.0`)

## Setup

```bash
pnpm install
```

Environment templates:

- `.env.example` → copy to `.env` (database/API-facing secrets, local only)
- `apps/api/.dev.vars.example` → copy to `apps/api/.dev.vars` (Worker secrets)

**Never commit real values.** Create Cloudflare and Neon resources only when a
phase actually needs them; Phase 0 requires none.

## Commands

| Command                             | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `pnpm dev`                          | Web (Next.js) + API (port 8787) concurrently |
| `pnpm dev:web`                      | Web development server only                  |
| `pnpm dev:api`                      | API development server only                  |
| `pnpm dev:web:vinext`               | Web via the vinext/Vite server (port 3001)   |
| `pnpm lint`                         | ESLint across all workspaces                 |
| `pnpm typecheck`                    | TypeScript across all workspaces             |
| `pnpm build`                        | Build all workspaces                         |
| `pnpm format` / `pnpm format:check` | Prettier write / check                       |

Run a single workspace: `pnpm --filter @likehoney/web lint`.

## Package responsibilities

| Package           | Responsibility                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Storefront + administration UI (future). Prepared for Cloudflare Workers via vinext; `next dev` remains the normal experience.   |
| `apps/api`        | Hono API worker. Exposes only `GET /health` in Phase 0; future endpoints under `/api/v1/...`.                                    |
| `packages/db`     | Drizzle schema, queries, transactions. Backend-only; Drizzle Kit scripts (`db:generate`, `db:migrate`, `db:check`, `db:studio`). |
| `packages/shared` | Cross-package types, contracts, constants (e.g., API version).                                                                   |
| `packages/ui`     | Future Like Honey Design System (not implemented yet).                                                                           |
| `packages/config` | Shared ESLint base configuration.                                                                                                |

## Environment

See `.env.example`. You must provide, when a phase needs them: Neon
`DATABASE_URL` (Google Cloud secret in production), `CLOUDFLARE_ACCOUNT_ID`,
`R2_BUCKET_NAME`, and `SESSION_SECRET` (future). Do **not** invent variables.

## Git workflow

Conceptually protected `main`. Work on short-lived branches:

```
main → pull → feature/… (or fix|refactor|chore) → changes → lint/typecheck →
commit → push → pull request → review → merge
```

See `CONTRIBUTING.md` and `AGENTS.md`.

## Security warning

There are **no real secrets in this repository**. Production credentials,
database URLs, and API keys belong only in environment/Cloudflare bindings.
If you ever find a secret in a diff, remove it and report it immediately.
