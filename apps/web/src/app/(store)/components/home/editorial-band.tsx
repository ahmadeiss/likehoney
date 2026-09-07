'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import { HoneyDrip } from '../storefront/honey-drip'

export function EditorialBand() {
  const { isAr } = useStorefrontLang()
  return (
    <section className="hive-story lh-wrap" id="our-world">
      <div className="hive-story__identity">
        <HoneyDrip />
        <span className="hive-eyebrow">
          {isAr ? 'حكايتنا من جنين' : 'OUR STORY STARTS IN JENIN'}
        </span>
        <h2>
          {isAr ? 'نفس الدفء.' : 'The same warmth.'}
          <br />
          <span>{isAr ? 'نفس زي العسل.' : 'The same Like Honey.'}</span>
        </h2>
        <div className="hive-story__stripes" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="hive-story__copy">
        <p>
          {isAr
            ? 'من باب المحل الأصفر، للرفوف البيضاء والتفاصيل الملوّنة… كل زاوية عندنا معمولة عشان تفرّحهم.'
            : 'From our yellow doorway to the white shelves and colourful little details, every corner of our store is made to bring them joy.'}
        </p>
        <p>
          {isAr
            ? 'وهون كمان، بتلاقوا اختياراتنا نفسها. خذوا راحتكم، لفّوا بين الأقسام، واختاروا القطعة اللي بتشبه صغيركم.'
            : 'You’ll find those same thoughtful picks right here. Take your time, explore the shelves, and find the piece that feels just like them.'}
        </p>
        <Link href="/shop" className="atelier-text-link">
          {isAr ? 'أهلًا في محلّكم' : 'Welcome to your little store'}
          {isAr ? <ArrowLeft size={19} /> : <ArrowRight size={19} />}
        </Link>
      </div>
    </section>
  )
}
