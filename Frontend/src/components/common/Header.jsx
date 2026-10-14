import { useEffect, useRef, useState } from "react"
import { Activity, Check, ChevronDown, FileStack, Inbox, LogIn, LogOut, Plus, SearchCheck, Settings, Loader2 } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { DEMO_PERSONAS_ENABLED } from "../../services/api"
import { useToast } from "../ui/toast"
import { Button } from "../ui/button"
import { Avatar } from "../ui/avatar"
import { BrandLockup } from "./BrandMark"
import { cn } from "../../lib/utils"

const BASE_NAV_ITEMS = [
  { id: "queue", path: "/queue", label: "Queue", hospitalLabel: "Desk", icon: Inbox },
  { id: "claims", path: "/claims", label: "Claims", icon: FileStack },
  { id: "patient", path: "/patient", label: "Track claim", icon: SearchCheck },
]

const ANALYTICS_NAV_ITEM = { id: "analytics", path: "/analytics", label: "Analytics & audit", icon: Activity }
const ADMIN_NAV_ITEM = { id: "admin", path: "/admin", label: "Admin", icon: Settings }

const ROLE_OPTIONS = [
  { key: "adjuster", label: "TPA adjuster", short: "Adjuster", hint: "Reviews and decides claims" },
  { key: "admin", label: "TPA operations admin", short: "Admin", hint: "Users, organisations, thresholds" },
  { key: "hospital_desk", label: "Hospital billing desk", short: "Hospital desk", hint: "Drafts and submits claims" },
]

export function Header({ currentView, onViewChange, onNewClaim }) {
  const { user, switchRole, logout } = useAuth()
  const { toast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [switching, setSwitching] = useState(null)
  const menuRef = useRef(null)

  const isHospital = user?.role === "hospital_desk"
  const navItems = user?.role === "admin" ? [ADMIN_NAV_ITEM, ...BASE_NAV_ITEMS, ANALYTICS_NAV_ITEM] : BASE_NAV_ITEMS
  const roleInfo = ROLE_OPTIONS.find((r) => r.key === user?.role) || ROLE_OPTIONS[0]

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false)
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  const go = (item) => {
    onViewChange?.(item.id)
    navigate(item.path)
  }

  const goHome = () => {
    if (!user) return navigate("/login")
    const home = user.role === "admin" ? "/admin" : "/queue"
    onViewChange?.(home.slice(1))
    navigate(home)
  }

  const handleSwitch = async (key) => {
    if (key === user?.role) return setMenuOpen(false)
    setSwitching(key)
    try {
      await switchRole(key)
      setMenuOpen(false)
      navigate(key === "admin" ? "/admin" : "/queue")
    } catch (err) {
      toast({ title: "Could not switch persona", description: err.message, variant: "destructive" })
    } finally {
      setSwitching(null)
    }
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout?.()
    navigate("/login")
  }

  const isActive = (item) => {
    if (currentView) return currentView === item.id
    const path = location.pathname
    if (item.id === "queue" && (path === "/" || path === "")) return true
    if (item.id === "claims") return path.startsWith("/claims")
    if (item.id === "patient") return path.startsWith("/patient")
    return path === item.path || path.startsWith(item.path + "/")
  }

  return (
    <header className="no-print sticky top-0 z-40 bg-peacock-800 text-white shadow-[0_1px_0_rgb(255_255_255/0.06)_inset]">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-4 px-4 sm:px-6 lg:gap-8">
        <button
          type="button"
          onClick={goHome}
          className="-ml-1 cursor-pointer rounded-lg px-1 py-1 transition-opacity hover:opacity-90"
          aria-label="InsuriMax home"
        >
          <BrandLockup onDark />
        </button>

        {user && (
          <nav className="hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors duration-150",
                    active ? "text-white" : "text-peacock-100/75 hover:text-white"
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-marigold-400" : "text-peacock-200/70")} />
                  {isHospital && item.hospitalLabel ? item.hospitalLabel : item.label}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-x-3 bottom-0 h-[3px] origin-bottom rounded-t-full bg-marigold-400 transition-transform duration-200 ease-out-strong",
                      active ? "scale-y-100" : "scale-y-0"
                    )}
                  />
                </button>
              )
            })}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {isHospital && (
            <Button size="sm" variant="proceed" data-action="new-claim" onClick={onNewClaim} className="gap-1.5">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              <span className="hidden sm:inline">New claim</span>
            </Button>
          )}

          {!user && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/patient")}
                className="gap-1.5 border-peacock-400/40 bg-peacock-900/40 text-peacock-100 hover:border-peacock-300 hover:bg-white/10 hover:text-white"
              >
                <SearchCheck className="h-4 w-4 text-marigold-400" />
                <span className="font-medium">Check claim status</span>
              </Button>
              <Button size="sm" variant="on-dark" onClick={() => navigate("/login")}>
                <LogIn className="h-4 w-4" />
                Staff sign in
              </Button>
            </div>
          )}

          {user && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-white/10"
                title="Account and demo personas"
              >
                <Avatar name={user.full_name} size="sm" />
                <span className="hidden flex-col items-start leading-none lg:flex">
                  <span className="text-small font-semibold text-white">{user.full_name?.split(" ")[0]}</span>
                  <span className="mt-1 text-tiny text-peacock-200">{roleInfo.short}</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 text-peacock-200 transition-transform duration-200", menuOpen && "rotate-180")} />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right animate-dialog-in rounded-xl bg-surface p-1.5 text-ink shadow-raised"
                >
                  <div className="flex items-center gap-3 px-2.5 py-2.5">
                    <Avatar name={user.full_name} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{user.full_name}</div>
                      <div className="truncate text-small text-ink-3">{user.email}</div>
                    </div>
                  </div>
                  <div className="my-1 h-px bg-line" />
                  {DEMO_PERSONAS_ENABLED && (
                    <>
                      <div className="px-2.5 pb-1 pt-2 text-tiny font-semibold text-ink-3">Switch demo persona</div>
                      {ROLE_OPTIONS.map((opt) => {
                        const current = user.role === opt.key
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            role="menuitemradio"
                            aria-checked={current}
                            disabled={Boolean(switching)}
                            onClick={() => handleSwitch(opt.key)}
                            className={cn(
                              "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ground disabled:cursor-wait",
                              current && "bg-peacock-50 hover:bg-peacock-50"
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className={cn("block text-sm font-semibold", current ? "text-peacock-700" : "text-ink")}>{opt.label}</span>
                              <span className="block text-tiny text-ink-3">{opt.hint}</span>
                            </span>
                            {switching === opt.key ? (
                              <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
                            ) : current ? (
                              <Check className="h-4 w-4 text-peacock-600" strokeWidth={2.5} />
                            ) : null}
                          </button>
                        )
                      })}
                      <div className="my-1 h-px bg-line" />
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-vermilion-700 transition-colors hover:bg-vermilion-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {user && (
        <nav className="scrollbar-none flex gap-1 overflow-x-auto bg-peacock-900 px-3 py-2 md:hidden" aria-label="Main">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-small font-semibold transition-colors",
                  active ? "bg-white/12 text-white" : "text-peacock-100/75 hover:text-white"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", active ? "text-marigold-400" : "text-peacock-200/70")} />
                {isHospital && item.hospitalLabel ? item.hospitalLabel : item.label}
              </button>
            )
          })}
        </nav>
      )}
    </header>
  )
}
