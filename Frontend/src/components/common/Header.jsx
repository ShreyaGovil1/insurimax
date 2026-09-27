import React from "react"
import { ShieldCheck, Plus, User, Sparkles, Building2, Activity } from "lucide-react"
import { useAuth } from "../../context/AuthContext"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"

export function Header({ currentView, onViewChange, onNewClaim }) {
  const { user, switchRole, logout } = useAuth()

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex h-16 items-center justify-between px-6 max-w-7xl mx-auto">
        {/* Brand */}
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => onViewChange("queue")}>
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-bold tracking-tight text-slate-900">InsuriMax</span>
              <Badge variant="info" className="text-[10px] uppercase font-semibold py-0 px-1.5 h-4 bg-blue-50 text-blue-700 border-blue-200">
                Gemini 1.5 Pro
              </Badge>
            </div>
            <p className="text-[11px] text-slate-500 font-medium">IRDAI 3-Hour Cashless Adjudication Engine</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="hidden md:flex items-center space-x-1">
          <button
            onClick={() => onViewChange("queue")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              currentView === "queue"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            Adjudication Queue
          </button>
          <button
            onClick={() => onViewChange("claims")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              currentView === "claims"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            Claims Explorer
          </button>
          <button
            onClick={() => onViewChange("hospital")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1.5 ${
              currentView === "hospital"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Hospital Pre-Check</span>
          </button>
          <button
            onClick={() => onViewChange("policies")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              currentView === "policies"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            Policies & Rules
          </button>
          <button
            onClick={() => onViewChange("analytics")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1.5 ${
              currentView === "analytics"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Analytics & SLA</span>
          </button>
        </nav>

        {/* Actions & Role Switcher */}
        <div className="flex items-center space-x-3">
          <Button
            size="sm"
            onClick={onNewClaim}
            className="hidden sm:inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-semibold text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Claim</span>
          </Button>

          {/* Quick Role Switcher */}
          <div className="flex items-center space-x-2 border-l border-slate-200 pl-3">
            <div className="text-right hidden lg:block">
              <div className="text-xs font-semibold text-slate-800 leading-tight">{user?.full_name}</div>
              <div className="text-[10px] text-slate-500 font-medium capitalize">{user?.role?.replace("_", " ")}</div>
            </div>

            <select
              value={user?.role || "adjuster"}
              onChange={(e) => switchRole(e.target.value)}
              className="text-xs font-medium bg-slate-100 border border-slate-200 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              title="Switch persona for testing different roles"
            >
              <option value="adjuster">Adjuster</option>
              <option value="senior_adjuster">Senior Adjuster</option>
              <option value="admin">TPA Admin</option>
              <option value="hospital_desk">Hospital Desk</option>
            </select>
          </div>
        </div>
      </div>
    </header>
  )
}
