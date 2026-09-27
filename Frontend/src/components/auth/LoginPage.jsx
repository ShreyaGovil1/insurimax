import React, { useState } from "react"
import { ShieldCheck, Mail, Lock, ArrowRight, Sparkles, Clock, CheckCircle2, TrendingUp, Eye, EyeOff } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

const STATS = [
  { icon: Clock, value: "<30 min", label: "Avg. adjudication time" },
  { icon: CheckCircle2, value: "97.2%", label: "SLA compliance rate" },
  { icon: TrendingUp, value: "94%", label: "AI confidence avg." },
  { icon: Sparkles, value: "Gemini 1.5 Pro", label: "Multimodal AI engine" },
]

export function LoginPage({ onLogin }) {
  const { toast } = useToast()
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (isRegister) {
        if (!fullName.trim()) {
          toast({ title: "Validation Error", description: "Full name is required", variant: "destructive" })
          setLoading(false)
          return
        }
        // Attempt API registration, then fallback to demo
        await onLogin(email, password, fullName)
      } else {
        await onLogin(email, password)
      }
    } catch (err) {
      toast({
        title: "Authentication Notice",
        description: "Entering demo mode with sample data",
        variant: "default",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDemoLogin = (role) => {
    onLogin(null, null, null, role)
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Left Panel — Branding & Features */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700">
        {/* Subtle animated grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Glow orbs */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-400/20 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 text-white w-full">
          {/* Logo */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 shadow-lg">
              <ShieldCheck className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">InsuriMax</h1>
              <p className="text-xs text-blue-200 font-medium">IRDAI 3-Hour Cashless Engine</p>
            </div>
          </div>

          {/* Hero Text */}
          <div className="space-y-6 max-w-xl">
            <h2 className="text-4xl xl:text-5xl font-extrabold leading-tight tracking-tight">
              Claims adjudication
              <br />
              <span className="text-blue-200">at the speed of AI.</span>
            </h2>
            <p className="text-lg text-blue-100/90 leading-relaxed max-w-md">
              Reduce TPA cashless adjudication from 3+ hours to under 30 minutes
              with Gemini 1.5 Pro multimodal long-context analysis.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className="flex items-start space-x-3 bg-white/8 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:bg-white/12 transition-colors"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/15 flex-shrink-0">
                  <stat.icon className="w-4.5 h-4.5 text-blue-200" />
                </div>
                <div>
                  <div className="text-lg font-bold">{stat.value}</div>
                  <div className="text-xs text-blue-200/80">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-20 bg-slate-50">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center space-x-2 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-600 text-white shadow-md">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <span className="text-xl font-extrabold text-slate-900 tracking-tight">InsuriMax</span>
        </div>

        <div className="w-full max-w-md mx-auto space-y-8">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {isRegister ? "Create your account" : "Welcome back"}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {isRegister
                ? "Join your TPA organisation to start adjudicating claims"
                : "Sign in to your InsuriMax workspace"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {isRegister && (
              <div className="space-y-1.5">
                <label htmlFor="fullName" className="block text-xs font-semibold text-slate-700">
                  Full Name
                </label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required={isRegister}
                  className="h-11"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-700">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 pl-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm shadow-blue-500/20 flex items-center justify-center gap-2 text-sm"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isRegister ? "Create Account" : "Sign In"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-slate-50 px-3 text-xs text-slate-400 font-medium">
                or start with a demo persona
              </span>
            </div>
          </div>

          {/* Demo Role Quick Access */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { key: "adjuster", label: "Adjuster", desc: "Review & approve claims" },
              { key: "senior_adjuster", label: "Senior Adjuster", desc: "Escalated reviews" },
              { key: "admin", label: "TPA Admin", desc: "Full org management" },
              { key: "hospital_desk", label: "Hospital Desk", desc: "Pre-check & submit" },
            ].map((role) => (
              <button
                key={role.key}
                onClick={() => handleDemoLogin(role.key)}
                className="group flex flex-col items-start p-3 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left cursor-pointer"
              >
                <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-700 transition-colors">
                  {role.label}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">{role.desc}</span>
              </button>
            ))}
          </div>

          {/* Toggle */}
          <p className="text-center text-xs text-slate-500">
            {isRegister ? "Already have an account?" : "New to InsuriMax?"}{" "}
            <button
              onClick={() => setIsRegister(!isRegister)}
              className="text-blue-600 font-semibold hover:text-blue-700 transition-colors cursor-pointer"
            >
              {isRegister ? "Sign in" : "Create account"}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
