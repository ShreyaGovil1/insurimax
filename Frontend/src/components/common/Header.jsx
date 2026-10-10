import React, { useState } from "react"
import {
  ShieldCheck,
  Plus,
  User,
  Sparkles,
  Building2,
  Activity,
  Layers,
  FileSpreadsheet,
  ChevronDown,
  LogOut,
  Bell,
  CheckCircle2,
  Circle,
  UserCheck,
  Settings,
} from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"

const NAV_ITEMS = [
  { id: "queue", path: "/queue", label: "Queue", icon: Layers },
  { id: "claims", path: "/claims", label: "Claims", icon: FileSpreadsheet },
  { id: "hospital", path: "/hospital", label: "Hospital", icon: Building2 },
  { id: "patient", path: "/patient", label: "Patient", icon: UserCheck },
  { id: "policies", path: "/policies", label: "Policies", icon: ShieldCheck },
  { id: "analytics", path: "/analytics", label: "Analytics & Audit", icon: Activity },
]

const ADMIN_NAV_ITEM = { id: "admin", path: "/admin", label: "Admin", icon: Settings }

const ROLE_OPTIONS = [
  { key: "adjuster", label: "TPA Adjuster", short: "Adjuster" },
  { key: "admin", label: "TPA Operations Admin", short: "Admin" },
  { key: "hospital_desk", label: "Hospital Billing Desk", short: "Hospital" },
]

export function Header({ currentView, onViewChange, onNewClaim }) {
  const { user, switchRole, logout } = useAuth()
  const [roleMenuOpen, setRoleMenuOpen] = useState(false)
  
  let location = { pathname: "/queue" }
  let navigate = () => {}
  try {
    location = useLocation()
    navigate = useNavigate()
  } catch {}

  const navItems = user?.role === "admin" ? [ADMIN_NAV_ITEM, ...NAV_ITEMS] : NAV_ITEMS
  const currentRoleInfo = ROLE_OPTIONS.find((r) => r.key === user?.role) || ROLE_OPTIONS[0]

  const handleNavigate = (item) => {
    if (onViewChange) onViewChange(item.id)
    if (navigate) navigate(item.path)
  }

  const handleBrandClick = () => {
    const home = user?.role === "admin" ? "/admin" : "/queue"
    if (onViewChange) onViewChange(home.slice(1))
    if (navigate) navigate(home)
  }

  const handleLogout = async () => {
    setRoleMenuOpen(false)
    await logout?.()
    if (navigate) navigate("/login")
  }

  const isItemActive = (item) => {
    if (currentView) return currentView === item.id
    if (location.pathname === item.path) return true
    if (item.id === "queue" && (location.pathname === "/" || location.pathname === "")) return true
    if (item.id === "claims" && location.pathname.startsWith("/claims")) return true
    return location.pathname.startsWith(item.path)
  }

  return (
    <header className="sticky top-0 z-40 w-full px-4 sm:px-6 pt-3 pb-2 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between bg-white/90 backdrop-blur-md rounded-2xl sm:rounded-full border border-slate-200/80 px-4 py-2 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
        
        {/* Brand & Live SLA status */}
        <div
          className="flex items-center space-x-3 cursor-pointer select-none group"
          onClick={handleBrandClick}
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-950 text-white shadow-xs group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-5 h-5 text-[#A3FF12]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-1.5">
              <span className="text-base font-extrabold tracking-tight text-slate-900">InsuriMax</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                Cashless Portal
              </span>
            </div>
          </div>
        </div>

        {/* Center Pill Navigation (Ronas IT style) */}
        <nav className="hidden md:flex items-center p-1 bg-slate-100/90 rounded-full border border-slate-200/60">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = isItemActive(item)
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item)}
                className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 cursor-pointer ${
                  isActive
                    ? "bg-slate-950 text-white shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[#A3FF12]" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Right Section: Actions, Role Pill & User */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* New Claim Pill Button */}
          {user?.role === "hospital_desk" && (
          <Button
            size="sm"
            data-action="new-claim"
            onClick={onNewClaim}
            className="rounded-full bg-slate-950 hover:bg-slate-800 text-white font-semibold text-xs h-8.5 px-3.5 gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#A3FF12]" />
            <span className="hidden sm:inline">New Claim</span>
          </Button>
          )}

          {/* Interactive Role Switcher Pill */}
          <div className="relative">
            <button
              onClick={() => setRoleMenuOpen(!roleMenuOpen)}
              className="flex items-center space-x-2 py-1 px-2.5 rounded-full bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 text-xs font-medium text-slate-800 transition-colors cursor-pointer"
              title="Click to switch persona / role"
            >
              <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">
                {user?.full_name?.charAt(0) || "U"}
              </div>
              <span className="hidden lg:inline text-xs font-semibold">{user?.full_name?.split(" ")[0]}</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white font-bold text-slate-700 shadow-2xs">
                {currentRoleInfo.short}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Dropdown Menu */}
            {roleMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-slate-200 shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 border-b border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Switch Workspace Persona</p>
                  <p className="text-xs font-semibold text-slate-800 mt-0.5">{user?.full_name}</p>
                </div>

                <div className="py-1">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        switchRole(opt.key)
                        setRoleMenuOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 cursor-pointer ${
                        user?.role === opt.key ? "font-bold text-blue-600 bg-blue-50/50" : "text-slate-700"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {user?.role === opt.key && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                    </button>
                  ))}
                </div>

                <div className="pt-1 border-t border-slate-100">
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center space-x-1.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile view sub-navbar */}
      <div className="md:hidden flex items-center space-x-1 overflow-x-auto py-2 px-1">
        {navItems.map((item) => {
          const isActive = isItemActive(item)
          return (
            <button
              key={item.id}
              onClick={() => handleNavigate(item)}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${
                isActive ? "bg-slate-950 text-white" : "bg-white text-slate-600 border border-slate-200"
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </header>
  )
}
