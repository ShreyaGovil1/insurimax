import { useEffect, useRef, useState } from "react"
import { ArrowRight, Eye, EyeOff, Lock, Mail, SearchCheck } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Avatar } from "../ui/avatar"
import { DEMO_CREDENTIALS, DEMO_PERSONAS_ENABLED } from "../../services/api"
import { BrandLockup } from "../common/BrandMark"
import { Guilloche } from "../common/Guilloche"
import { JourneyRail } from "../common/JourneyRail"
import { cn } from "../../lib/utils"

const FACTS = [
  { value: "<30 min", label: "Avg. adjudication time" },
  { value: "97.2%", label: "SLA compliance rate" },
  { value: "94%", label: "AI confidence avg." },
  { value: "Gemini 1.5 Pro", label: "Multimodal AI engine" },
]

// An illustrative claim travelling the route on the welcome panel
const DEMO_ROUTE = [
  { key: "bill", label: "Bill received", caption: "10:42 am" },
  { key: "read", label: "AI read 11 items", caption: "10:44 am" },
  { key: "flag", label: "1 item flagged", caption: "10:46 am" },
  { key: "review", label: "Adjuster check", caption: "10:58 am" },
  { key: "lock", label: "Decision locked", caption: "11:08 am" },
]

const PERSONAS = [
  { key: "adjuster", title: "TPA adjuster", desc: "Review and approve claims" },
  { key: "admin", title: "TPA admin", desc: "Full organisation access" },
  { key: "hospital_desk", title: "Hospital desk", desc: "Draft and submit claims" },
]

function useDemoStep(total) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const id = setInterval(() => setStep((s) => (s + 1) % (total + 2)), 1500)
    return () => clearInterval(id)
  }, [total])
  return Math.min(step, total)
}

export function LoginPage({ onLogin }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || "/"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [persona, setPersona] = useState(null)
  const submitRef = useRef(null)

  const demoStep = useDemoStep(DEMO_ROUTE.length)
  const demoSteps = DEMO_ROUTE.map((s, i) => ({
    ...s,
    state: i < demoStep ? "done" : i === demoStep ? "current" : "todo",
  }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.")
      return
    }
    setError("")
    setLoading(true)
    try {
      if (onLogin) {
        await onLogin(email, password)
      } else {
        await login(email, password)
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || "That email and password don't match. Try again.")
    } finally {
      setLoading(false)
    }
  }

  // Demo personas only pre-fill the form; the user still has to sign in.
  const handleDemoFill = (role) => {
    const cred = DEMO_CREDENTIALS[role]
    if (!cred) return
    setEmail(cred.email)
    setPassword(cred.password)
    setPersona(role)
    setError("")
    submitRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ground lg:flex-row">
      {/* Welcome panel */}
      <section className="relative overflow-hidden bg-peacock-800 text-white lg:flex lg:w-[54%] lg:flex-col">
        <Guilloche className="absolute inset-x-0 -top-24 h-[260px] w-full" lines={22} strokeClassName="stroke-peacock-300/[0.12]" />
        <Guilloche className="absolute inset-x-0 -bottom-20 h-[200px] w-full" lines={14} strokeClassName="stroke-marigold-300/[0.08]" />

        <div className="relative flex flex-1 flex-col px-6 py-6 sm:px-10 lg:justify-between lg:px-14 lg:py-12 xl:px-20">
          <BrandLockup onDark subtitle="IRDAI 3-hour cashless engine" />

          <div className="mt-8 max-w-xl lg:mt-0">
            <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px] xl:text-[48px]">
              From hospital bill to cashless decision in under 30 minutes.
            </h1>
            <p className="mt-4 hidden max-w-lg text-body text-peacock-100/85 sm:block">
              InsuriMax reads the itemised bill and the policy, checks every line against the policy and IRDAI rules, and hands
              your adjuster a decision to confirm, with the clause behind each rupee.
            </p>
          </div>

          <div className="mt-10 hidden rounded-2xl bg-peacock-900/60 p-5 ring-1 ring-inset ring-white/10 backdrop-blur-sm sm:block lg:mt-0">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="text-small font-semibold text-peacock-100">Example claim · Apollo Hospitals</div>
              <div className="figures rounded-full bg-white/10 px-2.5 py-0.5 text-tiny font-semibold text-marigold-300">
                {demoStep >= DEMO_ROUTE.length - 1 ? "26 min of 3 h used" : "On the clock"}
              </div>
            </div>
            <JourneyRail steps={demoSteps} label="Example claim progress" onDark />
          </div>

          <dl className="mt-10 hidden grid-cols-2 gap-x-8 gap-y-4 border-t border-white/10 pt-6 sm:grid lg:mt-0 xl:grid-cols-4">
            {FACTS.map((f) => (
              <div key={f.label}>
                <dt className="text-tiny font-medium text-peacock-200/80">{f.label}</dt>
                <dd className="figures mt-0.5 text-lg font-semibold tracking-[-0.01em]">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Sign-in */}
      <section className="flex flex-1 items-start justify-center px-5 py-10 sm:px-10 lg:items-center lg:py-12">
        <div className="w-full max-w-[420px] animate-rise">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-3">Use your InsuriMax work account.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-small font-semibold text-ink-2">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={email}
                  aria-invalid={Boolean(error) && !email ? true : undefined}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 pl-10 text-body"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-small font-semibold text-ink-2">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  aria-invalid={Boolean(error) && !password ? true : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-10 pr-12 text-body"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-vermilion-50 px-3 py-2 text-small font-medium text-vermilion-700">
                {error}
              </p>
            )}

            <Button ref={submitRef} type="submit" size="lg" loading={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-6 rounded-xl border border-peacock-200/80 bg-peacock-50/70 p-3.5 transition-all">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-peacock-100 text-peacock-800">
                <SearchCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-small font-semibold text-peacock-900">Patient or family member?</div>
                <p className="mt-0.5 text-tiny text-peacock-700 leading-snug">
                  Track your cashless claim status, check deductions, or raise an IRDAI Bima Bharosa escalation without logging in.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/patient")}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-peacock-800 hover:text-peacock-950 hover:underline"
                >
                  <span>Check claim status</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {DEMO_PERSONAS_ENABLED && (
            <div className="mt-8">
              <div className="flex items-center gap-3 text-small font-medium text-ink-3">
                <span className="h-px flex-1 bg-line" />
                or fill in a demo persona
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="mt-4 grid gap-2.5">
                {PERSONAS.map((p) => {
                  const cred = DEMO_CREDENTIALS[p.key]
                  const personName = cred?.name?.replace(/\s*\(.*\)$/, "")
                  const selected = persona === p.key
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => handleDemoFill(p.key)}
                      aria-pressed={selected}
                      className={cn(
                        "group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-surface p-3 text-left shadow-card transition-[box-shadow,transform] duration-150 hover:shadow-raised active:scale-[0.99]",
                        selected && "ring-2 ring-peacock-500"
                      )}
                    >
                      <Avatar name={personName} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{p.title}</span>
                        <span className="block truncate text-small text-ink-3">
                          {personName} · {p.desc}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "text-tiny font-semibold transition-colors",
                          selected ? "text-peacock-600" : "text-ink-3 group-hover:text-ink-2"
                        )}
                      >
                        {selected ? "Filled in" : "Use"}
                      </span>
                    </button>
                  )
                })}
              </div>
              {persona && (
                <p className="mt-3 animate-fade-in text-small text-ink-3">
                  Details filled in. Press <span className="font-semibold text-ink-2">Sign in</span> to open the workspace.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
