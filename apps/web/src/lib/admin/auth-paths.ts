/**
 * Admin routes that render outside the operational shell (the full-screen,
 * chrome-less surfaces like sign-in). Everything else is served by the shell,
 * which requires an authenticated session. Kept in its own module so the guard
 * policy is unit-testable without pulling in React components.
 */
export const AUTH_PATHS = ['/admin/login'] as const

export function isAdminAuthPath(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname as (typeof AUTH_PATHS)[number])
}
