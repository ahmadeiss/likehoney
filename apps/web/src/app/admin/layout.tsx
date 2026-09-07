import { AdminProviders, AdminShell } from './_components/admin-shell'

export const metadata = {
  title: 'Like Honey Admin',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProviders>
      <AdminShell>{children}</AdminShell>
    </AdminProviders>
  )
}
