import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClientPortal from './pages/ClientPortal'

function AppContent() {
  const { user, userRole } = useAuth()
  if (!user) return <Login />
  if (userRole === 'client') return <ClientPortal />
  return <Dashboard />
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App