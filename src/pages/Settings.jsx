import { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useTheme } from '../context/ThemeContext'
import { Link2, Unlink, CheckCircle, AlertCircle, Loader } from 'lucide-react'

export default function Settings() {
  const { theme: t } = useTheme()
  const [status, setStatus] = useState({ loading: true, connected: false })
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  const functions = getFunctions()
  const fn = (name) => httpsCallable(functions, name)

  const loadStatus = async () => {
    setStatus({ loading: true, connected: false })
    setError('')
    try {
      const res = await fn('qboStatus')()
      setStatus({ loading: false, ...res.data })
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not load QuickBooks status')
      setStatus({ loading: false, connected: false })
    }
  }

  useEffect(() => { loadStatus() }, [])

  const handleConnect = async () => {
    setActionLoading(true)
    setError('')
    try {
      const useDev = window.location.hostname === 'localhost'
      const res = await fn('qboAuthUrl')({ useDev })
      window.location.href = res.data.url
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not start QuickBooks connection')
      setActionLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect from QuickBooks? You can reconnect at any time.')) return
    setActionLoading(true)
    setError('')
    try {
      await fn('qboDisconnect')()
      await loadStatus()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Disconnect failed')
    }
    setActionLoading(false)
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">Settings</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage integrations and preferences for JCT WMS.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ─── QuickBooks Online card ─────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Link2 size={20} className="text-green-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">QuickBooks Online</h3>
              <p className="text-gray-500 text-xs mt-0.5">
                Push invoices from Billing into QBO. Sync payment status automatically.
              </p>
            </div>
          </div>
          {status.loading ? (
            <span className="flex items-center gap-2 text-xs text-gray-500">
              <Loader size={14} className="animate-spin" /> Checking…
            </span>
          ) : status.connected ? (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              <CheckCircle size={11} /> Connected
            </span>
          ) : (
            <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
              Not connected
            </span>
          )}
        </div>

        {status.connected && (
          <div className="bg-gray-800/40 rounded-lg p-4 mb-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Company</span>
              <span className="text-white font-medium">{status.companyName || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Realm ID</span>
              <span className="text-gray-300 font-mono text-xs">{status.realmId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Environment</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${status.environment === 'sandbox' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                {status.environment}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Connected</span>
              <span className="text-gray-300 text-xs">{status.connectedAt ? new Date(status.connectedAt).toLocaleString() : '—'}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {status.connected ? (
            <button
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 rounded-lg disabled:opacity-50"
            >
              <Unlink size={14} />
              {actionLoading ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={actionLoading || status.loading}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              <Link2 size={14} />
              {actionLoading ? 'Opening Intuit…' : 'Connect to QuickBooks'}
            </button>
          )}
          <button
            onClick={loadStatus}
            disabled={status.loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
