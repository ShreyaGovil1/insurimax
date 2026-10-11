import { useEffect, useState } from "react"
import { BookOpen, CheckCircle2, CircleSlash, Search } from "lucide-react"
import { api } from "../../services/api"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { TabBar } from "../ui/tab-bar"
import { Skeleton } from "../ui/skeleton"
import { EmptyState } from "../ui/empty-state"
import { PageHeader } from "../common/PageHeader"

export function PolicyLibraryView() {
  const [activeTab, setActiveTab] = useState("policies") // "policies" | "non_payable"
  const [policies, setPolicies] = useState([])
  const [nonPayableItems, setNonPayableItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    Promise.all([api.policies.list(), api.policies.listNonPayableItems()])
      .then(([polData, npiData]) => {
        setPolicies(polData?.items || [])
        setNonPayableItems(npiData || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filteredNpi = nonPayableItems.filter((i) => {
    if (!search) return true
    const q = search.toLowerCase()
    return i.name?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q)
  })

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Policies & rules"
        description="Insurer policy wordings, the clauses extracted from them, and the standard IRDAI exclusion list."
      />

      <TabBar
        ariaLabel="Policy sections"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { value: "policies", label: "Policy contracts", icon: BookOpen, count: policies.length || undefined },
          { value: "non_payable", label: "IRDAI non-payables", icon: CircleSlash, count: nonPayableItems.length || undefined },
        ]}
      />

      <div key={activeTab} className="animate-rise">
        {activeTab === "policies" &&
          (loading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-40 rounded-card" />
              <Skeleton className="h-40 rounded-card" />
            </div>
          ) : policies.length === 0 ? (
            <section className="rounded-card bg-surface shadow-card">
              <EmptyState icon={BookOpen} title="No policy wordings yet" description="Policy contracts appear here once an insurer's wording has been uploaded." />
            </section>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {policies.map((p) => (
                <article key={p.id} className="flex flex-col rounded-card bg-surface p-5 shadow-card transition-shadow hover:shadow-raised">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="peacock">{p.insurer_name}</Badge>
                    <span className="inline-flex items-center gap-1 text-tiny font-semibold text-leaf-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Active wording
                    </span>
                  </div>
                  <h3 className="mt-3 text-body font-semibold text-ink">{p.name}</h3>
                  <p className="mt-1 flex-1 text-small leading-relaxed text-ink-3">{p.description}</p>
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-ground px-3 py-2 text-small text-ink-2">
                    <span>
                      Policy class <strong className="font-semibold text-ink">{p.policy_type}</strong>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ))}

        {activeTab === "non_payable" && (
          <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="IRDAI non-payable items">
            <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-body font-semibold text-ink">Standard IRDAI non-payable items</h2>
                <p className="text-small text-ink-3">Checked automatically during AI line-item adjudication.</p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <Input type="search" placeholder="Search an exclusion" aria-label="Search exclusions" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9" />
              </div>
            </div>
            {loading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filteredNpi.length === 0 ? (
              <EmptyState icon={Search} title="No exclusions match" description="Try a broader term, such as gloves or room." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
                      <th className="py-2.5 pl-5 pr-3 font-semibold">Item</th>
                      <th className="px-3 py-2.5 font-semibold">Category</th>
                      <th className="px-3 py-2.5 font-semibold">Basis</th>
                      <th className="py-2.5 pl-3 pr-5 font-semibold">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredNpi.map((item) => (
                      <tr key={item.id} className="align-top transition-colors hover:bg-ground/60">
                        <td className="py-3 pl-5 pr-3 font-semibold text-ink">{item.name}</td>
                        <td className="px-3 py-3">
                          <Badge variant="neutral">{item.category}</Badge>
                        </td>
                        <td className="px-3 py-3 text-small font-semibold text-leaf-700">IRDAI standard</td>
                        <td className="py-3 pl-3 pr-5 text-small text-ink-2">{item.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
