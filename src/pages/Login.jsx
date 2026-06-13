import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import ThemeToggle from '../components/ThemeToggle'

export default function Login() {
  const { theme: t } = useTheme()
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
    <div style={{ background: t.mainBg }} className="min-h-screen flex">

      {/* ── Left: form ─────────────────────────────────────────── */}
      <div
        style={{ background: t.cardBg }}
        className="flex-1 lg:flex-[1.1] flex flex-col px-8 md:px-16 py-10 relative"
      >
        {/* Top bar: logo + theme toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <div style={{ background: t.btnPrimary }} className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-base font-semibold">J</span>
            </div>
            <span style={{ color: t.text }} className="text-base font-semibold tracking-tight">JCT WMS</span>
          </div>
          <ThemeToggle collapsed />
        </div>

        {/* Center: form */}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            <h1 style={{ color: t.text }} className="text-3xl font-semibold tracking-tight mb-2">Welcome back</h1>
            <p style={{ color: t.textSubtle }} className="text-sm mb-8">Sign in to your warehouse management dashboard.</p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label style={{ color: t.textMuted }} className="text-xs font-medium mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label style={{ color: t.textMuted }} className="text-xs font-medium mb-1.5 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{ background: t.btnPrimary }}
                className="w-full disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-opacity mt-1"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <p style={{ color: t.textSubtle }} className="text-xs text-center">
          JCT Warehouse Operations · Ontario, California
        </p>
      </div>


      {/* ── Right: warehouse photo (hidden on mobile) ──────────── */}
      <div className="hidden lg:block lg:flex-1 relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1689942010216-dc412bb1e7a9?auto=format&fit=crop&w=1600&q=80"
          alt="JCT warehouse"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Subtle bottom-up gradient overlay for text legibility */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to top, rgba(8,47,73,0.85) 0%, rgba(8,47,73,0.25) 45%, rgba(8,47,73,0) 70%)'
        }}/>
        {/* Branding overlay */}
        <div className="absolute bottom-10 left-10 right-10 text-white">
          <div className="flex items-center gap-2 mb-3 opacity-90">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-400"/>
            <span className="text-[11px] font-medium tracking-widest uppercase">JCT Logistics Inc.</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight leading-tight" style={{ letterSpacing: '-0.02em' }}>
            Warehouse management,<br/>built for our operation.
          </h2>
          <p className="text-sm mt-3 text-sky-100/80 max-w-sm">
            Receiving, inventory, orders, and billing — all in one place.
          </p>
        </div>
      </div>
    </div>
  )
}
