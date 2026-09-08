'use client'

import { BadgeCheck } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type ReactElement } from 'react'

import { shopClient, type PublicReviewDoc } from '../../../../lib/shop/client'
import { useStorefrontLang } from '../../../../lib/shop/locale'

const HEAD: Record<'ar' | 'en', { kicker: string; title: string; sub: string }> = {
  ar: {
    kicker: 'آراء العائلات',
    title: 'ماذا يقول الأهالي',
    sub: 'تجارب العائلات مع زي العسل — تُنشر بعد مراجعة الإدارة.',
  },
  en: {
    kicker: 'From families',
    title: 'What families say',
    sub: 'Family experiences with Like Honey — published after admin moderation.',
  },
}

const EMPTY: Record<'ar' | 'en', string> = {
  ar: 'لا توجد آراء بعد — يشرفنا أن يسمع منا الأهالي عند أول الطلبات.',
  en: 'No reviews yet — we look forward to hearing from families on the first orders.',
}

function Star({ filled }: { filled: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`lh-review-card__star${filled ? '' : ' lh-review-card__star--empty'}`}
      aria-hidden="true"
    >
      <path d="M12 2.5 14.9 9l7 .6-5.3 4.6 1.6 6.9L12 17.6 5.8 21.1l1.6-6.9L2.1 9.6l7-.6L12 2.5Z" />
    </svg>
  )
}

function formatDate(iso: string, lang: 'ar' | 'en'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(lang === 'ar' ? 'ar-PS' : 'en-GB', {
    year: 'numeric',
    month: 'long',
  })
}

/**
 * Home reviews — REAL approved store reviews only (`/reviews` already filters
 * to approved reviews; nothing here is fabricated). Three-column
 * grid, star rating, verified-purchase chip when the order truly was
 * verified. A polite empty state handles a fresh store with zero reviews.
 */
export function Reviews(): ReactElement {
  const { lang, isAr } = useStorefrontLang()
  const [reviews, setReviews] = useState<PublicReviewDoc[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    shopClient
      .listReviews(12)
      .then((res) => {
        if (!cancelled) setReviews(res.data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <section className="lh-section lh-section--tall" id="reviews">
      <div className="lh-wrap">
        <header className="lh-section-head">
          <span className="lh-section-kicker">{HEAD[lang].kicker}</span>
          <h2 className="lh-section-title">{HEAD[lang].title}</h2>
          <p className="lh-section-sub">{HEAD[lang].sub}</p>
          <Link href="/shop/review" className="lh-btn lh-btn--secondary lh-reviews__write">
            {isAr ? 'شاركنا تجربتك' : 'Write a review'}
          </Link>
        </header>

        {failed ? (
          <div className="lh-reviews__empty" role="status">
            <p>{isAr ? 'تعذّر تحميل الآراء حاليًا.' : 'Reviews could not be loaded.'}</p>
            <button
              className="lh-btn lh-btn--secondary"
              type="button"
              onClick={() => {
                setFailed(false)
                setAttempt((value) => value + 1)
              }}
            >
              {isAr ? 'حاول مجددًا' : 'Try again'}
            </button>
          </div>
        ) : !reviews ? (
          <div className="lh-reviews__grid" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="lh-skel" style={{ height: '12rem' }} />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="lh-reviews__empty">
            <p>{EMPTY[lang]}</p>
          </div>
        ) : (
          <div className="lh-reviews__grid">
            {reviews.map((review) => (
              <article className="lh-review-card" key={review.id}>
                <div className="lh-review-card__stars" role="img" aria-label={`${review.rating}/5`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} filled={i < review.rating} />
                  ))}
                </div>
                <p className="lh-review-card__text">{review.reviewText}</p>
                <footer className="lh-review-card__meta">
                  <span className="lh-review-card__name">{review.displayName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDate(review.createdAt, lang)}</span>
                  {review.verifiedPurchase ? (
                    <span className="lh-review-card__verified">
                      <BadgeCheck aria-hidden="true" />
                      {isAr ? 'شراء موثق' : 'Verified'}
                    </span>
                  ) : null}
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
