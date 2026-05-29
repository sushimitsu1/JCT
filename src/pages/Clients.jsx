import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, Pencil, Trash2, Phone, Mail } from 'lucide-react'

const emptyForm = {
  companyName: '', contactName: '', email: '',
  phone: '', billingRate: '', startDate: '', notes: ''
}

export default function Clients() {
  const [clients, setClients] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Load clients from Firestore
  const fetchClients = async () => {
    const snap = await getDocs(collection(db, 'clients'))
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    data.sort((a, b) => a.companyName.localeCompare(b.companyName))
    setClients(data)
  }

  useEffect(() => { fetchClients() }, [])

  const handleSubmit = async () => {
    if (!form.companyName.trim()) return
    setLoading(true)
    try {
      if (editId) {
        await updateDoc(doc(db, 'clients', editId), form)
      } else {
        await addDoc(collection(db, 'clients'), {
          ...form,
          createdAt: new Date().toISOString()
        })
      }
      setForm(emptyForm)
      setEditId(null)
      setShowModal(false)
      fetchClients()
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const handleEdit = (client) => {
    setForm({
      companyName: client.companyName || '',
      contactName: client.contactName || '',
      email: client.email || '',
      phone: client.phone || '',
      billingRate: client.billingRate || '',
      startDate: client.startDate || '',
      notes: client.notes || ''
    })
    setEditId(client.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this client?')) return
    await deleteDoc(doc(db, 'clients', id))
    fetchClients()
  }

  const filtered = clients.filter(c =>
    c.companyName?.toLowerCase().includes(search.toLowerCase()) ||
    c.contactName?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Clients</h2>
          <p className="text-sm text-gray-500 mt-0.5">{clients.length} total clients</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setEditId(null); setShowModal(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Add Client
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search clients..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-sm bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:border-blue-500"
      />

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Company</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Contact</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Phone</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Rate/Pallet</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Since</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-500 py-12">
                  No clients yet — click Add Client to get started
                </td>
              </tr>
            ) : (
              filtered.map((client, i) => (
                <tr key={client.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                  <td className="px-4 py-3 text-white font-medium">{client.companyName}</td>
                  <td className="px-4 py-3 text-gray-300">{client.contactName}</td>
                  <td className="px-4 py-3 text-gray-300">
                    <a href={`mailto:${client.email}`} className="flex items-center gap-1 hover:text-blue-400">
                      <Mail size={13} />{client.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    <span className="flex items-center gap-1">
                      <Phone size={13} />{client.phone}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">${client.billingRate}</td>
                  <td className="px-4 py-3 text-gray-300">{client.startDate}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => handleEdit(client)} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(client.id)} className="text-gray-400 hover:text-red-400 p-1 rounded transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">{editId ? 'Edit Client' : 'Add New Client'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-gray-400 text-xs mb-1 block">Company Name *</label>
                  <input
                    value={form.companyName}
                    onChange={e => setForm({ ...form, companyName: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="ABC Company"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Contact Name</label>
                  <input
                    value={form.contactName}
                    onChange={e => setForm({ ...form, contactName: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Phone</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="(909) 555-0000"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Email</label>
                  <input
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="contact@company.com"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Billing Rate ($/pallet)</label>
                  <input
                    type="number"
                    value={form.billingRate}
                    onChange={e => setForm({ ...form, billingRate: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="25"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm({ ...form, startDate: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-gray-400 text-xs mb-1 block">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none"
                    placeholder="Any special instructions..."
                  />
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !form.companyName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : editId ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}