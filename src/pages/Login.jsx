import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { useTheme } from '../context/ThemeContext'

export default function Login() {
  const { theme: t, themeId, switchTheme } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      setError('Invalid email or password')
      setLoading(false)
    }
  }

  return (
    <div style={{ background: t.mainBg }} className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div style={{ background: t.btnPrimary }} className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">J</span>
          </div>
          <h1 style={{ color: t.text }} className="text-3xl font-bold">JCT WMS</h1>
          <p style={{ color: t.textSubtle }} className="mt-2 text-sm">Warehouse Management System</p>
        </div>

        {/* Card */}
        <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }} className="rounded-2xl p-8 shadow-sm">
          <h2 style={{ color: t.text }} className="text-xl font-semibold mb-6">Sign in</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label style={{ color: t.textMuted }} className="text-sm mb-1.5 block font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
                className="w-full rounded-lg px-4 py-3 text-sm focus:outline-none"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label style={{ color: t.textMuted }} className="text-sm mb-1.5 block font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
                className="w-full rounded-lg px-4 py-3 text-sm focus:outline-none"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ background: t.btnPrimary }}
              className="w-full disabled:opacity-50 text-white font-medium rounded-lg py-3 text-sm transition-colors mt-2"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Theme switcher on login */}
        <div className="flex justify-center gap-2 mt-6">
          {['🌙', '🔵', '🌿'].map((emoji, i) => {
            const ids = ['dark', 'brand', 'warm']
            return (
              <button
                key={ids[i]}
                onClick={() => switchTheme(ids[i])}
                style={{
                  background: themeId === ids[i] ? t.btnPrimary : t.cardBg,
                  border: `1px solid ${t.cardBorder}`,
                  color: themeId === ids[i] ? '#fff' : t.textSubtle
                }}
                className="w-9 h-9 rounded-full text-base transition-colors"
              >
                {emoji}
              </button>
            )
          })}
        </div>

        <p style={{ color: t.textSubtle }} className="text-xs text-center mt-4">
          JCT Warehouse Operations · Ontario, California
        </p>
      </div>
    </div>
  )
}