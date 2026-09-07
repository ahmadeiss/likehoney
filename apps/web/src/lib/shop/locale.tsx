'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

/**
 * Storefront language/region controller — Arabic (RTL) default, English (LTR).
 *
 * The storefront is fully bilingual: every surface (home, catalog, product,
 * cart, checkout, validation/errors, navigation) reads from the active locale.
 * The preference is persisted in `localStorage` and applied to the document
 * (`lang`/`dir`) so the whole shell flips direction. Content values with
 * `*_ar` / `*_en` pairs are resolved from API data; UI chrome resolves from the
 * copy dictionary.
 *
 * The active language is read via `useSyncExternalStore` (SSR-safe, no render
 * phase) so the storefront subscribes to `localStorage` changes without needing
 * a synchronous `setState` inside an effect.
 */

export type StorefrontLang = 'ar' | 'en'
export type StorefrontDir = 'rtl' | 'ltr'

export const STOREFRONT_LANG_KEY = 'lh:storefront:lang'

export function dirFor(lang: StorefrontLang): StorefrontDir {
  return lang === 'ar' ? 'rtl' : 'ltr'
}

export function applyDocumentLang(lang: StorefrontLang): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('lang', lang)
  document.documentElement.setAttribute('dir', dirFor(lang))
}

function readStoredLang(): StorefrontLang {
  if (typeof window === 'undefined') return 'ar'
  return window.localStorage.getItem(STOREFRONT_LANG_KEY) === 'en' ? 'en' : 'ar'
}

function writeStoredLang(lang: StorefrontLang): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STOREFRONT_LANG_KEY, lang)
  emitLangChange()
}

const langSubscribers = new Set<() => void>()

function emitLangChange(): void {
  for (const listener of langSubscribers) listener()
}

function subscribeLang(onChange: () => void): () => void {
  langSubscribers.add(onChange)
  return () => {
    langSubscribers.delete(onChange)
  }
}

interface StorefrontLangContextValue {
  lang: StorefrontLang
  dir: StorefrontDir
  isAr: boolean
  setLang: (lang: StorefrontLang) => void
  /** Resolve a bilingual value: prefers the active language. */
  pick: (valueAr: string | null | undefined, valueEn: string | null | undefined) => string
  /** Convert Arabic-Indic digits to Western digits for the English locale. */
  number: (num: string) => string
}

const StorefrontLangContext = createContext<StorefrontLangContextValue | null>(null)

export function StorefrontLangProvider({ children }: { children: ReactNode }): ReactNode {
  const lang = useSyncExternalStore<StorefrontLang>(subscribeLang, readStoredLang, () => 'ar')

  useEffect(() => {
    applyDocumentLang(lang)
  }, [lang])

  const setLang = useCallback((next: StorefrontLang) => {
    writeStoredLang(next)
  }, [])

  const value = useMemo<StorefrontLangContextValue>(
    () => ({
      lang,
      dir: dirFor(lang),
      isAr: lang === 'ar',
      setLang,
      pick: (valueAr, valueEn) =>
        lang === 'ar' ? (valueAr ?? valueEn ?? '') : (valueEn ?? valueAr ?? ''),
      number: (num) =>
        lang === 'ar'
          ? num
          : num
              .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
              .replace(/[0-9]/g, (d) => d),
    }),
    [lang, setLang],
  )

  return <StorefrontLangContext.Provider value={value}>{children}</StorefrontLangContext.Provider>
}

export function useStorefrontLang(): StorefrontLangContextValue {
  const ctx = useContext(StorefrontLangContext)
  if (!ctx) throw new Error('useStorefrontLang must be used within StorefrontLangProvider')
  return ctx
}
