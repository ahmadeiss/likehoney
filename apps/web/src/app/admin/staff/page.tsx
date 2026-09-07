'use client'

import { KeyRound, Package, Settings, Truck, Users, Warehouse, BarChart3 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Checkbox, Dialog, Field, Input, Select, Switch, Textarea } from '@likehoney/ui'

import { client, type EntityStatus, type RoleDoc, type StaffDoc } from '../../../lib/admin/client'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import { useMutation, useResource } from '../../../lib/admin/hooks'
import {
  AdminPage,
  ErrorState,
  PageHeader,
  Panel,
  PanelHead,
  RowSkeleton,
  StatusBadge,
  errorMessage,
} from '../_components/shared'

// Human permission groups — raw codes stay internal.
interface PermToggle {
  code: string
  labelKey: DictKey
}
interface PermGroup {
  labelKey: DictKey
  icon: typeof Package
  toggles: PermToggle[]
}

const PERM_GROUPS: PermGroup[] = [
  {
    labelKey: 'staff.group.catalog',
    icon: Package,
    toggles: [
      { code: 'catalog:read', labelKey: 'staff.permView' },
      { code: 'catalog:write', labelKey: 'staff.permManageOnly' },
    ],
  },
  {
    labelKey: 'staff.group.inventory',
    icon: Warehouse,
    toggles: [
      { code: 'inventory:read', labelKey: 'staff.permView' },
      { code: 'inventory:write', labelKey: 'staff.permManageOnly' },
    ],
  },
  {
    labelKey: 'staff.group.suppliers',
    icon: Truck,
    toggles: [{ code: 'suppliers:write', labelKey: 'staff.permManageOnly' }],
  },
  {
    labelKey: 'staff.group.settings',
    icon: Settings,
    toggles: [{ code: 'settings:write', labelKey: 'staff.permManageOnly' }],
  },
  {
    labelKey: 'staff.group.staff',
    icon: Users,
    toggles: [{ code: 'staff:write', labelKey: 'staff.permManageOnly' }],
  },
  {
    labelKey: 'staff.group.reports',
    icon: BarChart3,
    toggles: [{ code: 'reports:read', labelKey: 'staff.permView' }],
  },
]

