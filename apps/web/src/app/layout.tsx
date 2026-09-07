import type { Metadata } from 'next'

import '@fontsource-variable/cairo'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@likehoney/ui/styles.css'
import './globals.css'

import { DirectionSync } from '../components/document-direction'

export const metadata: Metadata = {
  title: {
    default: 'Like Honey',
    template: '%s — Like Honey',
  },
  description:
    "Like Honey — premium children's clothing, shoes, bags, toys & accessories / زي العسل — متجر ملابس وأحذية وحقائب وألعاب الأطفال.",
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ar" dir="rtl" className="font-body">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <DirectionSync />
        {children}
      </body>
    </html>
  )
}
