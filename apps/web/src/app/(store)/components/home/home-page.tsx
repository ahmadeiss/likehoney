import type { ReactElement } from 'react'

import { CategoryDiscovery } from './category-discovery'
import { EditorialBand } from './editorial-band'
import { FeaturedProducts } from './featured-products'
import { Hero } from './hero'
import { Reviews } from './reviews'
import { TrustStrip } from './trust'

/**
 * The composed storefront home.
 *
 * Logo-led introduction, numbered categories, real products, brand story,
 * verified reviews and service information. Decorative photos are excluded.
 */
export default function HomePage(): ReactElement {
  return (
    <>
      <Hero />
      <CategoryDiscovery />
      <FeaturedProducts />
      <EditorialBand />
      <Reviews />
      <TrustStrip />
    </>
  )
}
