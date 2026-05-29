import { useState, useEffect } from 'react'
import { collection, getDocs, doc, setDoc } from 'firebase/firestore'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { db, auth } from '../firebase'
import { Plus, X, Users, CheckCircle } from 'lucide-react'

export default function ClientAccounts() {
  const [clients, setClients] = useState([])
  const [users, setUsers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ clientId: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const fetchData = async () => {
    const [clientsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'users'))
    ])
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const handleCreate = async () => {
    if (!form.clientId || !form.email || !form.password) return
    setLoading(true)
    setError('')
    try {
      const client = clients.find(c => c.id === form.clientId)
      // Create Firebase Auth user
      const credential = await createUserWithEmailAndPassword(auth, form.email, form.password)
      // Save user role + clientId to Firestore
      await setDoc(doc(db, 'users', credential.user.uid), {
        email: form.email,
        role: 'client',
        clientId: form.clientId,
        clientName: client?.companyName || '',
        createdAt: new Date().toISOString()
      })
      setSuccess(`Login created for ${client?.companyName}`)
      setForm({ clientId: '', email: '', password: '' })
      setShowModal(false)
      fetchData()
    } catch (err) {
      setError(err.message.replace('Firebase: ', '').replace(' (auth/email-already-in-use).', ' — this email already has an account.'))
    }
    setLoading(false)
  }

  const clientsWithAccess = users.filter(u => u.role === 'client')
  const clientsWithoutAccess = clients.filter(c =>
    !users.some(u => u.clientId === c.id && u.role === 'client')
  )

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Client Accounts</h2>
          <p className="text-sm text-gray-500 mt-0.5">{clientsWithAccess.length} clients have portal access</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setError(''); setSuccess('') }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Create Client Login
        </button>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Clients with access */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-medium text-white">Has Portal Access</h3>
          </div>
          {clientsWithAccess.length === 0 ? (
            <p className="text-gray-500 text-sm p-4">No client logins created yet</p>
          ) : (
            <div className="divide-y divide-gray-800">
              {clientsWithAccess.map(u => (
                <div key={u.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{u.clientName}</p>
                    <p className="text-gray-500 text-xs">{u.email}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/10 text-green-400 border-green-500/20">
                    Active
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Clients without access */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-medium text-white">No Portal Access Yet</h3>
          </div>
          {clientsWithoutAccess.length === 0 ? (
            <p className="text-gray-500 text-sm p-4">All clients have portal access</p>
          ) : (
            <div className="divide-y divide-gray-800">
              {clientsWithoutAccess.map(c => (
                <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{c.companyName}</p>
                    <p className="text-gray-500 text-xs">{c.email || 'No email on file'}</p>
                  </div>
                  <button
                    onClick={() => { setForm({ clientId: c.id, email: c.email || '', password: '' }); setShowModal(true) }}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Create login →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">Create Client Login</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                <select
                  value={form.clientId}
                  onChange={e => {
                    const client = clients.find(c => c.id === e.target.value)
                    setForm({ ...form, clientId: e.target.value, email: client?.email || '' })
                  }}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select client...</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.companyName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Login Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="client@company.com"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Password *</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Min 6 characters"
                />
              </div>
              <p className="text-gray-500 text-xs">Share these credentials with your client — they'll use them to log into the portal.</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !form.clientId || !form.email || !form.password}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {loading ? 'Creating...' : 'Create Login'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}