import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, Pencil, Trash2, Package, Search } from 'lucide-react'

const RATE_TYPES = [
  { id: 'per_pallet', label: 'Per Pallet' },
  { id: 'per_unit',   label: 'Per Unit'   },
  { id: 'per_sqft',  label: 'Per Sq Ft'  },
]

const emptyForm = {
  clientId: '', clientName: '',
  sku: '', description: '', secondaryDescription: '',
  length: '', width: '', height: '', weight: '',
  unitsPerPallet: '',
  piecesPerCarton: '',
  storageRateType: 'per_pallet',
  storageRate: '',
  minMonthlyCharge: '',
  notes: ''
}

export default function Items() {
  const [items, setItems] = useState([])
  const [clients, setClients] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')

  const fetchData = async () => {
    const [itemsSnap, clientsSnap] = await Promise.all([
      getDocs(collection(db, 'items')),
      getDocs(collection(db, 'clients'))
    ])
    setItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const handleClientChange = (clientId) => {
    const client = clients.find(c => c.id === clientId)
    setForm({ ...form, clientId, clientName: client?.companyName || '' })
  }

  const handleSubmit = async () => {
    if (!form.clientId || !form.sku) return
    setLoading(true)
    try {
      const data = { ...form, sku: form.sku.toUpperCase(), updatedAt: new Date().toISOString() }
      if (editId) {
        await updateDoc(doc(db, 'items', editId), data)
      } else {
        await addDoc(collection(db, 'items'), { ...data, createdAt: new Date().toISOString() })
      }
      setForm(emptyForm)
      setEditId(null)
      setShowModal(false)
      fetchData()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const handleEdit = (item) => {
    setForm({
      clientId: item.clientId || '',
      clientName: item.clientName || '',
      sku: item.sku || '',
      description: item.description || '',
      secondaryDescription: item.secondaryDescription || '',
      length: item.length || '',
      width: item.width || '',
      height: item.height || '',
      weight: item.weight || '',
      unitsPerPallet: item.unitsPerPallet || '',
      piecesPerCarton: item.piecesPerCarton || '',
      storageRateType: item.storageRateType || 'per_pallet',
      storageRate: item.storageRate || '',
      minMonthlyCharge: item.minMonthlyCharge || '',
      notes: item.notes || ''
    })
    setEditId(item.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this SKU?')) return
    await deleteDoc(doc(db, 'items', id))
    fetchData()
  }

  const filtered = items.filter(item => {
    const matchesClient = filterClient ? item.clientId === filterClient : true
    const matchesSearch = search
      ? item.sku?.toLowerCase().includes(search.toLowerCase()) ||
        item.description?.toLowerCase().includes(search.toLowerCase())
      : true
    return matchesClient && matchesSearch
  })

  const getRateLabel = (type) => RATE_TYPES.find(r => r.id === type)?.label || type

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Items / SKU Catalog</h2>
          <p className="text-sm text-gray-500 mt-0.5">{items.length} total SKUs across all clients</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setEditId(null); setShowModal(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Add SKU
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-3 text-gray-500" />
          <input
            type="text"
            placeholder="Search SKU or description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 w-72"
          />
        </div>
        <select
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
        >
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">SKU</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Description</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Client</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Dimensions</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Units/Pallet</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Storage Rate</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Min Monthly</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <Package size={32} className="text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No SKUs yet — click Add SKU to create your first item</p>
                </td>
              </tr>
            ) : filtered.map((item, i) => (
              <tr key={item.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                <td className="px-4 py-3 text-white font-mono text-xs font-medium">{item.sku}</td>
                <td className="px-4 py-3">
                  <p className="text-white text-sm">{item.description}</p>
                  {item.secondaryDescription && <p className="text-gray-500 text-xs">{item.secondaryDescription}</p>}
                </td>
                <td className="px-4 py-3 text-gray-300 text-sm">{item.clientName}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {item.length && item.width && item.height
                    ? `${item.length}"×${item.width}"×${item.height}"`
                    : '—'}
                  {item.weight ? <span className="ml-1 text-gray-500">{item.weight}lb</span> : ''}
                </td>
                <td className="px-4 py-3 text-gray-300 text-sm">{item.unitsPerPallet || '—'}</td>
                <td className="px-4 py-3">
                  {item.storageRate ? (
                    <div>
                      <span className="text-white font-medium">${item.storageRate}</span>
                      <span className="text-gray-500 text-xs ml-1">/ {getRateLabel(item.storageRateType)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-gray-300 text-sm">
                  {item.minMonthlyCharge ? `$${item.minMonthlyCharge}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => handleEdit(item)} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-400 p-1 rounded transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">{editId ? 'Edit SKU' : 'Add New SKU'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="px-6 py-4 space-y-5">

              {/* Client + SKU */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                  <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                  <select
                    value={form.clientId}
                    onChange={e => handleClientChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">SKU *</label>
                  <input
                    value={form.sku}
                    onChange={e => setForm({ ...form, sku: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 uppercase"
                    placeholder="AB-CAL-KING"
                  />
                </div>
              </div>

              {/* Descriptions */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Item Description *</label>
                  <input
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="CAL KING (72×84×15)"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Secondary Description</label>
                  <input
                    value={form.secondaryDescription}
                    onChange={e => setForm({ ...form, secondaryDescription: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="Optional detail"
                  />
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <label className="text-gray-400 text-xs mb-2 block">Dimensions & Weight</label>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { field: 'length', placeholder: 'Length (in)' },
                    { field: 'width',  placeholder: 'Width (in)'  },
                    { field: 'height', placeholder: 'Height (in)' },
                    { field: 'weight', placeholder: 'Weight (lb)' },
                  ].map(({ field, placeholder }) => (
                    <input
                      key={field}
                      type="number"
                      value={form[field]}
                      onChange={e => setForm({ ...form, [field]: e.target.value })}
                      className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                      placeholder={placeholder}
                    />
                  ))}
                </div>
              </div>

              {/* Units per pallet */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Units per Pallet</label>
                  <input
                  type="number"
                   value={form.unitsPerPallet}
    onChange={e => setForm({ ...form, unitsPerPallet: e.target.value })}
    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
    placeholder="e.g. 120"
  />
</div>
<div>
  <label className="text-gray-400 text-xs mb-1 block">Pieces per Carton</label>
  <input
    type="number"
    value={form.piecesPerCarton}
    onChange={e => setForm({ ...form, piecesPerCarton: e.target.value })}
    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
    placeholder="e.g. 12"
  />
</div>
              </div>

              {/* Storage rates */}
              <div className="border border-gray-700 rounded-xl p-4 space-y-3">
                <p className="text-white text-sm font-medium">Recurring Storage</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Rate Type</label>
                    <select
                      value={form.storageRateType}
                      onChange={e => setForm({ ...form, storageRateType: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    >
                      {RATE_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Rate ($ / {getRateLabel(form.storageRateType)})</label>
                    <input
                      type="number"
                      value={form.storageRate}
                      onChange={e => setForm({ ...form, storageRate: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g. 25.00"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Min Monthly Charge ($)</label>
                    <input
                      type="number"
                      value={form.minMonthlyCharge}
                      onChange={e => setForm({ ...form, minMonthlyCharge: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g. 100.00"
                    />
                  </div>
                </div>

                {/* Live preview */}
                {form.storageRate && (
                  <div className="bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-400">
                    💡 This SKU will be charged <span className="text-white font-medium">${form.storageRate}</span> per {getRateLabel(form.storageRateType).toLowerCase()} per month
                    {form.minMonthlyCharge ? `, with a minimum of $${form.minMonthlyCharge}` : ''}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Any special handling or storage instructions..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !form.clientId || !form.sku}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : editId ? 'Save Changes' : 'Add SKU'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}