# Admin & Data-Layer Readiness Report — Like Honey / زي العسل

**Status:** Local checkpoint deliverable (no push)
**Audience:** Future sessions and maintainers
**Coverage:** Real staff auth (server-side DB sessions), admin authentication UI, commerce hard-verification, clean development data-layer baseline.
**Security note:** This report intentionally contains **no** passwords, session tokens, database URLs, R2 secrets, or private credentials. All values are referenced by environment slot or descriptor only.

---

## 1. Executive Summary

The Like Honey (زي العسل) monorepo now has a production-grade staff authentication layer backed by **server-side database sessions**, a fully wired V1 Admin login experience (login → forced password change → logout), and a **hard-verified commerce engine** whose pricing and inventory are derived authoritatively on the server (client-supplied money fields are ignored). The development data layer has been returned to a clean, empty baseline suitable for first real product entry. The final state is captured by the closing sentence: **Admin and data layer ready for first real Like Honey product.**

## 2. Objective

- Deploy real staff authentication with server-side DB sessions.
- Wire the full V1 Admin login UI (session-cookie-first, forced password change, logout).
- Complete hard verification of the commerce engine (checkout integrity + inventory safety).
- Write this 30-section report.
- Create a second local checkpoint commit (no push).

## 3. Repository State

- Monorepo: `apps/web` (Next.js 16), `apps/api` (Hono on Cloudflare Workers), `packages/db` (Neon + Drizzle), `packages/shared` (Zod contracts), `packages/ui`, `packages/config`.
- Prior local checkpoint `d37c075` established the engineering foundation.
- This session's changes (admin auth + staff whitelist + login/change-password pages) are uncommitted and will be included with this report in the second checkpoint commit.

## 4. Architecture Overview

Browser → web (Next) → Like Honey API (`apps/api`, Workers) → business logic → Neon PostgreSQL / R2 (future). The browser never touches the database directly; DB writes live in `apps/api` and `packages/db`. This separation is unchanged and enforced.

## 5. Staff Authentication Model (server-side DB sessions)

- Sessions are stored in the `staff_sessions` table, not JWTs or client-trusted claims.
- On login, a cryptographically random 32-byte token is generated (Web Crypto); only its **SHA-256 hash** is persisted. The server never stores the raw token.
- The raw token is delivered as an `lh_staff_session` cookie: HttpOnly, SameSite, and Secure (except in development, per `SECURE_COOKIES`/`APP_ENV`).
- Default session TTL is 12 hours (`SESSION_HOURS`); expiry is enforced server-side.
- Every request resolves the session by hashing the presented cookie and looking it up; role claims are never accepted from the client.

## 6. Session Lifecycle

- **Login** → `POST /auth/login` (identifier: phone or email + password) → creates a session, sets the cookie, returns staff + permission set + `mustChangePassword`.
- **Me** → `GET /auth/me` resolves the session and returns the current staff profile and granted permissions.
- **Change password** → `POST /auth/change-password` (current + new) validates the current password, rotates the hash, and **revokes that session** (transparent cascade for the UI).
- **Admin reset** → `PUT /staff/:id/password` sets a password and revokes all of that staff member's sessions.
- **Logout** → `POST /auth/logout` deletes the session and expires the cookie.
- Any expired/revoked/inactive-account session resolves to `401`.

## 7. Password & Forced-Change Security

- Passwords are stored as **PBKDF2** hashes with per-user salts; minimum length enforced server-side (8+ chars possibly stricter on change).
- Accounts seeded with `mustChangePassword = true` are directed to the change-password screen and cannot proceed to the admin shell until the password is rotated.
- Passing a wrong current password returns `401` (no information leak); rejects new == current.
- The dev admin was reset to a fresh demoable state with forced-change enabled so the full flow remains demonstrable (values are environment/bootstrapped, never printed here).

## 8. Web AuthProvider

`apps/web/src/lib/admin/auth.tsx` provides `status` (`checking | authenticated | anonymous`), login/logout, and the session-me refresh. Mount resolution was refactored to async `.then` callbacks to satisfy the `react-hooks/set-state-in-effect` lint rule (no synchronous `setState` in effect bodies). `completePasswordChange` performs a transparent re-login after a password rotation.

## 9. Session-Aware IdentityProvider

