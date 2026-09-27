import React, { useState } from "react"
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
import { ClaimCreateModal } from "./components/claims/ClaimCreateModal"

function AppContent() {
  const { user, isAuthenticated, login, switchRole } = useAuth()
  const [currentView, setCurrentView] = useState("queue") // "queue" | "cockpit" | "claims" | "hospital" | "policies" | "analytics"
  const [selectedClaimId, setSelectedClaimId] = useState(null)
  const [createClaimOpen, setCreateClaimOpen] = useState(false)

  const handleLogin = async (email, password, fullName, demoRole) => {
    if (demoRole) {
      // Instant demo login
      switchRole(demoRole)
      return
    }
    // Attempt real API login; auth context handles fallback
    await login(email, password)
  }

  const handleSelectClaim = (claimId) => {
    setSelectedClaimId(claimId)
    setCurrentView("cockpit")
  }

  const handleClaimCreated = (newClaim) => {
    if (newClaim?.id) {
      setSelectedClaimId(newClaim.id)
      setCurrentView("cockpit")
    } else {
      setCurrentView("queue")
    }
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header
        currentView={currentView}
        onViewChange={(view) => {
          setCurrentView(view)
          if (view !== "cockpit") setSelectedClaimId(null)
        }}
        onNewClaim={() => setCreateClaimOpen(true)}
      />

      <main className="flex-1 pb-12">
        {currentView === "queue" && (
          <AdjusterQueueView onSelectClaim={handleSelectClaim} />
        )}

        {currentView === "cockpit" && selectedClaimId && (
          <AdjudicationCockpit
            claimId={selectedClaimId}
            onBack={() => {
              setCurrentView("queue")
              setSelectedClaimId(null)
            }}
          />
        )}

        {currentView === "claims" && (
          <ClaimsExplorerView
            onSelectClaim={handleSelectClaim}
            onNewClaim={() => setCreateClaimOpen(true)}
          />
        )}

        {currentView === "hospital" && (
          <HospitalPreCheckView onClaimCreated={handleClaimCreated} />
        )}

        {currentView === "policies" && <PolicyLibraryView />}

        {currentView === "analytics" && <AnalyticsComplianceView />}
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
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  )
}
