import type { Metadata } from 'next'

import { LabShell } from '../_components/lab-shell'

export const metadata: Metadata = {
  title: 'Storefront design preview',
}

export default function DesignStorefrontPage() {
  return <LabShell view="storefront" />
}