`identity.tsx` exposes `hasIdentity` and `identityReady` derived from the auth session (`status === 'authenticated'`), so the operational shell knows whether a signed-in staff member is present without trusting client-side role claims.

## 10. Provider Ordering (corrected)

`AdminProviders` runs `LanguageProvider → AuthProvider → IdentityProvider`. Because `identity.tsx` consumes `useAuth()`, it must sit **inside** `AuthProvider`. This ordering is required and verified by typecheck/lint and live behavior.

## 11. Shell Gate & Footer

- The admin shell gates access on auth state and is dev-aware: the development-identity fallback is only recognized in non-production builds.
- The Footer shows the signed-in staff member's name and a logout action.
- The old dev `IdentityControl` was removed from the Footer; the dev-identity fallback now lives on the login page as a clearly separated dev-only section (non-production builds only).

## 12. Admin Login Page

`apps/web/src/app/admin/login/page.tsx` — Arabic/English bilingual form with client validation; safe error mapping (`401 → invalidCredentials`); a guest-cookie state machine; redirects when already authenticated or when a forced password change is pending. Serves RTL HTML (verified `200` + `dir="rtl"`).

## 13. Change-Password Page

`apps/web/src/app/admin/change-password/page.tsx` — validates current/new/confirm, enforces minimum length, calls `POST /auth/change-password`, then redirects to `/admin`. Redirects away when not authenticated (or when a forced change is not applicable).

## 14. Staff Password Dialog

`staff/page.tsx` gained a `StaffPasswordDialog` using the admin set-password client call (`PUT /staff/:id/password`) with localized keys, so an Admin can reset any staff member's password inline.

## 15. Password-Hash Leak — Fix Verified

`services/staff.ts` previously returned the full staff row (including the PBKDF2 `passwordHash`) from list/get/create/update. It was replaced with an explicit whitelist matching the client `StaffDoc` (`id`, `nameAr`, `nameEn`, `phoneNormalized`, `email`, `notes`, `status`, `createdAt`, `updatedAt`; `get` adds `roleIds`). `/auth/me` uses its own safe whitelist and adds `mustChangePassword`. **Live-verified:** `/staff` and `/staff/:id` contain no `passwordHash` and no `mustChangePassword`. This was the most important security defect closed this session.

## 16. Clean Demoable Admin State

The dev admin was reset so that logging in returns `mustChangePassword: true`, preserving the forced-change demo. The admin role carries all 8 permissions: `catalog:read`, `catalog:write`, `inventory:read`, `inventory:write`, `reports:read`, `settings:write`, `staff:write`, `suppliers:write` (verified live).

## 17. Commerce Hard-Verification — Approach

A deterministic verification script (`commerce-verify.mjs`, kept outside the repo) seeded fresh products + a default variant + stock and a delivery zone against the live API (port 8787), then exercised the public cart/checkout and admin inventory endpoints. All fixture ids are unique and targeted; the script cleans up after itself.

## 18. Commerce Verification — Setup Root Cause

Initial failures ("cart line is no longer available" / 400) were traced to the **auto-created default variant being `draft`** by default. The public checkout only buys `active` variants, so a seeded-but-draft variant was correctly rejected. Fix: after creating a product, explicitly set its default variant to `active` before testing. This resolved the mystery and is a deliberate, correct data rule (only active variants are sellable).

## 19. Commerce Verification — Server-Authoritative Pricing

- Cart verify returned the authoritative subtotal = quantity × server-resolved unit price (e.g., line of 2 × 15000 = 30000).
- Order subtotal (30000), delivery fee (5000), and total (35000) were all recomputed from the database; currency `ILS` enforced.
- The server independently resolves the active variant price and the active delivery-zone fee; nothing money-related is taken from the client.

## 20. Commerce Verification — Tampering Ignored

Injected `priceMinor`, `deliveryFee`, `subtotalMinor`, and `totalMinor` fields on cart/checkout payloads are ignored (Zod strips unknown/money keys and the server recomputes). Delivery zones that are bogus/disabled are rejected (`400`). Client-supplied money cannot change an order total.

## 21. Commerce Verification — Stock Concurrency (No Oversell)

- Stock decrement after an order: product A went 5 → 3 (quantity 2) at an atomic DB operation.
- Two concurrent checkouts against a stock-of-1 variant produced **one `201` and one `409`** (insufficient stock) — never a negative balance, no oversell, no double deduction. Stock remained `0` (never negative). The reserved atomic pattern is honored and hard-verified.

