'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Heart, MapPin } from 'lucide-react'
import { useStorefrontLang } from '../../../../lib/shop/locale'
import '../../styles/reference-hero.css'

const merchandise = [
  { name: 'girl-bag', className: 'pink-bag' },
  { name: 'boy-bag', className: 'blue-bag' },
  { name: 'girl-shoes', className: 'pink-shoes' },
  { name: 'boy-shoes-white', className: 'blue-shoes' },
  { name: 'kids-accessories-v2', className: 'accessories' },
] as const

function DisplayCell({
  x,
  y,
  radius,
  color,
}: {
  x: number
  y: number
  radius: number
  color: string
}) {
  const shape = 'M-1 0L-.5 -.866H.5L1 0L.5 .866H-.5Z'
  return (
    <g transform={`translate(${x} ${y}) scale(${radius})`} stroke="none">
      <path d={shape} fill="url(#cell-bevel)" />
      <path d={shape} transform="scale(.86)" fill={color} />
      <path
        d="M-.5 .866L-1 0L-.5 -.866H.5"
        fill="none"
        stroke="#fff3df"
        strokeWidth=".035"
        strokeOpacity=".8"
      />
    </g>
  )
}
function DisplayPlinth({
  x,
  y,
  radius,
  height,
  tone,
}: {
  x: number
  y: number
  radius: number
  height: number
  tone: 'peach' | 'amber' | 'cream'
}) {
  const depth = radius * 0.18
  return (
    <g>
      <path
        d={`M${x - radius} ${y}v${height}a${radius} ${depth} 0 0 0 ${radius * 2} 0v-${height}Z`}
        fill={`url(#plinth-${tone})`}
      />
      <ellipse
        cx={x}
        cy={y}
        rx={radius}
        ry={depth}
        fill={`url(#plinth-top-${tone})`}
        stroke="#fff1dd"
        strokeOpacity=".65"
        strokeWidth="1.2"
      />
      <path
        d={`M${x - radius} ${y}a${radius} ${depth} 0 0 0 ${radius * 2} 0`}
        stroke="#a86027"
        strokeOpacity=".16"
        strokeWidth="1.5"
      />
    </g>
  )
}
/** Fixed stage proportions preserve the reference composition at every viewport. */
function StoreDisplay() {
  return (
    <div className="reference-display" aria-hidden="true">
      <svg className="reference-display__set" viewBox="0 0 800 560" fill="none">
        <defs>
          {' '}
          {(
            [
              ['peach', '#f4c4a5', '#d58d66', '#b97150', '#f9d5b9', '#eaaa83'],
              ['amber', '#f5c477', '#e4a34c', '#c58130', '#ffe0a2', '#f0bd6b'],
              ['cream', '#f8e4c6', '#e4c49c', '#cfaa7e', '#fff1d9', '#edcfaa'],
            ] as const
          ).map(([tone, light, mid, dark, topLight, topDark]) => (
            <g key={tone}>
              <linearGradient id={`plinth-${tone}`} x1="0" y1="0" x2="1" y2="0">
                <stop stopColor={light} />
                <stop offset=".45" stopColor={mid} />
                <stop offset="1" stopColor={dark} />
              </linearGradient>
              <linearGradient id={`plinth-top-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <stop stopColor={topLight} />
                <stop offset="1" stopColor={topDark} />
              </linearGradient>
            </g>
          ))}
          <linearGradient id="cell-bevel" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#c88b61" />
            <stop offset=".48" stopColor="#f2d1ac" />
            <stop offset="1" stopColor="#fff1dc" />
          </linearGradient>
          <radialGradient id="cell-recess" cx="75%" cy="35%" r="85%">
            <stop stopColor="#fff5e2" />
            <stop offset=".7" stopColor="#f3d6ae" />
            <stop offset="1" stopColor="#d6ac7e" />
          </radialGradient>
          <filter id="display-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="9" stdDeviation="7" floodColor="#976f44" floodOpacity=".24" />
          </filter>
        </defs>
        <g stroke="#fffdf7" strokeWidth="10" filter="url(#display-shadow)">
          <DisplayCell x={160} y={140} radius={110} color="#b8d9d6" />
          <DisplayCell x={552} y={105} radius={56} color="#e8b4aa" />
          <DisplayCell x={622} y={175} radius={46} color="#b8d9d6" />
          <DisplayCell x={745} y={197} radius={36} color="#d5dfcb" />
          <DisplayCell x={749} y={368} radius={48} color="#edbb8d" />
          <DisplayCell x={63} y={321} radius={60} color="#f1d2a6" />
          <DisplayCell x={275} y={75} radius={36} color="#f5e3c5" />
          <path
            d="M300 90H490L588 260L490 430H300L202 260Z"
            fill="url(#cell-bevel)"
            strokeWidth="5"
          />
        </g>
        <path d="M309 108H481L568 260L481 412H309L222 260Z" fill="url(#cell-recess)" />
        <ellipse cx="401" cy="538" rx="352" ry="15" fill="#aa7040" opacity=".12" />
        <g filter="url(#display-shadow)">
          <DisplayPlinth x={159} y={365} radius={117} height={141} tone="peach" />
          <DisplayPlinth x={651} y={390} radius={105} height={119} tone="peach" />
          <DisplayPlinth x={397} y={493} radius={100} height={42} tone="cream" />
          <DisplayPlinth x={166} y={510} radius={124} height={30} tone="amber" />
          <DisplayPlinth x={651} y={511} radius={121} height={29} tone="amber" />
        </g>{' '}
      </svg>
      <div className="reference-display__logo">
        <Image
          src="/brand/merch/main-logo-bg.png"
          alt=""
          fill
          sizes="(max-width: 760px) 30vw, 19vw"
          preload
        />
      </div>
      {merchandise.map(({ name, className }) => (
        <div className={`reference-display__product reference-display__${className}`} key={name}>
          <Image
            src={`/brand/merch/${name}.png`}
            alt=""
            fill
            sizes="(max-width: 760px) 25vw, 17vw"
            loading="eager"
          />
        </div>
      ))}
    </div>
  )
}

export function Hero() {
  const { isAr } = useStorefrontLang()
  const Arrow = isAr ? ArrowLeft : ArrowRight
  return (
    <section className="reference-hero" aria-labelledby="campaign-title">
      <div className="reference-hero__art" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <Heart className="reference-hero__heart" size={22} strokeWidth={1.5} />
      </div>
      <div className="reference-hero__inner lh-wrap">
        <div className="reference-hero__copy">
          <p className="reference-hero__eyebrow">
            <span />
            {isAr ? 'نفس المحل اللي بتحبّوه، صار أقرب' : 'YOUR FAVOURITE LITTLE STORE, NOW CLOSER'}
          </p>
          <h1 id="campaign-title">
            {isAr ? 'افتحوا الباب' : 'Step inside'}
            <br />
            {isAr ? 'لعالم ' : 'a world of '}
            <span>{isAr ? 'زي العسل.' : 'little joys.'}</span>
          </h1>
          <p className="reference-hero__lead">
            {isAr
              ? 'من رفوف محلّنا لاختياراتكم. أحذية، شنط واكسسوارات… تفاصيل تفرّح صغاركم، وتخلّي كل يوم أحلى.'
              : 'From our shelves to your favourites. Clothing, shoes, bags and toys — little details to brighten their every day.'}
          </p>
          <div className="reference-hero__actions">
            <Link href="/shop" className="reference-hero__button">
              {isAr ? 'خذوا جولة في المتجر' : 'Explore the store'}
              <Arrow size={20} aria-hidden="true" />
            </Link>
            <Link href="#collection" className="reference-hero__link">
              {isAr ? 'شوفوا التشكيلة' : 'Meet the collection'}
              <Arrow size={18} aria-hidden="true" />
            </Link>
          </div>
          <p className="reference-hero__origin">
            <MapPin size={16} strokeWidth={1.5} aria-hidden="true" />
            {isAr ? 'من جنين، بكل حب لصغاركم' : 'From Jenin, with love for your little ones'}
          </p>
        </div>
        <div className="reference-hero__visual">
          <StoreDisplay />
          <p>
            {isAr ? 'أحذية، شنط وإكسسوارات لصغاركم.' : 'Shoes, bags & accessories for little ones.'}
          </p>
        </div>
      </div>
      <div className="reference-hero__foot lh-wrap">
        <span>
          {isAr ? 'اختاروا بحب. والباقي علينا.' : 'Choose with love. We’ll take it from here.'}
        </span>
        <Link href="#categories">
          {isAr ? 'اكتشفوا عالمهم' : 'Discover their world'}
          <Arrow size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
