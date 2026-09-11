'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import '../../styles/client-hero.css'

const campaignImage = '/media/campaign/client-hero-v3.png'

export function Hero() {
  const { isAr } = useStorefrontLang()
  return (
    <section className="client-hero" aria-labelledby="campaign-title">
      <div className="client-hero__scene" aria-hidden="true">
        <Image
          className="client-hero__panorama"
          src={campaignImage}
          alt=""
          width={2172}
          height={724}
          sizes="100vw"
          preload
        />
        <div className="client-hero__mobile-art client-hero__mobile-art--bee">
          <Image src={campaignImage} alt="" width={2172} height={724} sizes="155vw" />
        </div>
        <div className="client-hero__mobile-art client-hero__mobile-art--products">
          <Image src={campaignImage} alt="" width={2172} height={724} sizes="155vw" />
        </div>
      </div>
      <div className="client-hero__copy">
        <p className="client-hero__eyebrow">
          {isAr ? 'كل ما يحتاجه طفلك' : 'Everything your little one needs'}
        </p>
        <h1 id="campaign-title">
          <span className="client-hero__headline-line">
            {isAr ? 'من ' : ''}
            <em>{isAr ? 'أحذية' : 'Shoes'}</em>
            {isAr ? ' وشنط' : ' & bags'}
          </span>
          <span>{isAr ? 'وإكسسوارات' : '& accessories'}</span>
        </h1>
        <p className="client-hero__description">
          {isAr ? 'بجودة عالية وتصاميم مميزة' : 'Lovely quality. Delightful little details.'}
        </p>
        <Link className="client-hero__cta" href="/shop">
          <ShoppingBag size={21} strokeWidth={1.6} aria-hidden="true" />
          {isAr ? 'تسوّقي الآن' : 'Shop now'}
        </Link>
      </div>
    </section>
  )
}
