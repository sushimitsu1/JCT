import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, Package, ChevronDown, RefreshCw } from 'lucide-react'

const generatePalletId = () => {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
  const rand = Math.floor(Math.random() * 9000) + 1000
  return `${date}-${rand}`
}

const emptyPallet = { palletId: '', sku: '', description: '', units: '', condition: 'A', location: '' }
const emptyForm = { clientId: '', clientName: '', poNumber: '', receivedDate: '', notes: '', pallets: [{ ...emptyPallet }] }

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

  const addPallet = () => setForm({ ...form, pallets: [...form.pallets, { ...emptyPallet }] })
  const removePallet = (i) => setForm({ ...form, pallets: form.pallets.filter((_, idx) => idx !== i) })
  const updatePallet = (i, field, value) => {
    const pallets = [...form.pallets]
    pallets[i] = { ...pallets[i], [field]: value }
    setForm({ ...form, pallets })
  }
  const autoGenId = (i) => updatePallet(i, 'palletId', generatePalletId())

  const handleSubmit = async () => {
    if (!form.clientId || !form.receivedDate) return
    setLoading(true)
    try {
      const validPallets = form.pallets.filter(p => p.sku)
      const totalPallets = validPallets.length
      const totalUnits = validPallets.reduce((sum, p) => sum + Number(p.units || 0), 0)

      // Save receipt with pallets array
      const receiptDoc = await addDoc(collection(db, 'receipts'), {
        clientId: form.clientId,
        clientName: form.clientName,
        poNumber: form.poNumber,
        receivedDate: form.receivedDate,
        notes: form.notes,
        totalPallets,
        totalUnits,
        pallets: validPallets.map(p => ({
          ...p,
          palletId: p.palletId || generatePalletId(),
          sku: p.sku.toUpperCase()
        })),
        createdAt: new Date().toISOString()
      })

      // Save each pallet to inventory collection
      for (const pallet of validPallets) {
        const palletId = pallet.palletId || generatePalletId()
        await addDoc(collection(db, 'inventory'), {
          palletId,
          clientId: form.clientId,
          clientName: form.clientName,
          sku: pallet.sku.toUpperCase(),
          description: pallet.description,
          units: Number(pallet.units || 0),
          condition: pallet.condition,
          location: pallet.location,
          status: 'available',
          receivedDate: form.receivedDate,
          poNumber: form.poNumber,
          receiptId: receiptDoc.id,
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

      <div className="space-y-3">
        {receipts.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <Package size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No receipts yet — click New Receipt to log inbound inventory</p>
          </div>
        ) : (
          receipts.map((r) => (
            <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
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
                      {r.poNumber ? `PO# ${r.poNumber} · ` : ''}{r.receivedDate} · {r.totalPallets || 0} pallets · {r.totalUnits || 0} units
                    </p>
                  </div>
                </div>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedId === r.id ? 'rotate-180' : ''}`} />
              </div>

              {expandedId === r.id && (
                <div className="border-t border-gray-800 px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left pb-2 font-medium">Pallet ID</th>
                        <th className="text-left pb-2 font-medium">SKU</th>
                        <th className="text-left pb-2 font-medium">Description</th>
                        <th className="text-left pb-2 font-medium">Units</th>
                        <th className="text-left pb-2 font-medium">Condition</th>
                        <th className="text-left pb-2 font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {(r.pallets || r.items || []).map((pallet, i) => (
                        <tr key={i}>
                          <td className="py-2 text-blue-400 font-mono text-xs">{pallet.palletId || '—'}</td>
                          <td className="py-2 text-white font-mono text-xs">{pallet.sku}</td>
                          <td className="py-2 text-gray-300 max-w-xs truncate">{pallet.description || '—'}</td>
                          <td className="py-2 text-gray-300">{pallet.units || pallet.quantity || '—'}</td>
                          <td className="py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[pallet.condition]}`}>
                              Grade {pallet.condition}
                            </span>
                          </td>
                          <td className="py-2 text-gray-300">{pallet.location || '—'}</td>
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

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">New Inbound Receipt</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-gray-400 text-xs">Pallets</label>
                  <button onClick={addPallet} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                    <Plus size={12} /> Add pallet
                  </button>
                </div>

                {/* Column headers */}
                <div className="grid grid-cols-12 gap-2 mb-1 px-1 text-gray-500 text-xs">
                  <div className="col-span-2">Pallet ID</div>
                  <div className="col-span-2">SKU</div>
                  <div className="col-span-3">Description</div>
                  <div className="col-span-1">Units</div>
                  <div className="col-span-1">Cond.</div>
                  <div className="col-span-2">Location</div>
                  <div className="col-span-1"></div>
                </div>

                <div className="space-y-2">
                  {form.pallets.map((pallet, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-2 flex gap-1 items-center">
                        <input
                          value={pallet.palletId}
                          onChange={e => updatePallet(i, 'palletId', e.target.value)}
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500 font-mono"
                          placeholder="Auto"
                        />
                        <button onClick={() => autoGenId(i)} className="text-gray-500 hover:text-blue-400 flex-shrink-0" title="Generate ID">
                          <RefreshCw size={11} />
                        </button>
                      </div>
                      <input
                        value={pallet.sku}
                        onChange={e => updatePallet(i, 'sku', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 uppercase"
                        placeholder="SKU"
                      />
                      <input
                        value={pallet.description}
                        onChange={e => updatePallet(i, 'description', e.target.value)}
                        className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Description"
                      />
                      <input
                        type="number"
                        value={pallet.units}
                        onChange={e => updatePallet(i, 'units', e.target.value)}
                        className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="0"
                      />
                      <select
                        value={pallet.condition}
                        onChange={e => updatePallet(i, 'condition', e.target.value)}
                        className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500"
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                      </select>
                      <input
                        value={pallet.location}
                        onChange={e => updatePallet(i, 'location', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Bin"
                      />
                      <button
                        onClick={() => removePallet(i)}
                        disabled={form.pallets.length === 1}
                        className="col-span-1 text-gray-600 hover:text-red-400 disabled:opacity-20 flex items-center justify-center"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

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

            <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
              <p className="text-gray-500 text-xs">{form.pallets.filter(p => p.sku).length} pallets ready to receive</p>
              <div className="flex gap-3">
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
        </div>
      )}
    </div>
  )
}