import { useEffect, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../context/AuthContext'
import { CheckCircle, XCircle, Loader } from 'lucide-react'

export default function QboCallback() {
  const { user, loading: authLoading } = useAuth()
  const [status, setStatus] = useState('loading') // loading | success | error
  const [message, setMessage] = useState('Connecting to QuickBooks…')
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setStatus('error')
      setMessage('You must be signed in to complete the QuickBooks connection.')
      return
    }

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const realmId = params.get('realmId')
    const state = params.get('state')
    const error = params.get('error')

    if (error) {
      setStatus('error')
      setMessage(`QuickBooks denied the connection: ${error}`)
      return
    }
    if (!code || !realmId || !state) {
      setStatus('error')
      setMessage('Missing OAuth parameters from QuickBooks. Try again from Settings.')
      return
    }

    const functions = getFunctions()
    const exchange = httpsCallable(functions, 'qboExchangeCode')
    exchange({ code, realmId, state })
      .then(res => {
        setStatus('success')
        setCompanyName(res.data?.companyName || 'your QuickBooks company')
        setMessage(`Connected to ${res.data?.companyName || 'QuickBooks'}.`)
        setTimeout(() => {
          window.location.href = '/'  // Go back to the app; user lands on Dashboard
        }, 2200)
      })
      .catch(err => {
        console.error('Exchange failed:', err)
        setStatus('error')
        setMessage(err?.message || 'Token exchange failed. Try again from Settings.')
      })
  }, [authLoading, user])

  const Icon = status === 'success' ? CheckCircle : status === 'error' ? XCircle : Loader
  const iconColor = status === 'success' ? 'text-green-500' : status === 'error' ? 'text-red-500' : 'text-blue-500'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-md w-full text-center">
        <Icon size={48} className={`mx-auto mb-4 ${iconColor} ${status === 'loading' ? 'animate-spin' : ''}`} />
        <h2 className="text-xl font-semibold text-white mb-2">
          {status === 'success' ? 'QuickBooks connected' :
           status === 'error'   ? 'Connection failed'    :
                                   'Finishing setup…'}
        </h2>
        <p className="text-gray-400 text-sm">{message}</p>
        {status === 'success' && (
          <p className="text-gray-500 text-xs mt-4">Redirecting you back to JCT WMS…</p>
        )}
        {status === 'error' && (
          <a href="/" className="inline-block mt-6 text-blue-400 hover:text-blue-300 text-sm">← Back to JCT WMS</a>
        )}
      </div>
    </div>
  )
}
