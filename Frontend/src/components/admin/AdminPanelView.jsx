import React, { useCallback, useEffect, useState } from "react"
import { Users, UserCheck, UserX, Building2, Plus, Search, KeyRound } from "lucide-react"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { useToast } from "../ui/toast"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Select } from "../ui/select"
import { Badge } from "../ui/badge"
import { Card, CardContent } from "../ui/card"
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog"

const ROLES = [
  { value: "adjuster", label: "Adjuster" },
  { value: "admin", label: "Admin" },
  { value: "hospital_desk", label: "Hospital Desk" },
]
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r

const ORG_TYPES = [
  { value: "tpa", label: "TPA" },
  { value: "hospital", label: "Hospital" },
  { value: "insurer", label: "Insurer" },
]
const EMPTY_ORG = { name: "", org_type: "tpa", gstin: "", contact_email: "", contact_phone: "", address: "" }

const EMPTY_FORM = { email: "", full_name: "", password: "", role: "adjuster", org_id: "" }

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-slate-950 flex items-center justify-center">
          <Icon className="w-4 h-4 text-[#A3FF12]" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="text-xl font-extrabold text-slate-900">{value ?? "—"}</p>
        </div>
      </CardContent>
    </Card>
  )
}

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
    toast({ title: "Action failed", description, variant: "destructive" })
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
    setLoading(true)
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

  useEffect(() => {
    loadStats()
    api.admin.listOrganizations().then(setOrgs).catch(() => {})
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
      toast({ title: message, description: u.email })
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
      toast({ title: "User created", description: form.email })
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
      toast({ title: message, description: o.name })
    } catch (err) {
      fail(err)
    }
    api.admin.listOrganizations().then(setOrgs).catch(() => {})
  }

  const handleCreateOrg = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        Object.entries(orgForm).map(([k, v]) => [k, v === "" ? null : v])
      )
      await api.admin.createOrganization(payload)
      toast({ title: "Organization created", description: orgForm.name })
      setOrgOpen(false)
      setOrgForm(EMPTY_ORG)
      api.admin.listOrganizations().then(setOrgs).catch(() => {})
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
      toast({ title: "Password reset", description: resetTarget.email })
      setResetTarget(null)
      setNewPassword("")
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Admin Panel</h1>
          <p className="text-xs text-slate-500">Manage users, roles and access.</p>
        </div>
        {tab === "orgs" ? (
        <Button
          onClick={() => setOrgOpen(true)}
          className="rounded-full bg-slate-950 hover:bg-slate-800 text-white text-xs gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#A3FF12]" /> Add Organization
        </Button>
        ) : (
        <Button
          onClick={() => setCreateOpen(true)}
          className="rounded-full bg-slate-950 hover:bg-slate-800 text-white text-xs gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#A3FF12]" /> Add User
        </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Total users" value={stats?.total_users} />
        <StatCard icon={UserCheck} label="Active" value={stats?.active_users} />
        <StatCard icon={UserX} label="Deactivated" value={stats?.inactive_users} />
        <StatCard icon={Building2} label="Organizations" value={stats?.total_organizations} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "users" && (
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <Input
                className="pl-9"
                placeholder="Search by name or email"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
            <Select
              className="sm:w-44"
              value={filters.role}
              onChange={(e) => setFilters({ ...filters, role: e.target.value })}
            >
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
            <Select
              className="sm:w-36"
              value={filters.is_active}
              onChange={(e) => setFilters({ ...filters, is_active: e.target.value })}
            >
              <option value="">Any status</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 text-xs">Loading…</TableCell>
                </TableRow>
              )}
              {!loading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 text-xs">No users found.</TableCell>
                </TableRow>
              )}
              {!loading &&
                users.map((u) => {
                  const isSelf = u.id === me?.id
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <p className="text-sm font-semibold text-slate-900">
                          {u.full_name} {isSelf && <Badge variant="info">You</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <Select
                          className="h-8 text-xs w-40"
                          value={u.role}
                          disabled={isSelf}
                          title={isSelf ? "You cannot change your own role" : roleLabel(u.role)}
                          onChange={(e) => updateUser(u, { role: e.target.value }, "Role updated")}
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          className="h-8 text-xs w-48"
                          value={u.org_id || ""}
                          onChange={(e) =>
                            updateUser(u, { org_id: e.target.value || null }, "Organization updated")
                          }
                        >
                          <option value="">No organization</option>
                          {orgs.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.is_active ? "success" : "destructive"}>
                          {u.is_active ? "Active" : "Deactivated"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs mr-1.5 cursor-pointer"
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound className="w-3 h-3 mr-1" /> Reset
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs cursor-pointer"
                          disabled={isSelf}
                          onClick={() =>
                            updateUser(
                              u,
                              { is_active: !u.is_active },
                              u.is_active ? "User deactivated" : "User activated"
                            )
                          }
                        >
                          {u.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
          <p className="text-[11px] text-slate-500">
            Showing {users.length} of {total} users
          </p>
        </CardContent>
      </Card>
      )}

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent onClose={() => setCreateOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
              <DialogDescription>Create an account and assign a role.</DialogDescription>
            </DialogHeader>
            <Input
              required
              placeholder="Full name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <Input
              required
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              required
              type="password"
              minLength={8}
              placeholder="Temporary password (min 8 chars)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
            <Select value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })}>
              <option value="">No organization</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create User"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Organizations */}
      {tab === "orgs" && (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500 text-xs">No organizations yet.</TableCell>
                </TableRow>
              )}
              {orgs.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="text-sm font-semibold text-slate-900">{o.name}</TableCell>
                  <TableCell>
                    <Select
                      className="h-8 text-xs w-32"
                      value={o.org_type}
                      onChange={(e) => updateOrg(o, { org_type: e.target.value }, "Organization type updated")}
                    >
                      {ORG_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{o.contact_email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={o.is_active ? "success" : "destructive"}>{o.is_active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs cursor-pointer"
                      onClick={() => updateOrg(o, { is_active: !o.is_active }, o.is_active ? "Organization deactivated" : "Organization activated")}
                    >
                      {o.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* Create organization */}
      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent onClose={() => setOrgOpen(false)}>
          <form onSubmit={handleCreateOrg} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Add Organization</DialogTitle>
              <DialogDescription>Register a TPA, hospital or insurer.</DialogDescription>
            </DialogHeader>
            <Input
              required
              minLength={2}
              placeholder="Organization name"
              value={orgForm.name}
              onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
            />
            <label className="block text-xs font-semibold text-slate-700">Organization type *</label>
            <Select required value={orgForm.org_type} onChange={(e) => setOrgForm({ ...orgForm, org_type: e.target.value })}>
              {ORG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
            <Input placeholder="GSTIN (optional)" value={orgForm.gstin} onChange={(e) => setOrgForm({ ...orgForm, gstin: e.target.value })} />
            <Input type="email" placeholder="Contact email (optional)" value={orgForm.contact_email} onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })} />
            <Input placeholder="Contact phone (optional)" value={orgForm.contact_phone} onChange={(e) => setOrgForm({ ...orgForm, contact_phone: e.target.value })} />
            <Input placeholder="Address (optional)" value={orgForm.address} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOrgOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create Organization"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent onClose={() => setResetTarget(null)}>
          <form onSubmit={handleReset} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>{resetTarget?.email}</DialogDescription>
            </DialogHeader>
            <Input
              required
              type="password"
              minLength={8}
              placeholder="New password (min 8 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Reset Password"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
