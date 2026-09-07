# AGENTS.md — Like Honey Operating Manual

> Every AI coding agent and human contributor **must read this file** before
> editing, adding, or removing anything in this repository. If you are an agent
> and you have not read this file, stop and read it now.

This repository is the engineering foundation of **Like Honey**, a premium,
bilingual (Arabic-first / English) commerce platform. It is built and maintained
to a professional production standard. Premium polish is a **requirement**, not
an optional enhancement.

> ## CRITICAL BUSINESS CONTEXT — read before building anything
>
> Like Honey is a **children's retail store**. It sells children's clothing,
> shoes, bags/backpacks, school supplies, toys, accessories, baby products and
> gifts to parents and families.
>
> The **bee and honey identity is brand language only** — the store is NOT a
> honey retailer, honey shop, food store, organic/natural-products business,
> or agricultural brand. Never imply that Like Honey sells honey.
>
> Rules that follow from this:
>
> - Never present honey jars, honeycomb, honey spoons, flowers-around-jars, or
>   food imagery as storefront merchandise, products, categories, or promo art.
> - Honey/gold is a restrained **brand accent** on a premium children's retail
>   experience; product + product photography are the visual focus, not gold.
> - The bee is used **selectively** in storytelling/loading/empty-state moments;
>   it must never dominate the merchandise or read as a "honey theme park".
> - Synthetic preview data in the design lab must use realistic children's
>   retail categories and products (kids' clothing, shoes, bags, toys…).
> - Keep the supplier "company" concept as the entity Like Honey purchases stock
>   from (not necessarily the manufacturer or consumer-facing brand).

---

## 1. Project Architecture

Monorepo managed with **pnpm workspaces**:

```
apps/
  web/          Customer storefront + administration frontend (Next.js 16)
  api/          Backend API (Hono on Cloudflare Workers)
packages/
  db/           Neon PostgreSQL data access (Drizzle ORM) — backend only
  shared/       Types, Zod contracts, API contracts, constants, utilities
  ui/           Future Like Honey Design System (React)
  config/       Reusable project configuration (shared ESLint base)
docs/           Requirements, architecture, design, decisions (ADRs)
design-reference/  Brand and concept reference assets (do not edit source files)
```

Read `docs/architecture/README.md` for the full architecture description and
`docs/requirements/APPROVED_V1_SCOPE.md` for the immutable V1 boundaries.

## 2. V1 Scope Boundaries (immutable)

The approved V1 scope is defined in `docs/requirements/APPROVED_V1_SCOPE.md`.
It is a guardrail, not a suggestion.

- AI agents must **never silently expand scope**.
- Any feature outside V1 must be **explicitly approved** before implementation.
- If you are unsure whether something is in scope, ask before building.

## 3. Frontend / Backend Separation (strict)

- The browser must **never** access Neon PostgreSQL directly.
- The frontend must **never** contain database credentials or connection strings.
- Expected future flow: **Browser → Like Honey API → business logic → PostgreSQL / R2**.
- Database writes belong to backend logic (`apps/api` / `packages/db`).
- Sensitive R2 operations belong to the backend.

## 4. Development vs Production Resources

- **Development** uses a development Neon database/branch and test data only.
  AI agents may only use development resources.
- **Production** holds real Like Honey data and must **never be accessed casually**
  during development.
- Never hard-code database URLs. Never copy production credentials into local
  examples or documentation.

## 5. Secrets

- Never commit secrets, keys, tokens, or database URLs — anywhere, including docs.
- Secrets are configured through environment variables / Cloudflare bindings only.
  See `.env.example` and `apps/api/.dev.vars.example`.
- If you spot a secret in a diff, remove it and report it.

## 6. TypeScript Quality

- Strict TypeScript everywhere (`strict` + production-grade options from
  `tsconfig.base.json`).
- Never use `any`. Never disable type checks. Never hide type errors with broad
  suppressions. Prefer precise types (`unknown` + narrowing) when needed.

## 7. Arabic RTL + English LTR

- Like Honey is **Arabic-first**, English second.
- UI must support **RTL (Arabic)** and **LTR (English)**.
- Do not introduce hard-coded directional CSS assumptions or global direction
  values. The future design system must provide direction-aware components.
- Consider both languages whenever you touch UI or copy.

## 8. Responsive / Mobile

- Every UI surface must be responsive. Mobile receives dedicated art direction.
- Test at mobile widths before considering a UI change complete.

## 9. Design Quality

- Never produce "generic AI-looking" layouts, generic SaaS templates, or obvious
  AI-generated patterns.
- Preserve the Like Honey brand identity. A custom design system lives in
  `packages/ui`; see `docs/design/DESIGN_DIRECTION.md`.
- Do not install generic component libraries (shadcn, Material UI, Ant Design,
  etc.) unless explicitly requested.

## 10. Inventory Safety (permanent rule)

Inventory is shared between physical store sales and online orders. Stock updates
must be **concurrency-safe**.

- Never update inventory with an unsafe read → subtract in memory → write pattern.
- Critical inventory mutations must use **atomic PostgreSQL operations** and/or
  properly designed transactions.
- The system must prevent overselling, negative stock, duplicate deductions, and
  race conditions. Do not implement this yet — just honor the rule when designing.

## 11. Payments

- V1 uses **Cash on Delivery**. Bank of Palestine / electronic payment is a future,
  separately approved addition.
- Never install payment SDKs or build fake payment functionality without approval.
- Future electronic payment architecture must use a **provider abstraction** so new
  providers can be added without rewriting checkout.
- Any payment webhooks must be **idempotent** by design.

## 12. Architecture Changes

- Do not change architecture, stack, or package boundaries without first documenting
  the rationale. Record important decisions as ADRs in `docs/decisions/`.
- Small improvements that clearly improve maintainability are welcome; unnecessary
  abstraction is not.

## 13. Dependencies

- Avoid unnecessary dependencies. Do not add a library when a small, clear solution
  exists. Decisions about chart/barcode/animation/payment/auth/analytics libraries
  are made feature-by-feature — do not pre-install them.

## 14. Change Discipline

- Prefer small, focused changes.
- After relevant changes, run the workspace checks (see Commands).
- Do not delete or rewrite unrelated code.
- Do not silently weaken security or validation.
- Do not run database migrations against any non-development database.
- Do not create Cloudflare resources or deploy production without explicit approval.

### Migration immutability (permanent rule)

- Once a migration `.sql` has been applied to any **shared or persistent**
  environment (staging, production, or a dev branch that is treated as shared
  history), **its SQL is frozen**. Never edit it and never hand-patch the
  database to match.
- Corrections ship as a **new forward migration**.
- The only exception is a **disposable** environment that is deliberately reset
  (`DROP SCHEMA … CASCADE` + re-migrate from zero) _before_ the migration is
  considered shared history — the state after reset must be reproducible purely
  from the committed migration chain, and `drizzle.__drizzle_migrations` must
  hash-match the committed files.
- Every environment (fresh, existing dev, future staging, future production)
  must converge through the **same committed migration chain**.
- Generated migration artifacts under `packages/db/drizzle/**` are Prettier-
  ignored — never reformat them by hand.
- Custom SQL (triggers, functions, partial indexes drizzle-kit cannot model)
  ships as a `drizzle-kit generate --custom` migration, authored by hand, with a
  proper journal entry.

## 15. Accessibility

- UI must use semantic HTML, keyboard navigation, visible focus states, sufficient
  contrast, proper labels, and reduced-motion consideration.

## 16. Performance

- The platform must remain fast: optimized media, code splitting, proper caching,
  minimal client JavaScript, no unnecessary dependencies, sensible loading states.

## 17. Final Rule

Premium polish is a requirement. Work as a thoughtful senior engineer on a
high-value product — not as a scaffolding tool.

---

## Commands (run from the repository root)

| Command             | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `pnpm install`      | Install all workspace dependencies             |
| `pnpm dev`          | Run web + API development servers concurrently |
| `pnpm dev:web`      | Next.js development server (`apps/web`)        |
| `pnpm dev:api`      | Hono/Cloudflare Worker (`apps/api`, port 8787) |
| `pnpm lint`         | ESLint across all workspaces                   |
| `pnpm typecheck`    | `tsc --noEmit` across all workspaces           |
| `pnpm build`        | Build all workspaces                           |
| `pnpm format`       | Prettier write                                 |
| `pnpm format:check` | Prettier check                                 |

Run single-workspace checks with `pnpm --filter <package> <script>`, for example
`pnpm --filter @likehoney/web lint`.

### Package manager

- Use **pnpm only** (version pinned via the root `packageManager` field). Never mix
  npm/yarn lockfiles.
- When installing a new dependency, run `pnpm add <pkg> --filter <package>`.
- Keep ESLint, Prettier, and TypeScript versions consistent across workspaces.
  **Do not upgrade the ESLint major independently** — `eslint-config-next`'s plugin
  chain currently targets ESLint 9.

### Note on `apps/web/AGENTS.md`

Next.js maintains its own `AGENTS.md` inside `apps/web`. It is auto-written by
`next dev` and is authoritative for Next.js-specific conventions. Do not fight it;
if you remove it, `next dev` recreates it.
