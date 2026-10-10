import React, { useState } from "react"
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom"
import { AuthProvider, useAuth } from "./context/AuthContext"
import { ToastProvider } from "./components/ui/toast"
import { LoginPage } from "./components/auth/LoginPage"
import { Header } from "./components/common/Header"
import { AdjusterQueueView } from "./components/queue/AdjusterQueueView"
import { AdjudicationCockpit } from "./components/adjudication/AdjudicationCockpit"
import { ClaimsExplorerView } from "./components/claims/ClaimsExplorerView"
import { HospitalPreCheckView } from "./components/hospital/HospitalPreCheckView"
import { PolicyLibraryView } from "./components/policies/PolicyLibraryView"
import { AnalyticsComplianceView } from "./components/analytics/AnalyticsComplianceView"
import { PatientStatusView } from "./components/patient/PatientStatusView"
import { AdminPanelView } from "./components/admin/AdminPanelView"
import { ClaimCreateModal } from "./components/claims/ClaimCreateModal"

/**
 * Route guard: Redirects to /login if unauthenticated, preserving intended location
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] text-slate-500 text-xs font-semibold">
        Loading InsuriMax Adjudication Engine...
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children ? children : <Outlet />
}

/**
 * Route guard: admins only; others are sent to /queue
 */
function AdminRoute({ children }) {
  const { user } = useAuth()
  if (user?.role !== "admin") return <Navigate to="/queue" replace />
  return children
}

/**
 * Landing path after login: admins go to the admin panel
 */
function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user?.role === "admin" ? "/admin" : "/queue"} replace />
}

/**
 * Route guard: Redirects already-authenticated users to their home page
 */
function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()

  if (loading) return null

  if (isAuthenticated) {
    return <HomeRedirect />
  }

  return children ? children : <Outlet />
}

/**
 * Main application shell with Header, Outlet, and New Claim modal
 */
function AppLayout() {
  const [createClaimOpen, setCreateClaimOpen] = useState(false)
  const navigate = useNavigate()

  const handleClaimCreated = (newClaim) => {
    if (newClaim?.id) {
      navigate(`/claims/${newClaim.id}`)
    } else {
      navigate("/queue")
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] flex flex-col">
      <Header onNewClaim={() => setCreateClaimOpen(true)} />

      <main className="flex-1 pb-12">
        <Outlet context={{ openCreateClaim: () => setCreateClaimOpen(true) }} />
      </main>

      <ClaimCreateModal
        open={createClaimOpen}
        onOpenChange={setCreateClaimOpen}
        onClaimCreated={handleClaimCreated}
      />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public Login Route */}
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <LoginPage />
                </PublicRoute>
              }
            />

            {/* Patient Tracker (Public or Authenticated) */}
            <Route element={<AppLayout />}>
              <Route path="/patient" element={<PatientStatusView />} />
              <Route path="/patient/:claimId" element={<PatientStatusView />} />
            </Route>

            {/* Protected Workspace Routes */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomeRedirect />} />
              <Route path="admin" element={<AdminRoute><AdminPanelView /></AdminRoute>} />
              <Route path="queue" element={<AdjusterQueueView />} />
              <Route
                path="claims"
                element={
                  <ClaimsExplorerView
                    onNewClaim={() => {
                      const btn = document.querySelector('[data-action="new-claim"]')
                      btn?.click()
                    }}
                  />
                }
              />
              <Route path="claims/:claimId/:tab?" element={<AdjudicationCockpit />} />
              <Route path="hospital" element={<HospitalPreCheckView />} />
              <Route path="policies" element={<PolicyLibraryView />} />
              <Route path="analytics" element={<AnalyticsComplianceView />} />
            </Route>

            {/* 404 / Catch-all Route */}
            <Route path="*" element={<Navigate to="/queue" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
