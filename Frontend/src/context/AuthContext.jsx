import * as React from "react"
import { api, DEMO_CREDENTIALS, getAccessToken, getCurrentStoredUser, setCurrentStoredUser, clearTokens } from "../services/api"

const AuthContext = React.createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(() => {
    return getCurrentStoredUser() || null
  })
  const [loading, setLoading] = React.useState(false)
  // The cached user (localStorage) can be stale; confirm it with the server before trusting it.
  const [initializing, setInitializing] = React.useState(() => !!getAccessToken())

  const syncUser = React.useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null)
      return
    }
    try {
      const me = await api.auth.getMe()
      setUser(me)
      setCurrentStoredUser(me)
    } catch (err) {
      // 401 already cleared tokens and fired auth:expired; other errors keep the cached session
      if (err.status === 401) {
        clearTokens()
        setUser(null)
      }
    }
  }, [])

  React.useEffect(() => {
    syncUser().finally(() => setInitializing(false))

    const onExpired = () => setUser(null)
    const onFocus = () => {
      if (getAccessToken()) syncUser()
    }
    window.addEventListener("auth:expired", onExpired)
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("auth:expired", onExpired)
      window.removeEventListener("focus", onFocus)
    }
  }, [syncUser])

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
        loading: loading || initializing,
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