## 22. Commerce Verification — Atomic Restore

Cancellation/rollback is represented by a concurrency-safe **RESTOCK** movement (atomic) that restored balance `0 → 1` with `201`. A real admin-order-cancel endpoint is out of V1 and is replaced by this atomic stock-movement proxy for verification purposes.

## 23. Commerce Verification — Cleanup

Test products were archived (removed from the public catalog), the test delivery zone deleted, and the verification orders removed FK-safely. The final dev DB holds **0 orders and 0 products** (verified live).

## 24. Development Data Layer — Final Clean Baseline

After all verification and cleanup, the Development Neon branch contains: schema + migrations intact, system structure preserved (roles, permissions, role-permissions grants, store settings, SKU/order sequence infra), a single active dev Admin staff member, and **no synthetic orders or products**. This is the intended positional state for first real product entry.

## 25. Flows A–G — End-to-End Verification

Verified through the running web proxy (port 3000) and API (port 8787):

- Login with identifier → cookie + permissions returned.
- `/auth/me` resolves the session; forced-change flag honored.
- Wrong current password → `401`; correct → `200` with old session revoked.
- Re-login with new password → `mustChangePassword: false`.
- Logout → `200` + session expired; `/auth/me` → `401` afterward.
- Dev fallback: `/auth/me` is session-only (correct); protected routes accept the dev identity in non-production builds only.
- Admin login page serves RTL Arabic HTML (`200`).

## 26. R2 Media Status — Blocked (Requires Real Credentials)

Real R2 upload tests cannot run because no Cloudflare account/auth is available in this environment. The media wiring path is present but **unverified against real R2**; the report marks this as `REQUIRES REAL R2 CREDENTIALS` and it must be validated before first real product media upload.

## 27. Remaining Blockers

- **R2 / Cloudflare auth** unavailable → real media upload validation blocked.
- **No admin orders-cancel endpoint** in V1 → cancellation verified only via the atomic RESTOCK proxy, not a real cancel action.
- **Customer accounts** are intentionally out of V1 (guest checkout only); not a defect.
- Real production database and production deploy remain off-limits by rule; everything here is Development-only.

## 28. Verification Command Suite

- `pnpm typecheck` — green across all 6 workspaces.
- `pnpm lint` — green across all workspaces; one pre-existing `no-img-element` warning in `products/[productId]/page.tsx` (not introduced by this session).
- Live API/DB probes documented in Sections 5–25.

## 29. What Changed This Session (files)

- `apps/api/src/services/staff.ts` — explicit `StaffDoc` whitelist (closes hash leak).
- `apps/web/src/app/admin/login/`, `apps/web/src/app/admin/change-password/` — new pages.
- `apps/web/src/lib/admin/auth.tsx` — `AuthProvider` (new).
- `apps/web/src/lib/admin/identity.tsx` — session-aware identity.
- `apps/web/src/app/admin/_components/admin-shell.tsx` — provider ordering, dev-aware gate, Footer.
- `apps/web/src/app/admin/staff/page.tsx` — `StaffPasswordDialog`.
- `apps/web/src/lib/admin/client.ts`, `apps/web/src/lib/admin/i18n.tsx` — client + i18n additions.
- `packages/db/scripts/bootstrap-admin.mjs`, `packages/db/scripts/cleanup-dev-fixtures.mjs` — dev tooling updates.

## 30. First-Real-Product Procedure & Conclusion

1. **Provision real R2 credentials** and validate the media upload/stream path (only remaining hard gap).
2. **Add real suppliers** via the admin (`suppliers:write`).
3. **Onboard categories** and mark them active.
4. **Create products** (Arabic-first, English); each auto-creates a default variant.
5. **Explicitly set the variant to `active`** before it becomes sellable (verified data rule).
6. **Seed opening stock** via concurrency-safe inventory movements (`POST /inventory/movements`).
7. **Update delivery zones / store settings** as actual business config (force to real values, not test).
8. **Verify checkout live** on the web storefront for one real product before going wide.
9. **Rotate the dev admin password** and finalize staff accounts before any production data is attached.

All security gates are closed (no hash leaks, no client-trusted money, no overselling), the development data layer is clean, and the admin surface is fully wired.

**Admin and data layer ready for first real Like Honey product.**
