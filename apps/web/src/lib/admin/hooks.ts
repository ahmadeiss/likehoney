'use client'

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

import { ApiError } from './client'
import { subscribeCatalog, subscribeOrders } from './revalidate'

export interface ResourceState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
}

function normalizeError(cause: unknown): ApiError {
  return cause instanceof ApiError ? cause : new ApiError(0, 'unknown_error', 'unknown error')
}

/**
 * Runs a loader on mount and whenever `deps` change. Errors are normalized to
 * `ApiError` so surfaces can map them bilingually. `reload()` refetches and
 * immediately flips to the loading state (event handler, so it stays compliant
 * with the React hooks rules).
 */
export interface ResourceOptions {
  /**
   * Refetch whenever a catalog/inventory mutation fires `bumpCatalog()` — so a
   * status change on one screen is reflected on every other live screen without
   * a manual refresh. Opt in for surfaces that show catalog/inventory state.
   */
  revalidate?: boolean
  /** Refetch whenever an order lifecycle transition fires `bumpOrders()`. */
  revalidateOrders?: boolean
}

export function useResource<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  options: ResourceOptions = {},
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  const [reloadTick, setReloadTick] = useState(0)
  // requested > completed during an in-flight request; starts loading=true.
  const [revision, setRevision] = useState({ requested: 0, completed: -1 })
  const loading = revision.requested > revision.completed

  const loaderRef = useRef(loader)
  const depsRef = useRef(deps)
  useEffect(() => {
    loaderRef.current = loader
  })
  useEffect(() => {
    depsRef.current = deps
  })

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setRevision((current) => ({ ...current, requested: current.requested + 1 }))
    })
    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError(null)
        setRevision((current) => ({ requested: current.requested, completed: current.requested }))
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(normalizeError(cause))
        setRevision((current) => ({ requested: current.requested, completed: current.requested }))
      })
    return () => {
      cancelled = true
    }
    // depsRef keeps the loaded set stable; the array only needs to re-run on changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick])

  const reload = useCallback(() => {
    setReloadTick((value) => value + 1)
    setRevision((current) => ({ ...current, requested: current.requested + 1 }))
  }, [])

  // Cross-screen freshness: refetch when any catalog/inventory mutation lands.
  const revalidate = options.revalidate === true
  useEffect(() => {
    if (!revalidate) return
    return subscribeCatalog(() => {
      setReloadTick((value) => value + 1)
      setRevision((current) => ({ ...current, requested: current.requested + 1 }))
    })
  }, [revalidate])

  // Cross-screen freshness for order lifecycle transitions.
  const revalidateOrders = options.revalidateOrders === true
  useEffect(() => {
    if (!revalidateOrders) return
    return subscribeOrders(() => {
      setReloadTick((value) => value + 1)
      setRevision((current) => ({ ...current, requested: current.requested + 1 }))
    })
  }, [revalidateOrders])

  return { data, error, loading, reload }
}

export type MutationResult<T, E = ApiError> = { ok: true; data: T } | { ok: false; error: E }

/**
 * Wraps a side-effecting API call with a `pending` flag; never throws.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): { run: (...args: TArgs) => Promise<MutationResult<TResult>>; pending: boolean } {
  const [pending, setPending] = useState(false)
  const active = useRef<Promise<MutationResult<TResult>> | null>(null)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  const run = useCallback((...args: TArgs): Promise<MutationResult<TResult>> => {
    if (active.current) return active.current
    setPending(true)
    const request = (async (): Promise<MutationResult<TResult>> => {
      try {
        const data = await Promise.resolve().then(() => fnRef.current(...args))
        return { ok: true, data }
      } catch (cause) {
        return { ok: false, error: normalizeError(cause) }
      } finally {
        active.current = null
        setPending(false)
      }
    })()
    active.current = request
    return request
  }, [])

  return { run, pending }
}
