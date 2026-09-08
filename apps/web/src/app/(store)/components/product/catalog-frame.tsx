'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { reserveCatalogFrame } from '../../../../lib/shop/catalog-frame'

/** Keep the reader's document position even on a short last page or a failed fetch.
 * Width changes start a new measurement; pagination never restores scroll manually. */
export function CatalogFrame({ children, pending }: { children: ReactNode; pending: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const outer = frame.current
    const inner = content.current
    if (!outer || !inner) return
    let reserved = { width: 0, height: 0 }
    const measure = () => {
      const box = inner.getBoundingClientRect()
      reserved = reserveCatalogFrame(reserved, box)
      outer.style.minHeight = `${reserved.height}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={frame} className="catalog-frame" aria-busy={pending}>
      <div ref={content} className="catalog-frame__content" data-pending={pending}>
        {children}
      </div>
    </div>
  )
}
