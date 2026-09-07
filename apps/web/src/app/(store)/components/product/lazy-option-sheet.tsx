'use client'

import dynamic from 'next/dynamic'
import { useStorefrontLang } from '../../../../lib/shop/locale'

function LoadingOptions() {
  const { isAr } = useStorefrontLang()
  return (
    <div className="catalog-option-loading" role="status">
      {isAr ? 'جارٍ فتح الخيارات…' : 'Opening options…'}
    </div>
  )
}
export const LazyOptionSheet = dynamic(
  () => import('./option-sheet').then((module) => module.OptionSheet),
  { loading: LoadingOptions },
)
