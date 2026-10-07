'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, getToken, setToken, setUser, removeToken, getUser } from '@/lib/auth'
import { authApi } from '@/lib/api'
import toast from 'react-hot-toast'

interface AuthContextType {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<boolean>
  register: (name: string, email: string, password: string, phone?: string) => Promise<boolean>
  logout: () => void
  isAdmin: boolean
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [token, setTokenState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const savedToken = getToken()
    const savedUser = getUser()
    if (savedToken && savedUser) {
      setTokenState(savedToken)
      setUserState(savedUser)
    }
    setLoading(false)
  }, [])

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const data: any = await authApi.login(email, password)
      setToken(data.token)
      setUser(data.user)
      setTokenState(data.token)
      setUserState(data.user)
      return true
    } catch (err: any) {
      toast.error(err.message || 'Login failed')
      return false
    }
  }

  const register = async (name: string, email: string, password: string, phone?: string): Promise<boolean> => {
    try {
      const data: any = await authApi.register(name, email, password, phone)
      setToken(data.token)
      setUser(data.user)
      setTokenState(data.token)
      setUserState(data.user)
      return true
    } catch (err: any) {
      toast.error(err.message || 'Registration failed')
      return false
    }
  }

  const logout = () => {
    removeToken()
    setUserState(null)
    setTokenState(null)
    window.location.href = '/login'
  }

  const refreshUser = async () => {
    try {
      const data: any = await authApi.me()
      setUser(data.user)
      setUserState(data.user)
    } catch {}
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      login,
      register,
      logout,
      isAdmin: user?.role === 'admin',
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
