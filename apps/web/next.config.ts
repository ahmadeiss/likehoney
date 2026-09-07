import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Transpile workspace packages consumed from source rather than publish output.
  transpilePackages: ['@likehoney/db', '@likehoney/shared', '@likehoney/ui'],

  // Dev-only: the local browser harness (and any teammate on the same
  // machine) may load the admin dev server via its loopback IP instead of
  // `localhost`, which Next's dev-resource origin check otherwise blocks
  // (repeated "Blocked cross-origin request" warnings for /_next/* and HMR).
  // Scoped to loopback hosts only — never a wildcard — and has no effect on
  // the production build.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  // `next/image` requires any LOCAL (same-origin) source that carries a query
  // string to be explicitly allowlisted (a hardening default against
  // local-path SSRF/cache-poisoning) — and once `localPatterns` is set at
  // all, it becomes the allowlist for every local `next/image` source, not
  // just the query-string ones, so the static brand assets need a pattern
  // too. The media-stream pattern's `key=` is a server-minted,
  // non-guessable R2 object key, never arbitrary user input.
  images: {
    localPatterns: [
      // `search` is intentionally omitted — that means "any search string
      // allowed" (not "none"), which is what a real `?key=<object key>` needs.
      { pathname: '/api/v1/public/media/stream' },
      { pathname: '/brand/**' },
      { pathname: '/media/**' },
    ],
  },

  // `/shop/catalog` is retired in favor of the canonical `/shop` (storefront
  // rebuild Phase 2, §1) — resolved entirely at the routing layer, before any
  // page renders, so there is no flash of the old catalog UI. `search`/`page`
  // pass through automatically (Next forwards query params the destination
  // doesn't itself define); the first rule renames the old `categorySlug` to
  // the canonical `category` for links that used it, the second is the plain
  // catch-all for everything else.
  async redirects() {
    return [
      {
        source: '/shop/catalog',
        has: [{ type: 'query', key: 'categorySlug', value: '(?<categorySlugValue>.*)' }],
        destination: '/shop?category=:categorySlugValue',
        permanent: false,
      },
      {
        source: '/shop/catalog',
        destination: '/shop',
        permanent: false,
      },
    ]
  },

  async rewrites() {
    return [
      // The design lab lives internally at /lab (Next treats any "_"-prefixed folder
      // as private and excludes it from routing), exposed canonically as /__design.
      { source: '/__design/:path*', destination: '/lab/:path*' },
      // The admin browser talks to the Like Honey API through a same-origin path so
      // requests stay behind the web origin (no CORS, no credentials to the browser).
      // API_ORIGIN defaults to the local dev Worker; production deploys set it to the
      // deployed API base URL.
      {
        source: '/api/v1/:path*',
        destination: `${process.env.API_ORIGIN ?? 'http://127.0.0.1:8787'}/api/v1/:path*`,
      },
    ]
  },
}

export default nextConfig
