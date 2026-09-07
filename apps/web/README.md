# @likehoney/web

The future Like Honey customer storefront and administration frontend.

- **Framework:** Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Local development:** `pnpm dev` (standard Next.js), `pnpm dev:vinext` (vinext/Vite server on port 3001)
- **Package:** part of the Like Honey pnpm workspace — see the root [`../../README.md`](../../README.md)

Phase 0 ships a single neutral development placeholder page. No production UI has been designed yet.

## Scripts

| Command             | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm dev`          | Next.js development server                                        |
| `pnpm dev:vinext`   | vinext development server (Cloudflare Workers preview, port 3001) |
| `pnpm build`        | Production build (Next.js)                                        |
| `pnpm build:vinext` | vinext production build for Cloudflare Workers                    |
| `pnpm start:vinext` | Run the built Worker locally with Wrangler                        |
| `pnpm lint`         | ESLint                                                            |
| `pnpm typecheck`    | `tsc --noEmit`                                                    |

Run these through the root workspace (`pnpm --filter @likehoney/web …`) or directly from this directory.

## Cloudflare Workers

This app is prepared for Cloudflare Workers via [vinext](https://vinext.dev). `vite.config.ts` and `wrangler.jsonc` were generated with `vinext init --platform=cloudflare`. The normal Next.js experience remains available through `next dev` / `next build`.

No Cloudflare resources have been created and nothing is deployed by CI.
