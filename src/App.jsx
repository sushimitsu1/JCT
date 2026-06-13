import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Login from './pages/Login'
import QboCallback from './pages/QboCallback'
import Dashboard from './pages/Dashboard'
import ClientPortal from './pages/ClientPortal'

function AppContent() {
  if (typeof window !== 'undefined' && window.location.pathname === '/qbo-callback') return <QboCallback />
  const { user, userRole } = useAuth()
  if (!user) return <Login />
  if (userRole === 'client') return <ClientPortal />
  return <Dashboard />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  )
}