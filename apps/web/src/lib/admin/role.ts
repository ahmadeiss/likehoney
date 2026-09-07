'use client'

/**
 * Admin role is *derived from permissions*, never from a hardcoded identity.
 *
 * An account that can manage staff, manage settings, or read reports is running
 * the business — it lands on the owner surface (decision-first: overview,
 * what-needs-attention, reorder). Everyone else is a store employee — they land
 * on the operations surface (action-first: find a product, adjust stock, sell
 * in store). The backend RBAC remains authoritative for every request; this
 * only decides which *front door* a signed-in person sees.
 *
 * The development identity picker resolves through `GET /auth/me` too (the dev
 * `X-Staff-Id` header is honored there on a loopback host), so `me.permissions`
 * is always the selected staff member's real effective set — no owner fallback.
 */
import { useAuth } from './auth'

export type AdminRole = 'owner' | 'employee'

/** Permissions that only a business owner / manager would hold. */
const OWNER_SIGNALS = ['staff:write', 'settings:write', 'reports:read'] as const

export function roleFromPermissions(permissions: readonly string[]): AdminRole {
  return OWNER_SIGNALS.some((code) => permissions.includes(code)) ? 'owner' : 'employee'
}

export function useAdminRole(): AdminRole {
  const { me } = useAuth()
  return roleFromPermissions(me?.permissions ?? [])
}
