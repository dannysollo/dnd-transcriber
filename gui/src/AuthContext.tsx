import { createContext, useContext, useEffect, useState } from 'react'

export interface CurrentUser {
  id: number
  discord_id: string
  username: string
  discriminator: string
  avatar: string | null
  email: string | null
  is_admin: boolean
}

interface AuthState {
  user: CurrentUser | null
  isLoggedIn: boolean
  authEnabled: boolean
  loading: boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoggedIn: false,
  authEnabled: false,
  loading: true,
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const r = await fetch('/auth/me')
      if (r.ok) {
        const data = await r.json()
        setUser(data.user ?? null)
        setAuthEnabled(data.auth_enabled ?? false)
      }
    } catch {
      // server not reachable — stay unauthenticated
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, authEnabled, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

/** Avatar URL helper — returns Discord CDN URL or a placeholder. */
export function avatarUrl(user: CurrentUser): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`
  }
  // Default Discord avatar based on discriminator (new system: use user id % 5)
  const index = Number(BigInt(user.discord_id) % 5n)
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}
