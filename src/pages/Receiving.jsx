import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, Package, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'

const emptyItem = { sku: '', description: '', quantity: '', condition: 'A', location: '' }
const emptyForm = { clientId: '', clientName: '', poNumber: '', receivedDate: '', notes: '', items: [{ ...emptyItem }] }

const conditionColors = {
  A: 'bg-green-500/10 text-green-400 border-green-500/20',
  B: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  C: 'bg-red-500/10 text-red-400 border-red-500/20'
}

export default function Receiving() {
  const [receipts, setReceipts] = useState([])
  const [clients, setClients] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  const fetchData = async () => {
    const [receiptsSnap, clientsSnap] = await Promise.all([
      getDocs(query(collection(db, 'receipts'), orderBy('receivedDate', 'desc'))),
      getDocs(collection(db, 'clients'))
    ])
    setReceipts(receiptsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const handleClientChange = (clientId) => {
    const client = clients.find(c => c.id === clientId)
    setForm({ ...form, clientId, clientName: client?.companyName || '' })
  }

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] })

  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) })

  const updateItem = (i, field, value) => {
    const items = [...form.items]
    items[i] = { ...items[i], [field]: value }
    setForm({ ...form, items })
  }

  const handleSubmit = async () => {
    if (!form.clientId || !form.receivedDate) return
    setLoading(true)
    try {
      // Save receipt
      await addDoc(collection(db, 'receipts'), {
        ...form,
        createdAt: new Date().toISOString(),
        totalUnits: form.items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
      })
      // Save each item to inventory
      for (const item of form.items) {
        if (!item.sku || !item.quantity) continue
        await addDoc(collection(db, 'inventory'), {
          clientId: form.clientId,
          clientName: form.clientName,
          sku: item.sku.toUpperCase(),
          description: item.description,
          quantity: Number(item.quantity),
          condition: item.condition,
          location: item.location,
          receivedDate: form.receivedDate,
          poNumber: form.poNumber,
          createdAt: new Date().toISOString()
        })
      }
      setForm(emptyForm)
      setShowModal(false)
      fetchData()
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Receiving</h2>
          <p className="text-sm text-gray-500 mt-0.5">{receipts.length} inbound receipts</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setShowModal(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Receipt
        </button>
      </div>

      {/* Receipts list */}
      <div className="space-y-3">
        {receipts.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <Package size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No receipts yet — click New Receipt to log inbound inventory</p>
          </div>
        ) : (
          receipts.map((r) => (
            <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Receipt header */}
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 bg-blue-600/10 border border-blue-600/20 rounded-lg flex items-center justify-center">
                    <Package size={16} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{r.clientName}</p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {r.poNumber ? `PO# ${r.poNumber} · ` : ''}{r.receivedDate} · {r.totalUnits} units
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{r.items?.length} SKU{r.items?.length !== 1 ? 's' : ''}</span>
                  <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedId === r.id ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Expanded items */}
              {expandedId === r.id && (
                <div className="border-t border-gray-800 px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left pb-2 font-medium">SKU</th>
                        <th className="text-left pb-2 font-medium">Description</th>
                        <th className="text-left pb-2 font-medium">Qty</th>
                        <th className="text-left pb-2 font-medium">Condition</th>
                        <th className="text-left pb-2 font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {r.items?.map((item, i) => (
                        <tr key={i}>
                          <td className="py-2 text-white font-mono text-xs">{item.sku}</td>
                          <td className="py-2 text-gray-300">{item.description}</td>
                          <td className="py-2 text-gray-300">{item.quantity}</td>
                          <td className="py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[item.condition]}`}>
                              Grade {item.condition}
                            </span>
                          </td>
                          <td className="py-2 text-gray-300">{item.location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.notes && <p className="text-gray-500 text-xs mt-3">Notes: {r.notes}</p>}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">New Inbound Receipt</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Client + PO + Date */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3 sm:col-span-1">
                  <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                  <select
                    value={form.clientId}
                    onChange={e => handleClientChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select client...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.companyName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">PO Number</label>
                  <input
                    value={form.poNumber}
                    onChange={e => setForm({ ...form, poNumber: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="PO-001"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Received Date *</label>
                  <input
                    type="date"
                    value={form.receivedDate}
                    onChange={e => setForm({ ...form, receivedDate: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-gray-400 text-xs">Items</label>
                  <button onClick={addItem} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                    <Plus size={12} /> Add item
                  </button>
                </div>
                <div className="space-y-2">
                  {form.items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-start">
                      <input
                        value={item.sku}
                        onChange={e => updateItem(i, 'sku', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 uppercase"
                        placeholder="SKU"
                      />
                      <input
                        value={item.description}
                        onChange={e => updateItem(i, 'description', e.target.value)}
                        className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Description"
                      />
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateItem(i, 'quantity', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Qty"
                      />
                      <select
                        value={item.condition}
                        onChange={e => updateItem(i, 'condition', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                      >
                        <option value="A">Grade A</option>
                        <option value="B">Grade B</option>
                        <option value="C">Grade C</option>
                      </select>
                      <input
                        value={item.location}
                        onChange={e => updateItem(i, 'location', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Bin"
                      />
                      <button
                        onClick={() => removeItem(i)}
                        disabled={form.items.length === 1}
                        className="col-span-1 text-gray-600 hover:text-red-400 disabled:opacity-20 flex items-center justify-center pt-2"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Any special notes about this shipment..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !form.clientId || !form.receivedDate}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : 'Save Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}