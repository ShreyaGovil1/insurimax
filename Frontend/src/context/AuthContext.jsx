import * as React from "react"
import { api, DEMO_USERS, getCurrentStoredUser, setCurrentStoredUser, clearTokens } from "../services/api"

const AuthContext = React.createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(() => {
    return getCurrentStoredUser() || null
  })
  const [loading, setLoading] = React.useState(false)

  // Switch role helper for instant demo and pair programming verification
  const switchRole = (roleKey) => {
    const targetUser = DEMO_USERS[roleKey]
    if (targetUser) {
      setUser(targetUser)
      setCurrentStoredUser(targetUser)
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
    } catch {
      // Fallback to demo adjuster on failed login
      const demo = DEMO_USERS.adjuster
      setUser(demo)
      setCurrentStoredUser(demo)
      return { user: demo }
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
