import type { Metadata } from 'next'

import { LabShell } from '../_components/lab-shell'

export const metadata: Metadata = {
  title: 'Admin design preview',
}

export default function DesignAdminPage() {
  return <LabShell view="admin" />
}
