import { useCallback, useEffect, useState } from "react"
import { Building2, KeyRound, Plus, Search, UserCheck, Users, UserX, Power } from "lucide-react"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { cn, formatRelative } from "../../lib/utils"
import { useToast } from "../ui/toast"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Select } from "../ui/select"
import { Badge } from "../ui/badge"
import { Avatar } from "../ui/avatar"
import { Field } from "../ui/field"
import { TabBar } from "../ui/tab-bar"
import { Skeleton } from "../ui/skeleton"
import { EmptyState } from "../ui/empty-state"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { PageHeader } from "../common/PageHeader"

const ROLES = [
  { value: "adjuster", label: "Adjuster" },
  { value: "admin", label: "Admin" },
  { value: "hospital_desk", label: "Hospital desk" },
]
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r

const ORG_TYPES = [
  { value: "tpa", label: "TPA" },
  { value: "hospital", label: "Hospital" },
  { value: "insurer", label: "Insurer" },
]
const EMPTY_ORG = { name: "", org_type: "tpa", gstin: "", contact_email: "", contact_phone: "", address: "" }

const EMPTY_FORM = { email: "", full_name: "", password: "", role: "adjuster", org_id: "" }

export function AdminPanelView() {
  const { user: me } = useAuth()
  const { toast } = useToast()
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ search: "", role: "", is_active: "" })

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [tab, setTab] = useState("users")
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgForm, setOrgForm] = useState(EMPTY_ORG)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState("")
  const [saving, setSaving] = useState(false)

  const fail = (err) => {
    const detail = err?.data?.detail
    const description = Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : err.message
    toast({ title: "That didn't work", description, variant: "destructive" })
  }

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.admin.getStats())
    } catch (err) {
      fail(err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      const res = await api.admin.listUsers(filters)
      setUsers(res.items)
      setTotal(res.total)
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const loadOrgs = () => api.admin.listOrganizations().then(setOrgs).catch(() => {})

  useEffect(() => {
    loadStats()
    loadOrgs()
  }, [loadStats])

  useEffect(() => {
    const t = setTimeout(loadUsers, 250)
    return () => clearTimeout(t)
  }, [loadUsers])

  const refresh = () => {
    loadUsers()
    loadStats()
  }

  const updateUser = async (u, patch, message) => {
    try {
      await api.admin.updateUser(u.id, patch)
      toast({ title: message, description: u.email, variant: "success" })
      refresh()
    } catch (err) {
      fail(err)
      refresh()
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.admin.createUser({ ...form, org_id: form.org_id || null })
      toast({ title: "User added", description: form.email, variant: "success" })
      setCreateOpen(false)
      setForm(EMPTY_FORM)
      refresh()
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  const updateOrg = async (o, patch, message) => {
    try {
      await api.admin.updateOrganization(o.id, patch)
      toast({ title: message, description: o.name, variant: "success" })
    } catch (err) {
      fail(err)
    }
    loadOrgs()
  }

  const handleCreateOrg = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = Object.fromEntries(Object.entries(orgForm).map(([k, v]) => [k, v === "" ? null : v]))
      await api.admin.createOrganization(payload)
      toast({ title: "Organisation added", description: orgForm.name, variant: "success" })
      setOrgOpen(false)
      setOrgForm(EMPTY_ORG)
      loadOrgs()
      loadStats()
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.admin.resetPassword(resetTarget.id, newPassword)
      toast({ title: "Password reset", description: resetTarget.email, variant: "success" })
      setResetTarget(null)
      setNewPassword("")
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  const orgName = (id) => orgs.find((o) => o.id === id)?.name

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Admin"
        description="People, roles and the organisations on InsuriMax."
        actions={
          tab === "orgs" ? (
            <Button onClick={() => setOrgOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add organisation
            </Button>
          ) : (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add user
            </Button>
          )
        }
      />

      <section aria-label="Totals" className="grid grid-cols-2 overflow-hidden rounded-card bg-surface shadow-card lg:grid-cols-4">
        {[
          { icon: Users, label: "Users", value: stats?.total_users },
          { icon: UserCheck, label: "Active", value: stats?.active_users },
          { icon: UserX, label: "Deactivated", value: stats?.inactive_users },
          { icon: Building2, label: "Organisations", value: stats?.total_organizations },
        ].map((s, i) => (
          <div key={s.label} className={cn("flex items-center gap-3.5 p-4 sm:p-5", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line lg:border-t-0", i === 2 && "lg:border-l")}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-peacock-50 text-peacock-600">
              <s.icon className="h-5 w-5" />
            </span>
            <div>
              <div className="text-small font-medium text-ink-3">{s.label}</div>
              {stats ? (
                <div className="figures text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{s.value ?? "—"}</div>
              ) : (
                <Skeleton className="mt-1 h-6 w-12" />
              )}
            </div>
          </div>
        ))}
      </section>

      <TabBar
        ariaLabel="Admin sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "users", label: "Users", icon: Users, count: total || undefined },
          { value: "orgs", label: "Organisations", icon: Building2, count: orgs.length || undefined },
        ]}
      />

      {tab === "users" && (
        <section className="animate-rise overflow-hidden rounded-card bg-surface shadow-card" aria-label="Users">
          <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:px-5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <Input
                type="search"
                className="h-9 pl-9"
                placeholder="Search by name or email"
                aria-label="Search users"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
            <Select className="h-9 sm:w-44" aria-label="Filter by role" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Select className="h-9 sm:w-40" aria-label="Filter by status" value={filters.is_active} onChange={(e) => setFilters({ ...filters, is_active: e.target.value })}>
              <option value="">Any status</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="No users match" description="Try a different name, role or status." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
                    <th className="py-2.5 pl-5 pr-3 font-semibold">Person</th>
                    <th className="px-3 py-2.5 font-semibold">Role</th>
                    <th className="px-3 py-2.5 font-semibold">Organisation</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Last sign-in</th>
                    <th className="py-2.5 pl-3 pr-5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {users.map((u) => {
                    const isSelf = u.id === me?.id
                    return (
                      <tr key={u.id} className={cn("transition-colors hover:bg-ground/60", !u.is_active && "opacity-70")}>
                        <td className="py-3 pl-5 pr-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.full_name} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-semibold text-ink">
                                <span className="truncate">{u.full_name}</span>
                                {isSelf && <Badge variant="peacock">You</Badge>}
                              </div>
                              <div className="truncate text-small text-ink-3">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Select
                            className="h-8 w-40 text-small"
                            aria-label={`Role for ${u.full_name}`}
                            value={u.role}
                            disabled={isSelf}
                            title={isSelf ? "You cannot change your own role" : roleLabel(u.role)}
                            onChange={(e) => updateUser(u, { role: e.target.value }, "Role updated")}
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <Select
                            className="h-8 w-52 text-small"
                            aria-label={`Organisation for ${u.full_name}`}
                            value={u.org_id || ""}
                            title={orgName(u.org_id) || "No organisation"}
                            onChange={(e) => updateUser(u, { org_id: e.target.value || null }, "Organisation updated")}
                          >
                            <option value="">No organisation</option>
                            {orgs.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={u.is_active ? "leaf" : "vermilion"}>{u.is_active ? "Active" : "Deactivated"}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-small text-ink-3" title={u.last_login_at ? new Date(u.last_login_at).toLocaleString() : undefined}>
                          {u.last_login_at ? formatRelative(u.last_login_at) : "Never"}
                        </td>
                        <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)}>
                              <KeyRound className="h-3.5 w-3.5" />
                              Reset password
                            </Button>
                            <Button
                              size="sm"
                              variant={u.is_active ? "danger-soft" : "secondary"}
                              disabled={isSelf}
                              onClick={() => updateUser(u, { is_active: !u.is_active }, u.is_active ? "User deactivated" : "User activated")}
                            >
                              <Power className="h-3.5 w-3.5" />
                              {u.is_active ? "Deactivate" : "Activate"}
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
          <div className="border-t border-line bg-ground/60 px-5 py-2.5 text-small text-ink-3">
            Showing {users.length} of {total} users
          </div>
        </section>
      )}

      {tab === "orgs" && (
        <section className="animate-rise overflow-hidden rounded-card bg-surface shadow-card" aria-label="Organisations">
          {orgs.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No organisations yet"
              description="Add the TPA, hospitals and insurers that work on InsuriMax."
              action={
                <Button onClick={() => setOrgOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add organisation
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
                    <th className="py-2.5 pl-5 pr-3 font-semibold">Organisation</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">Contact</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="py-2.5 pl-3 pr-5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orgs.map((o) => (
                    <tr key={o.id} className={cn("transition-colors hover:bg-ground/60", !o.is_active && "opacity-70")}>
                      <td className="py-3 pl-5 pr-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken text-ink-2">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{o.name}</div>
                            {o.gstin && <div className="font-mono text-tiny text-ink-3">GSTIN {o.gstin}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Select
                          className="h-8 w-32 text-small"
                          aria-label={`Type for ${o.name}`}
                          value={o.org_type}
                          onChange={(e) => updateOrg(o, { org_type: e.target.value }, "Organisation type updated")}
                        >
                          {ORG_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-3 text-small text-ink-2">{o.contact_email || <span className="text-ink-4">—</span>}</td>
                      <td className="px-3 py-3">
                        <Badge variant={o.is_active ? "leaf" : "vermilion"}>{o.is_active ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        <Button
                          size="sm"
                          variant={o.is_active ? "danger-soft" : "secondary"}
                          onClick={() => updateOrg(o, { is_active: !o.is_active }, o.is_active ? "Organisation deactivated" : "Organisation activated")}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {o.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent onClose={() => setCreateOpen(false)}>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Add a user</DialogTitle>
              <DialogDescription>Create an account and give it a role. Share the temporary password privately.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="u-name" required className="sm:col-span-2">
                <Input id="u-name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </Field>
              <Field label="Work email" htmlFor="u-email" required className="sm:col-span-2">
                <Input id="u-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Temporary password" htmlFor="u-pass" required hint="At least 8 characters" className="sm:col-span-2">
                <Input id="u-pass" required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
              <Field label="Role" htmlFor="u-role">
                <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Organisation" htmlFor="u-org" optional>
                <Select id="u-org" value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })}>
                  <option value="">No organisation</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {saving ? "Adding…" : "Add user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create organisation */}
      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent onClose={() => setOrgOpen(false)}>
          <form onSubmit={handleCreateOrg}>
            <DialogHeader>
              <DialogTitle>Add an organisation</DialogTitle>
              <DialogDescription>Register a TPA, hospital or insurer.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organisation name" htmlFor="o-name" required className="sm:col-span-2">
                <Input id="o-name" required minLength={2} value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} />
              </Field>
              <Field label="Type" htmlFor="o-type" required>
                <Select id="o-type" required value={orgForm.org_type} onChange={(e) => setOrgForm({ ...orgForm, org_type: e.target.value })}>
                  {ORG_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="GSTIN" htmlFor="o-gstin" optional>
                <Input id="o-gstin" className="font-mono text-small" value={orgForm.gstin} onChange={(e) => setOrgForm({ ...orgForm, gstin: e.target.value })} />
              </Field>
              <Field label="Contact email" htmlFor="o-email" optional>
                <Input id="o-email" type="email" value={orgForm.contact_email} onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })} />
              </Field>
              <Field label="Contact phone" htmlFor="o-phone" optional>
                <Input id="o-phone" type="tel" value={orgForm.contact_phone} onChange={(e) => setOrgForm({ ...orgForm, contact_phone: e.target.value })} />
              </Field>
              <Field label="Address" htmlFor="o-address" optional className="sm:col-span-2">
                <Input id="o-address" value={orgForm.address} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOrgOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {saving ? "Adding…" : "Add organisation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent onClose={() => setResetTarget(null)}>
          <form onSubmit={handleReset}>
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>{resetTarget?.email}</DialogDescription>
            </DialogHeader>
            <Field label="New password" htmlFor="new-pass" required hint="At least 8 characters">
              <Input id="new-pass" required type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {saving ? "Saving…" : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