export default function AdminStaffPage() {
  const t = useT()
  return (
    <AdminPage width="wide">
      <PageHeader title={t('staff.title')} description={t('staff.description')} />
      <MembersCard />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <RolesCard />
        <PermissionsCard />
      </div>
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function MembersCard() {
  const t = useT()
  const locale = useLocale()
  const { data, error, loading, reload } = useResource(
    () => client.listStaff({ pageSize: 100 }),
    [],
  )
  const roles = useResource(() => client.listRoles().catch(() => [] as RoleDoc[]), [])
  const [editor, setEditor] = useState<{ staff: StaffDoc | null } | null>(null)
  const [rolesEditor, setRolesEditor] = useState<StaffDoc | null>(null)
  const [passwordFor, setPasswordFor] = useState<StaffDoc | null>(null)
  const staff = data?.data ?? []

  // Bounded per-member role lookup (staff list is small).
  const memberRoles = useResource(async () => {
    const map = new Map<string, string[]>()
    await Promise.all(
      staff.map(async (member) => {
        try {
          const detail = await client.getStaff(member.id)
          map.set(member.id, detail.roleIds)
        } catch {
          /* skip */
        }
      }),
    )
    return map
  }, [data])

  const roleName = (id: string): string => {
    const role = (roles.data ?? []).find((r) => r.id === id)
    if (!role) return id.slice(0, 6)
    return locale === 'ar' ? role.nameAr : (role.nameEn ?? role.nameAr)
  }

  return (
    <Panel flush>
      <PanelHead
        title={t('staff.members')}
        sub={t('staff.membersHint')}
        action={
          <Button variant="secondary" size="sm" onClick={() => setEditor({ staff: null })}>
            {t('staff.new')}
          </Button>
        }
      />

      {loading ? (
        <RowSkeleton rows={4} />
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : staff.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">{t('staff.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="lh-admin-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('staff.roleColumn')}</th>
                <th>{t('staff.phone')}</th>
                <th>{t('common.status')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => {
                const rids = memberRoles.data?.get(member.id) ?? []
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="lh-admin-cell-title">
                        {locale === 'ar' ? member.nameAr : (member.nameEn ?? member.nameAr)}
                      </div>
                      {member.email ? (
                        <div className="lh-admin-cell-sub" dir="ltr">
                          {member.email}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-ink-2">
                      {rids.length === 0 ? (
                        <span className="text-ink-4">{t('staff.noRoleAssigned')}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {rids.map((id) => (
                            <span key={id} className="lh-admin-chip lh-admin-chip--honey">
                              {roleName(id)}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-ink-2" dir="ltr">
                      {member.phoneNormalized}
                    </td>
                    <td>
                      <StatusBadge value={member.status} />
                    </td>
                    <td className="text-end">
                      <div className="lh-admin-inline-actions justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditor({ staff: member })}
                        >
                          {t('common.edit')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRolesEditor(member)}>
                          {t('staff.editRoles')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPasswordFor(member)}>
                          {t('staff.setPassword')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editor !== null ? (
        <StaffEditorDialog
          staff={editor.staff}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            reload()
          }}
        />
      ) : null}
      {rolesEditor !== null ? (
        <StaffRolesDialog
          staff={rolesEditor}
          onClose={() => setRolesEditor(null)}
          onSaved={() => {
            setRolesEditor(null)
            memberRoles.reload()
          }}
        />
      ) : null}
      {passwordFor !== null ? (
        <StaffPasswordDialog staff={passwordFor} onClose={() => setPasswordFor(null)} />
      ) : null}
    </Panel>
  )
}

function StaffEditorDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffDoc | null
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [nameAr, setNameAr] = useState(staff?.nameAr ?? '')
  const [nameEn, setNameEn] = useState(staff?.nameEn ?? '')
  const [phone, setPhone] = useState(staff?.phoneNormalized ?? '')
  const [email, setEmail] = useState(staff?.email ?? '')
  const [notes, setNotes] = useState(staff?.notes ?? '')
  const [status, setStatus] = useState<EntityStatus>(staff?.status ?? 'active')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    staff === null
      ? client.createStaff({
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || undefined,
          phoneNormalized: phone.trim(),
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
        })
      : client.updateStaff(staff.id, {
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || null,
          phoneNormalized: phone.trim(),
          email: email.trim() || null,
          notes: notes.trim() || null,
          status,
        }),
  )

  const submit = async () => {
    if (nameAr.trim().length === 0 || phone.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) onSaved()
    else setFieldError(errorMessage(result.error, t))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={staff === null ? t('staff.new') : t('common.edit')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('staff.nameAr')} required>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label={t('staff.nameEn')}>
            <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('staff.phone')} required hint={t('staff.phoneNormalizedNote')}>
            <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('staff.email')}>
            <Input
              dir="ltr"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('staff.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {staff !== null ? (
          <Field label={t('common.status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as EntityStatus)}>
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </Select>
          </Field>
        ) : null}

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {staff === null ? t('common.create') : t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function StaffRolesDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffDoc
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const detail = useResource(() => client.getStaff(staff.id), [staff.id])
  const roles = useResource(() => client.listRoles(), [])
  const [touched, setTouched] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [fieldError, setFieldError] = useState<string | null>(null)

  const current = detail.data?.roleIds ?? []
  const effective = touched ? selected : current
  const { run, pending } = useMutation(() => client.setStaffRoles(staff.id, effective))

  const toggle = (roleId: string, checked: boolean) => {
    setTouched(true)
    setSelected((c) =>
      checked
        ? [...new Set([...(touched ? c : current), roleId])]
        : (touched ? c : current).filter((id) => id !== roleId),
    )
  }

  const submit = async () => {
    const result = await run()
    if (result.ok) onSaved()
    else setFieldError(errorMessage(result.error, t))
  }

  return (
    <Dialog open onClose={onClose} title={t('staff.editRoles')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-3">
          {t('staff.currentIdentity')}:{' '}
          <span className="font-semibold text-ink">{staff.nameAr}</span>
        </p>

        {detail.loading || roles.loading ? (
          <span className="text-sm text-ink-3">{t('common.loading')}</span>
        ) : roles.error ? (
          <ErrorState error={roles.error} onRetry={roles.reload} />
        ) : (roles.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-3">{t('staff.roleEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(roles.data ?? []).map((role) => (
              <Checkbox
                key={role.id}
                checked={effective.includes(role.id)}
                onChange={(e) => toggle(role.id, e.target.checked)}
                label={locale === 'ar' ? role.nameAr : (role.nameEn ?? role.nameAr)}
              />
            ))}
          </div>
        )}

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending} disabled={roles.data === null}>
            {t('staff.saveRoles')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function StaffPasswordDialog({ staff, onClose }: { staff: StaffDoc; onClose: () => void }) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const { run, pending } = useMutation(() => client.setStaffPassword(staff.id, password))
  const minMet = password.length >= 8
  const confirmOk = confirm === password
  const canSubmit = password.length > 0 && minMet && confirmOk && !pending

  const submit = async () => {
    if (!minMet) return setFieldError(t('password.minLength'))
    if (!confirmOk) return setFieldError(t('password.mismatch'))
    const result = await run()
    if (result.ok) setDone(true)
    else setFieldError(errorMessage(result.error, t))
  }

  return (
    <Dialog open onClose={onClose} title={t('staff.resetPassword')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-3">
          {staff.nameAr} · {t('staff.passwordPrompt')}
        </p>
        <Field label={t('password.new')} required>
          <Input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            placeholder={t('staff.passwordPlaceholder')}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (fieldError) setFieldError(null)
            }}
          />
        </Field>
        <Field label={t('password.confirm')} required>
          <Input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              if (fieldError) setFieldError(null)
            }}
          />
        </Field>

        {done ? (
          <p className="text-sm font-medium text-success" role="status">
            {t('staff.passwordSet')}
          </p>
        ) : fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending} disabled={!canSubmit}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function RolesCard() {
  const t = useT()
  const locale = useLocale()
  const { data, error, loading, reload } = useResource(() => client.listRoles(), [])
  const [showCreate, setShowCreate] = useState(false)
  const [permsEditor, setPermsEditor] = useState<RoleDoc | null>(null)
  const roles = data ?? []

  return (
    <Panel flush>
      <PanelHead
        title={t('staff.roles')}
        sub={t('staff.rolePermissionsHint')}
        action={
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            {t('staff.newRole')}
          </Button>
        }
      />

      {loading ? (
        <RowSkeleton rows={3} />
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : roles.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">{t('staff.roleEmpty')}</p>
      ) : (
        <ul className="lh-admin-list">
          {roles.map((role) => (
            <li key={role.id} className="lh-admin-list-row">
              <div className="lh-admin-list-body">
                <span className="lh-admin-list-title">
                  {locale === 'ar' ? role.nameAr : (role.nameEn ?? role.nameAr)}
                </span>
                <span className="lh-admin-list-meta">
                  {role.permissionIds.length === 0
                    ? t('staff.noPermissions')
                    : `${role.permissionIds.length} ${t('staff.permissions')}`}
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setPermsEditor(role)}>
                {t('staff.editRolePermissions')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {showCreate ? (
        <RoleCreateDialog
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false)
            reload()
          }}
        />
      ) : null}
      {permsEditor !== null ? (
        <RolePermissionsDialog
          role={permsEditor}
          onClose={() => setPermsEditor(null)}
          onSaved={() => {
            setPermsEditor(null)
            reload()
          }}
        />
      ) : null}
    </Panel>
  )
}

function RoleCreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [code, setCode] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [descriptionAr, setDescriptionAr] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    client.createRole({
      code: code.trim().toLowerCase(),
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || undefined,
      descriptionAr: descriptionAr.trim() || undefined,
    }),
  )

  const submit = async () => {
    if (code.trim().length === 0 || nameAr.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) onSaved()
    else setFieldError(errorMessage(result.error, t))
  }

  return (
    <Dialog open onClose={onClose} title={t('staff.newRole')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-4">
        <Field label={t('staff.roleNameAr')} required>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('staff.roleNameEn')}>
          <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t('staff.roleCode')} required hint={t('staff.techDetails')}>
          <Input
            dir="ltr"
            className="font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9:_-]/g, '').toLowerCase())}
          />
        </Field>
        <Field label={t('staff.roleDescAr')}>
          <Textarea
            rows={2}
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
          />
        </Field>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function RolePermissionsDialog({
  role,
  onClose,
  onSaved,
}: {
  role: RoleDoc
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const permissions = useResource(() => client.listPermissions(), [])
  const [touched, setTouched] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [showTech, setShowTech] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const effective = touched ? selected : role.permissionIds
  const { run, pending } = useMutation(() => client.setRolePermissions(role.id, effective))

  // code -> permission id (from the live permission catalog)
  const idByCode = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of permissions.data ?? []) map.set(p.code, p.id)
    return map
  }, [permissions.data])

  const setPermByCode = (code: string, on: boolean) => {
    const id = idByCode.get(code)
    if (!id) return
    setTouched(true)
    setSelected((c) => {
      const base = touched ? c : role.permissionIds
      return on ? [...new Set([...base, id])] : base.filter((x) => x !== id)
    })
  }

  const isOn = (code: string): boolean => {
    const id = idByCode.get(code)
    return id !== undefined && effective.includes(id)
  }

  const submit = async () => {
    const result = await run()
    if (result.ok) onSaved()
    else setFieldError(errorMessage(result.error, t))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('staff.editRolePermissions')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-3">
          {role.nameAr} · {t('staff.permGroupsHint')}
        </p>

        {permissions.loading ? (
          <span className="text-sm text-ink-3">{t('common.loading')}</span>
        ) : permissions.error ? (
          <ErrorState error={permissions.error} onRetry={permissions.reload} />
        ) : (
          <div className="flex flex-col">
            {PERM_GROUPS.map((group) => {
              const Icon = group.icon
              // only render toggles whose permission exists in the catalog
              const toggles = group.toggles.filter((toggle) => idByCode.has(toggle.code))
              if (toggles.length === 0) return null
              return (
                <div key={group.labelKey} className="lh-admin-perm-group">
                  <div className="lh-admin-perm-group-title">
                    <Icon size={15} aria-hidden="true" />
                    {t(group.labelKey)}
                  </div>
                  <div className="lh-admin-perm-toggles">
                    {toggles.map((toggle) => (
                      <Switch
                        key={toggle.code}
                        checked={isOn(toggle.code)}
                        onChange={(e) => setPermByCode(toggle.code, e.target.checked)}
                        label={t(toggle.labelKey)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="rounded-md border border-dashed border-border p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium text-ink-2"
            onClick={() => setShowTech((v) => !v)}
            aria-expanded={showTech}
          >
            {t('staff.techToggle')}
            <span className="text-xs text-ink-3">
              {showTech ? t('common.hide') : t('common.show')}
            </span>
          </button>
          {showTech ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(permissions.data ?? []).map((permission) => (
                <Checkbox
                  key={permission.id}
                  checked={effective.includes(permission.id)}
                  onChange={(e) => {
                    setTouched(true)
                    setSelected((c) => {
                      const base = touched ? c : role.permissionIds
                      return e.target.checked
                        ? [...new Set([...base, permission.id])]
                        : base.filter((x) => x !== permission.id)
                    })
                  }}
                  label={
                    <span className="flex items-center gap-2">
                      <span>{permission.nameAr}</span>
                      <span className="font-mono text-xs text-ink-4">{permission.code}</span>
                    </span>
                  }
                />
              ))}
            </div>
          ) : null}
        </div>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending} disabled={permissions.data === null}>
            {t('staff.savePermissions')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Permissions catalog (reference)
// ---------------------------------------------------------------------------

function PermissionsCard() {
  const t = useT()
  const locale = useLocale()
  const { data, error, loading, reload } = useResource(() => client.listPermissions(), [])
  const [showCreate, setShowCreate] = useState(false)
  const [showTech, setShowTech] = useState(false)
  const permissions = data ?? []

  return (
    <Panel flush>
      <PanelHead
        title={t('staff.permissions')}
        sub={t('staff.permGroupsHint')}
        action={
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            {t('staff.permNew')}
          </Button>
        }
      />

      {loading ? (
        <RowSkeleton rows={3} />
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : permissions.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">{t('staff.permEmpty')}</p>
      ) : (
        <>
          <ul className="lh-admin-list">
            {permissions.map((permission) => (
              <li key={permission.id} className="lh-admin-list-row">
                <span className="lh-admin-list-glyph" aria-hidden="true">
                  <KeyRound size={14} />
                </span>
                <div className="lh-admin-list-body">
                  <span className="lh-admin-list-title">
                    {locale === 'ar' ? permission.nameAr : (permission.nameEn ?? permission.nameAr)}
                  </span>
                  {showTech ? (
                    <span className="lh-admin-list-meta font-mono">{permission.code}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-5 py-2">
            <button
              type="button"
              className="text-xs font-medium text-ink-3 hover:text-ink"
              onClick={() => setShowTech((v) => !v)}
            >
              {t('staff.techToggle')}
            </button>
          </div>
        </>
      )}

      {showCreate ? (
        <PermissionCreateDialog
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false)
            reload()
          }}
        />
      ) : null}
    </Panel>
  )
}

function PermissionCreateDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [code, setCode] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [descriptionAr, setDescriptionAr] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    client.createPermission({
      code: code.trim().toLowerCase(),
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || undefined,
      descriptionAr: descriptionAr.trim() || undefined,
    }),
  )

  const submit = async () => {
    if (code.trim().length === 0 || nameAr.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) onSaved()
    else setFieldError(errorMessage(result.error, t))
  }

  return (
    <Dialog open onClose={onClose} title={t('staff.permNew')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-4">
        <Field label={t('staff.permNameAr')} required>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('staff.permNameEn')}>
          <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t('staff.permCode')} required hint={t('staff.techDetails')}>
          <Input
            dir="ltr"
            className="font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9:._-]/g, '').toLowerCase())}
          />
        </Field>
        <Field label={t('staff.permDescAr')}>
          <Textarea
            rows={2}
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
          />
        </Field>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
