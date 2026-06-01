import { useState, useEffect } from 'react'
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { db, auth } from '../firebase'
import { setDoc } from 'firebase/firestore'
import { Plus, X, Trash2, Users, CheckCircle, Shield } from 'lucide-react'

const ROLES = [
  {
    id: 'staff',
    label: 'Warehouse Staff',
    description: 'Can access Receiving and Inventory only',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    access: ['Receiving', 'Inventory']
  },
  {
    id: 'supervisor',
    label: 'Supervisor',
    description: 'Can access everything except Billing and Client Accounts',
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    access: ['Receiving', 'Inventory', 'Orders', 'Reports']
  },
  {
    id: 'billing',
    label: 'Billing Staff',
    description: 'Can access Billing, Clients, and Reports only',
    color: 'bg-green-500/10 text-green-400 border-green-500/20',
    access: ['Billing', 'Clients', 'Reports']
  }
]

export default function StaffManagement() {
  const [staff, setStaff] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const fetchStaff = async () => {
    const snap = await getDocs(collection(db, 'users'))
    setStaff(snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role !== 'client')
    )
  }

  useEffect(() => { fetchStaff() }, [])

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) return
    setLoading(true)
    setError('')
    try {
      const credential = await createUserWithEmailAndPassword(auth, form.email, form.password)
      await setDoc(doc(db, 'users', credential.user.uid), {
        name: form.name,
        email: form.email,
        role: form.role,
        clientId: null,
        createdAt: new Date().toISOString()
      })
      setSuccess(`${form.name} added successfully`)
      setForm({ name: '', email: '', password: '', role: 'staff' })
      setShowModal(false)
      fetchStaff()
    } catch (err) {
      setError(err.message.replace('Firebase: ', '').replace(' (auth/email-already-in-use).', ' — email already in use.'))
    }
    setLoading(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this staff member?')) return
    await deleteDoc(doc(db, 'users', id))
    fetchStaff()
  }

  const getRoleConfig = (roleId) => ROLES.find(r => r.id === roleId) || ROLES[0]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Staff Management</h2>
          <p className="text-sm text-gray-500 mt-0.5">{staff.length} staff accounts</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setError(''); setSuccess('') }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Add Staff
        </button>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Role legend */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {ROLES.map(role => (
          <div key={role.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={14} className="text-gray-400" />
              <span className={`text-xs px-2 py-0.5 rounded-full border ${role.color}`}>{role.label}</span>
            </div>
            <p className="text-gray-500 text-xs mb-2">{role.description}</p>
            <div className="flex flex-wrap gap-1">
              {role.access.map(a => (
                <span key={a} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                  {a}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Staff table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Role</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Access</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Added</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Users size={32} className="text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No staff accounts yet</p>
                </td>
              </tr>
            ) : (
              staff.map((member, i) => {
                const role = getRoleConfig(member.role)
                return (
                  <tr key={member.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                    <td className="px-4 py-3 text-white font-medium">{member.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{member.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${role.color}`}>
                        {role.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {role.access.map(a => (
                          <span key={a} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                            {a}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(member.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">Add Staff Member</h3>
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
                <label className="text-gray-400 text-xs mb-1 block">Full Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="john@jctlogistics.com"
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
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Role *</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  {ROLES.map(r => (
                    <option key={r.id} value={r.id}>{r.label} — {r.description}</option>
                  ))}
                </select>
              </div>
              {form.role && (
                <div className="bg-gray-800 rounded-lg px-3 py-2">
                  <p className="text-gray-400 text-xs mb-1">This staff member will have access to:</p>
                  <div className="flex flex-wrap gap-1">
                    {getRoleConfig(form.role).access.map(a => (
                      <span key={a} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{a}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !form.name || !form.email || !form.password}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {loading ? 'Creating...' : 'Add Staff Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}