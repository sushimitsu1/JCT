import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { DollarSign, FileText, Plus, X, Download } from 'lucide-react'
import { format } from 'date-fns'
import * as XLSX from 'xlsx'

const months = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

export default function Billing() {
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [inventory, setInventory] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [selectedClient, setSelectedClient] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  const fetchData = async () => {
    const [invSnap, clientsSnap, invoicesSnap] = await Promise.all([
      getDocs(collection(db, 'inventory')),
      getDocs(collection(db, 'clients')),
      getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc')))
    ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const handleClientChange = (clientId) => {
    setSelectedClient(clientId)
    const client = clients.find(c => c.id === clientId)
    if (!client) return

    // Auto-calculate storage fees from inventory
    const clientInventory = inventory.filter(i => i.clientId === clientId)
    const totalUnits = clientInventory.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
    const pallets = Math.ceil(totalUnits / 50) // assume 50 units per pallet
    const rate = Number(client.billingRate || 25)

    const autoItems = [
      {
        description: `Storage fee — ${months[selectedMonth]} ${selectedYear}`,
        quantity: pallets,
        unit: 'pallets',
        rate: rate,
        amount: pallets * rate
      },
      {
        description: 'Handling fee — inbound',
        quantity: 1,
        unit: 'flat',
        rate: 0,
        amount: 0
      }
    ]
    setLineItems(autoItems)
  }

  const updateLineItem = (i, field, value) => {
    const items = [...lineItems]
    items[i] = { ...items[i], [field]: value }
    if (field === 'quantity' || field === 'rate') {
      items[i].amount = Number(items[i].quantity || 0) * Number(items[i].rate || 0)
    }
    if (field === 'amount') {
      items[i].amount = Number(value)
    }
    setLineItems(items)
  }

  const addLineItem = () => setLineItems([...lineItems, { description: '', quantity: 1, unit: '', rate: 0, amount: 0 }])
  const removeLineItem = (i) => setLineItems(lineItems.filter((_, idx) => idx !== i))

  const total = lineItems.reduce((sum, i) => sum + Number(i.amount || 0), 0)

  const handleSave = async () => {
    if (!selectedClient) return
    setLoading(true)
    const client = clients.find(c => c.id === selectedClient)
    try {
      await addDoc(collection(db, 'invoices'), {
        clientId: selectedClient,
        clientName: client?.companyName,
        month: selectedMonth,
        year: selectedYear,
        period: `${months[selectedMonth]} ${selectedYear}`,
        lineItems,
        total,
        status: 'pending',
        createdAt: new Date().toISOString()
      })
      setShowModal(false)
      setSelectedClient('')
      setLineItems([])
      fetchData()
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const exportToExcel = (invoice) => {
    const rows = invoice.lineItems.map(item => ({
      Description: item.description,
      Quantity: item.quantity,
      Unit: item.unit,
      'Rate ($)': item.rate,
      'Amount ($)': item.amount
    }))
    rows.push({ Description: 'TOTAL', 'Amount ($)': invoice.total })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice')
    XLSX.writeFile(wb, `Invoice_${invoice.clientName}_${invoice.period}.xlsx`)
  }

  const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
  const pendingCount = invoices.filter(i => i.status === 'pending').length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.length} invoices · {pendingCount} pending</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setSelectedClient(''); setLineItems([]) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Invoice
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Invoiced</p>
          <p className="text-2xl font-semibold text-white">${totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Pending Invoices</p>
          <p className="text-2xl font-semibold text-yellow-400">{pendingCount}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Active Clients</p>
          <p className="text-2xl font-semibold text-white">{clients.length}</p>
        </div>
      </div>

      {/* Invoices list */}
      <div className="space-y-3">
        {invoices.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <FileText size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No invoices yet — click New Invoice to generate one</p>
          </div>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
                onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 bg-green-600/10 border border-green-600/20 rounded-lg flex items-center justify-center">
                    <DollarSign size={16} className="text-green-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{inv.clientName}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{inv.period}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    inv.status === 'paid'
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                  }`}>
                    {inv.status}
                  </span>
                  <p className="text-white font-semibold text-sm">${Number(inv.total).toLocaleString()}</p>
                  <button
                    onClick={e => { e.stopPropagation(); exportToExcel(inv) }}
                    className="text-gray-400 hover:text-green-400 transition-colors p-1"
                    title="Export to Excel"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </div>

              {expandedId === inv.id && (
                <div className="border-t border-gray-800 px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left pb-2 font-medium">Description</th>
                        <th className="text-left pb-2 font-medium">Qty</th>
                        <th className="text-left pb-2 font-medium">Unit</th>
                        <th className="text-left pb-2 font-medium">Rate</th>
                        <th className="text-right pb-2 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {inv.lineItems?.map((item, i) => (
                        <tr key={i}>
                          <td className="py-2 text-gray-300">{item.description}</td>
                          <td className="py-2 text-gray-300">{item.quantity}</td>
                          <td className="py-2 text-gray-400">{item.unit}</td>
                          <td className="py-2 text-gray-400">${item.rate}</td>
                          <td className="py-2 text-white text-right">${Number(item.amount).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-700">
                        <td colSpan={4} className="pt-3 text-gray-400 text-xs font-medium">TOTAL</td>
                        <td className="pt-3 text-white font-semibold text-right">${Number(inv.total).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
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
              <h3 className="text-white font-semibold">New Invoice</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Client + Period */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3 sm:col-span-1">
                  <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                  <select
                    value={selectedClient}
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
                  <label className="text-gray-400 text-xs mb-1 block">Month</label>
                  <select
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Year</label>
                  <input
                    type="number"
                    value={selectedYear}
                    onChange={e => setSelectedYear(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Line items */}
              {lineItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-400 text-xs">Line Items</label>
                    <button onClick={addLineItem} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                      <Plus size={12} /> Add line
                    </button>
                  </div>
                  <div className="space-y-2">
                    {lineItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          value={item.description}
                          onChange={e => updateLineItem(i, 'description', e.target.value)}
                          className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Description"
                        />
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => updateLineItem(i, 'quantity', e.target.value)}
                          className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Qty"
                        />
                        <input
                          type="number"
                          value={item.rate}
                          onChange={e => updateLineItem(i, 'rate', e.target.value)}
                          className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Rate"
                        />
                        <input
                          type="number"
                          value={item.amount}
                          onChange={e => updateLineItem(i, 'amount', e.target.value)}
                          className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Amount"
                        />
                        <button onClick={() => removeLineItem(i)} className="col-span-1 text-gray-600 hover:text-red-400 flex justify-center">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end mt-3 pt-3 border-t border-gray-800">
                    <p className="text-white font-semibold text-sm">Total: ${total.toLocaleString()}</p>
                  </div>
                </div>
              )}

              {!selectedClient && (
                <p className="text-gray-500 text-sm text-center py-4">Select a client to auto-generate line items from their inventory</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading || !selectedClient || lineItems.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : 'Save Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}