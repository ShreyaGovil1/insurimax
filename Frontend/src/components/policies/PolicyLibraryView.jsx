import React, { useState, useEffect } from "react"
import { BookOpen, Shield, Search, FileText, CheckCircle2, AlertOctagon, Plus } from "lucide-react"
import { api } from "../../services/api"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"

export function PolicyLibraryView() {
  const [activeTab, setActiveTab] = useState("policies") // "policies" | "non_payable"
  const [policies, setPolicies] = useState([])
  const [nonPayableItems, setNonPayableItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.policies.list(),
      api.policies.listNonPayableItems(),
    ])
      .then(([polData, npiData]) => {
        setPolicies(polData?.items || [])
        setNonPayableItems(npiData || [])
      })
      .finally(() => setLoading(false))
  }, [])

  const filteredNpi = nonPayableItems.filter((i) => {
    if (!search) return true
    const q = search.toLowerCase()
    return i.name?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-6 py-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Policy & Rules Knowledgebase</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configured insurer wordings, automated clause extractions, and standardized IRDAI exclusion lists.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setActiveTab("policies")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              activeTab === "policies" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Policy Contracts ({policies.length})
          </button>
          <button
            onClick={() => setActiveTab("non_payable")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              activeTab === "non_payable" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            IRDAI Non-Payables ({nonPayableItems.length})
          </button>
        </div>
      </div>

      {activeTab === "policies" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map((p) => (
            <Card key={p.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px] font-semibold text-blue-700 bg-blue-50 border-blue-200">
                    {p.insurer_name}
                  </Badge>
                  <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Active Wording
                  </span>
                </div>
                <CardTitle className="text-sm font-semibold text-slate-900 mt-2">{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-1 text-xs space-y-3">
                <p className="text-slate-600 text-[11px] leading-relaxed">{p.description}</p>
                <div className="p-2.5 bg-slate-50 rounded-lg flex items-center justify-between text-[11px] text-slate-600 font-medium">
                  <span>Policy Class: <strong>{p.policy_type}</strong></span>
                  <span className="text-blue-600 cursor-pointer hover:underline">View Clause Rules &rarr;</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "non_payable" && (
        <Card>
          <CardHeader className="p-4 pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold">Standard IRDAI Non-Payable Items List</CardTitle>
              <p className="text-xs text-slate-500">
                Official regulatory non-admissible expenses automatically checked during Gemini line-item adjudication.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search exclusion item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-500">
                    <th className="py-2.5 px-4">Item Name</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Standard Basis</th>
                    <th className="py-2.5 px-4">Regulatory Exclusion Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredNpi.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-900">{item.name}</td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary" className="text-[10px] font-normal">{item.category}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-emerald-700 font-bold text-[11px]">IRDAI Standard</span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-[11px]">{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
