'use client'

import { useEffect, useState } from 'react'
import { shopClient, type PublicProductListItem } from './client'
import { CATALOG_PAGE_SIZE } from './catalog-pagination'

type Result = {
  key: string
  family: string
  page: number
  products: PublicProductListItem[]
  total: number
  failed: boolean
}

/** Abort obsolete requests and never render a previous filter's products as current. */
export function useCatalogProducts(page: number, category: string, search: string) {
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const family = JSON.stringify([category, search])
  const key = JSON.stringify([page, category, search, attempt])
  useEffect(() => {
    const controller = new AbortController()
    shopClient
      .listProducts(
        {
          page,
          pageSize: CATALOG_PAGE_SIZE,
          categorySlug: category || undefined,
          search: search || undefined,
        },
        controller.signal,
      )
      .then(({ data, meta }) => {
        if (!controller.signal.aborted)
          setResult({ key, family, page, products: data, total: meta.total, failed: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedKey(key)
      })
    return () => controller.abort()
  }, [page, category, search, key, family])
  const visible = result?.family === family ? result : null
  const failed = failedKey === key
  return {
    result:
      visible ?? (failed ? { key, family, page, products: [], total: 0, failed: true } : null),
    pending: result?.key !== key && !failed,
    failed,
    retry: () => setAttempt((value) => value + 1),
  }
}
