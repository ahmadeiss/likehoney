'use client'

import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CheckCircle2, Star } from 'lucide-react'
import { publicReviewSubmitSchema } from '@likehoney/shared'

import { shopClient } from '../../../../lib/shop/client'
import { useStorefrontLang } from '../../../../lib/shop/locale'

export default function ReviewPage() {
  const { isAr } = useStorefrontLang()
  const [rating, setRating] = useState(0)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || sent) return
    const data = new FormData(event.currentTarget)
    const optional = (key: string) => String(data.get(key) ?? '').trim() || undefined
    const parsed = publicReviewSubmitSchema.safeParse({
      displayName: data.get('displayName'),
      rating,
      reviewText: data.get('reviewText'),
      phone: optional('phone'),
      orderReference: optional('orderReference'),
    })
    if (!parsed.success) {
      setError(
        isAr
          ? 'اختر تقييمًا، وأدخل اسمًا من حرفين على الأقل ورأيًا من 10 أحرف على الأقل. راجع الحقول الاختيارية أيضًا.'
          : 'Choose a rating and enter a name of at least 2 characters and a review of at least 10 characters. Check any optional fields too.',
      )
      requestAnimationFrame(() => feedback.current?.focus())
      return
    }
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      await shopClient.submitReview(parsed.data)
      setSent(true)
    } catch {
      setError(
        isAr
          ? 'تعذّر إرسال رأيك. احتفظنا بما كتبت؛ تحقق من الاتصال وحاول مجددًا.'
          : 'We could not send your review. Your text is still here; check your connection and try again.',
      )
    } finally {
      submitting.current = false
      setPending(false)
      requestAnimationFrame(() => feedback.current?.focus())
    }
  }

  return (
    <section className="lh-review-compose lh-wrap">
      <Link href="/#reviews" className="lh-review-compose__back">
        {isAr ? 'العودة لآراء العائلات' : 'Back to family reviews'}
      </Link>
      <header>
        <span className="lh-section-kicker">
          {isAr ? 'تجربتكم تهمّنا' : 'Your experience matters'}
        </span>
        <h1>{isAr ? 'كيف كانت تجربتكم مع زي العسل؟' : 'How was your Like Honey experience?'}</h1>
        <p>
          {isAr
            ? 'شاركنا رأيك عن المحل أو طلبك. نقرأ كل رأي، ويظهر للعائلات بعد مراجعة الإدارة.'
            : 'Tell us about your visit or order. We read every review and publish it after admin moderation.'}
        </p>
      </header>
      {sent ? (
        <div className="lh-review-compose__success">
          <CheckCircle2 size={36} aria-hidden="true" />
          <h2>{isAr ? 'شكرًا لمشاركتنا تجربتكم' : 'Thank you for sharing'}</h2>
          <p ref={feedback} role="status" tabIndex={-1}>
            {isAr
              ? 'وصل رأيك إلى الإدارة وهو الآن بانتظار المراجعة. لن يظهر للزوار قبل الموافقة عليه.'
              : 'Your review has reached the admin team and is awaiting moderation. It will appear publicly only after approval.'}
          </p>
          <Link href="/shop" className="lh-btn lh-btn--primary">
            {isAr ? 'متابعة التسوّق' : 'Continue shopping'}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="lh-review-compose__form" aria-busy={pending}>
          <fieldset disabled={pending} className="lh-review-compose__fields">
            <fieldset className="lh-review-rating">
              <legend>
                {isAr ? 'تقييمك للتجربة' : 'Your rating'} <span aria-hidden="true">*</span>
              </legend>
              <div className="lh-review-rating__choices">
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="rating"
                      value={value}
                      required
                      checked={rating === value}
                      onChange={() => setRating(value)}
                    />
                    <span>
                      <Star aria-hidden="true" fill={value <= rating ? 'currentColor' : 'none'} />
                      <span>{isAr ? `${value} من 5` : `${value} of 5`}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="lh-field">
              <label htmlFor="review-name">
                {isAr ? 'الاسم الذي سيظهر مع رأيك' : 'Public display name'} *
              </label>
              <input
                id="review-name"
                name="displayName"
                autoComplete="nickname"
                required
                minLength={2}
                maxLength={80}
              />
            </div>
            <div className="lh-field">
              <label htmlFor="review-text">
                {isAr ? 'احكِ لنا عن تجربتك' : 'Tell us about your experience'} *
              </label>
              <textarea
                id="review-text"
                name="reviewText"
                required
                minLength={10}
                maxLength={1000}
                rows={5}
                aria-describedby="review-text-hint"
              />
              <p id="review-text-hint" className="lh-review-compose__hint">
                {isAr
                  ? 'من 10 إلى 1000 حرف. تجنّب كتابة رقم هاتفك أو أي معلومات خاصة هنا.'
                  : '10–1,000 characters. Please keep phone numbers and other private details out of your review.'}
              </p>
            </div>
            <details>
              <summary>
                {isAr
                  ? 'اشتريت منّا؟ أضف تفاصيل الشراء (اختياري)'
                  : 'Purchased from us? Add purchase details (optional)'}
              </summary>
              <p className="lh-review-compose__hint">
                {isAr
                  ? 'تستخدم الإدارة هذه التفاصيل للتحقق من الشراء. لا يظهر هاتفك أو رقم طلبك للزوار.'
                  : 'These details help verify a purchase. Your phone and order reference are never displayed publicly.'}
              </p>
              <div className="lh-field">
                <label htmlFor="review-phone">
                  {isAr ? 'رقم الهاتف المستخدم عند الشراء' : 'Phone used for the purchase'}
                </label>
                <input
                  id="review-phone"
                  name="phone"
                  type="tel"
                  dir="ltr"
                  autoComplete="tel"
                  minLength={6}
                  maxLength={32}
                />
              </div>
              <div className="lh-field">
                <label htmlFor="review-reference">
                  {isAr ? 'رقم الطلب أو الفاتورة' : 'Order or receipt reference'}
                </label>
                <input
                  id="review-reference"
                  name="orderReference"
                  dir="ltr"
                  minLength={3}
                  maxLength={40}
                />
              </div>
            </details>
          </fieldset>
          {error ? (
            <p className="lh-review-compose__error" role="alert" tabIndex={-1} ref={feedback}>
              {error}
            </p>
          ) : null}
          <div className="lh-review-compose__submit">
            <button type="submit" className="lh-btn lh-btn--primary" disabled={pending}>
              {pending
                ? isAr
                  ? 'جارٍ إرسال رأيك…'
                  : 'Sending…'
                : isAr
                  ? 'إرسال رأيي للمراجعة'
                  : 'Submit for review'}
            </button>
            <span>{isAr ? 'الحقول بعلامة * مطلوبة' : '* Required fields'}</span>
          </div>
        </form>
      )}
    </section>
  )
}
