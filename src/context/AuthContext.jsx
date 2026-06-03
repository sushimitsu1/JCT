import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

const AuthContext = createContext()

// Define which pages each role can access
export const ROLE_ACCESS = {
  admin:      ['dashboard', 'items', 'receiving', 'inventory', 'locations', 'orders', 'billing', 'clients', 'accounts', 'staff', 'reports'],
  staff:      ['items', 'receiving', 'inventory', 'locations', 'orders'],
  supervisor: ['dashboard', 'items', 'receiving', 'inventory', 'locations', 'orders', 'reports'],
  billing:    ['billing', 'clients', 'reports'],
  client:     []
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [userClientId, setUserClientId] = useState(null)
  const [userName, setUserName] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (userDoc.exists()) {
          const data = userDoc.data()
          setUserRole(data.role || 'admin')
          setUserClientId(data.clientId || null)
          setUserName(data.name || null)
        } else {
          setUserRole('admin')
          setUserClientId(null)
          setUserName(null)
        }
        setUser(firebaseUser)
      } else {
        setUser(null)
        setUserRole(null)
        setUserClientId(null)
        setUserName(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ user, userRole, userClientId, userName, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}