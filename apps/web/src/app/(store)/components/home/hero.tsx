'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import { HoneyDrip } from '../storefront/honey-drip'

export function Hero() {
  const { isAr } = useStorefrontLang()
  const Arrow = isAr ? ArrowLeft : ArrowRight
  return (
    <section className="hive-hero" aria-labelledby="campaign-title">
      <HoneyDrip />
      <HoneyDrip side />
      <div className="hive-hero__ceiling" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="hive-hero__inner lh-wrap">
        <div className="hive-hero__copy">
          <p className="hive-eyebrow">
            <span />
            {isAr ? 'نفس المحل اللي بتحبّوه، صار أقرب' : 'YOUR FAVOURITE LITTLE STORE, NOW CLOSER'}
          </p>
          <h1 id="campaign-title">
            {isAr ? 'افتحوا الباب' : 'Step inside'}
            <br />
            {isAr ? 'لعالم ' : 'a world of '}
            <span>{isAr ? 'زي العسل.' : 'little joys.'}</span>
          </h1>
          <p className="hive-hero__lead">
            {isAr
              ? 'من رفوف محلّنا لاختياراتكم. ملابس، أحذية، شنط وألعاب… تفاصيل تفرّح صغاركم، وتخلّي كل يوم أحلى.'
              : 'From our shelves to your favourites. Clothing, shoes, bags and toys — little details to brighten their every day.'}
          </p>
          <div className="hive-hero__actions">
            <Link href="/shop" className="atelier-button">
              {isAr ? 'خذوا جولة في المتجر' : 'Explore the store'}
              <Arrow size={20} />
            </Link>
            <Link href="#collection" className="atelier-text-link">
              {isAr ? 'شوفوا التشكيلة' : 'Meet the collection'}
              <Arrow size={18} />
            </Link>
          </div>
          <p className="hive-hero__origin">
            <MapPin size={16} strokeWidth={1.5} />
            {isAr ? 'من جنين، بكل حب لصغاركم' : 'From Jenin, with love for your little ones'}
          </p>
        </div>
        <div
          className="hive-display"
          aria-label={isAr ? 'هوية زي العسل' : 'The Like Honey identity'}
        >
          <div className="hive-display__cloud hive-display__cloud--one" aria-hidden="true" />
          <div className="hive-display__cloud hive-display__cloud--two" aria-hidden="true" />
          <div className="hive-display__cell hive-display__cell--pink" aria-hidden="true">
            <span />
          </div>
          <div className="hive-display__cell hive-display__cell--blue" aria-hidden="true">
            <span />
          </div>
          <div className="hive-display__main">
            <div className="hive-display__inside">
              <Image
                src="/brand/merch/like-honey-logo-primary.png"
                alt="Like Honey — زي العسل — Kids store"
                width={360}
                height={360}
                sizes="(max-width: 760px) 220px, 310px"
                priority
              />
            </div>
          </div>
          <div className="hive-display__shelf" aria-hidden="true" />
          <span className="hive-display__caption">
            {isAr ? 'محل صغير، فرحة كبيرة.' : 'A little store. A whole lot of joy.'}
          </span>
        </div>
      </div>
      <div className="hive-hero__foot lh-wrap">
        <span>
          {isAr ? 'اختاروا بحب. والباقي علينا.' : 'Choose with love. We’ll take it from here.'}
        </span>
        <a href="#categories">
          {isAr ? 'اكتشفوا عالمهم' : 'Discover their world'}
          <Arrow size={17} />
        </a>
      </div>
    </section>
  )
}
