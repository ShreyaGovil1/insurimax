import * as React from "react"
import { api, DEMO_CREDENTIALS, getCurrentStoredUser, setCurrentStoredUser, clearTokens } from "../services/api"

const AuthContext = React.createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(() => {
    return getCurrentStoredUser() || null
  })
  const [loading, setLoading] = React.useState(false)

  // Switch role helper — logs into real database user account
  const switchRole = async (roleKey) => {
    const cred = DEMO_CREDENTIALS[roleKey]
    if (cred) {
      return await login(cred.email, cred.password)
    }
  }

  const login = async (email, password) => {
    setLoading(true)
    try {
      const res = await api.auth.login(email, password)
      if (res?.user) {
        setUser(res.user)
        setCurrentStoredUser(res.user)
      }
      return res
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      await api.auth.logout()
    } catch {
      // Ignore logout errors
    }
    setUser(null)
    clearTokens()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        switchRole,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
