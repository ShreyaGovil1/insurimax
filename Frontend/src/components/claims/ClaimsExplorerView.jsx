import { useCallback, useEffect, useState } from "react"
import { FileStack, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { api } from "../../services/api"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { TabBar } from "../ui/tab-bar"
import { EmptyState } from "../ui/empty-state"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { PageHeader } from "../common/PageHeader"
import { ClaimsTable, Panel } from "./ClaimsTable"

const STATUS_FILTERS = [
  { value: "all", label: "All claims" },
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In review" },
  { value: "auto_approved", label: "Auto-approved" },
  { value: "finalized", label: "Finalized" },
]

export function ClaimsExplorerView({ onSelectClaim, onNewClaim }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const isHospital = user?.role === "hospital_desk"

  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  // Draft pending deletion (hospital only); drives the confirmation dialog
  const [claimToDelete, setClaimToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadClaims = useCallback(async (status) => {
    try {
      const filters = {}
      if (status !== "all") filters.status = status
      const res = await api.claims.list(filters)
      setClaims(res?.items || [])
    } catch (err) {
      console.warn("Failed to load claims:", err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadClaims(statusFilter)
  }, [statusFilter, loadClaims])

  const changeFilter = (value) => {
    if (value === statusFilter) return
    setLoading(true)
    setStatusFilter(value)
  }

  const refresh = () => {
    setRefreshing(true)
    loadClaims(statusFilter)
  }

  const handleSelect = (claim) => {
    onSelectClaim?.(claim.id)
    navigate(`/claims/${claim.id}`)
  }

  const handleDeleteDraft = async () => {
    if (!claimToDelete) return
    setDeleting(true)
    try {
      await api.claims.delete(claimToDelete.id)
      toast({ title: "Draft deleted", description: `${claimToDelete.claim_number} and its documents were deleted.`, variant: "success" })
      setClaimToDelete(null)
      loadClaims(statusFilter)
    } catch (err) {
      toast({ title: "Couldn't delete the draft", description: err.message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const filters = isHospital ? [STATUS_FILTERS[0], { value: "draft", label: "Drafts" }, ...STATUS_FILTERS.slice(1)] : STATUS_FILTERS

  const filtered = claims.filter((c) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      c.patient_name?.toLowerCase().includes(q) ||
      c.claim_number?.toLowerCase().includes(q) ||
      c.hospital_name?.toLowerCase().includes(q) ||
      c.insurer_name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Claims"
        description={
          isHospital
            ? "Every cashless claim your desk has started, from draft to decision."
            : "Search, filter and audit claims across network hospitals."
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
            {isHospital && (
              <Button variant="proceed" size="sm" onClick={onNewClaim}>
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                New claim
              </Button>
            )}
          </>
        }
      />

      <Panel>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <TabBar variant="segmented" size="sm" tabs={filters} value={statusFilter} onChange={changeFilter} ariaLabel="Filter by status" />
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              placeholder="Search patient, hospital, insurer, claim no."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9"
              aria-label="Search claims"
            />
          </div>
        </div>

        <ClaimsTable
          claims={filtered}
          loading={loading}
          onOpen={handleSelect}
          variant="explorer"
          renderActions={
            isHospital
              ? (c) =>
                  c.status === "draft" ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setClaimToDelete(c)}
                      className="text-ink-4 hover:bg-vermilion-50 hover:text-vermilion-700"
                      title="Delete draft"
                      aria-label={`Delete draft ${c.claim_number}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null
              : undefined
          }
          empty={
            <EmptyState
              icon={searchQuery ? Search : FileStack}
              title={searchQuery ? "No claims match your search" : "No claims here yet"}
              description={
                searchQuery
                  ? "Check the spelling, or search by claim number instead."
                  : statusFilter === "all"
                    ? isHospital
                      ? "Start a cashless claim when a patient is ready for discharge."
                      : "Claims appear here once hospitals submit them."
                    : "No claims have this status right now."
              }
              action={
                searchQuery ? (
                  <Button variant="secondary" size="sm" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                ) : isHospital && statusFilter === "all" ? (
                  <Button variant="proceed" onClick={onNewClaim}>
                    <Plus className="h-4 w-4" />
                    New claim
                  </Button>
                ) : null
              }
            />
          }
        />
      </Panel>

      {/* Delete draft confirmation */}
      <Dialog open={Boolean(claimToDelete)} onOpenChange={(open) => !open && setClaimToDelete(null)}>
        <DialogContent onClose={() => setClaimToDelete(null)}>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-vermilion-50 text-vermilion-600">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle>Delete draft {claimToDelete?.claim_number}?</DialogTitle>
            <DialogDescription>
              The draft for {claimToDelete?.patient_name} and every document attached to it are permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setClaimToDelete(null)}>
              Keep draft
            </Button>
            <Button variant="danger" onClick={handleDeleteDraft} loading={deleting}>
              {!deleting && <Trash2 className="h-4 w-4" />}
              {deleting ? "Deleting…" : "Delete draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
