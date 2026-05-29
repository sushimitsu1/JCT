import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, ShoppingCart, ChevronDown, CheckCircle, Clock, XCircle } from 'lucide-react'
import { sendShipmentEmail } from '../email'

const emptyItem = { sku: '', description: '', quantity: '' }
const emptyForm = {
  clientId: '', clientName: '', orderNumber: '', orderDate: '',
  shipTo: '', trackingNumber: '', notes: '', items: [{ ...emptyItem }]
}

const statusConfig = {
  pending:   { label: 'Pending',   color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock },
  picking:   { label: 'Picking',   color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       icon: ShoppingCart },
  shipped:   { label: 'Shipped',   color: 'bg-green-500/10 text-green-400 border-green-500/20',    icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/10 text-red-400 border-red-500/20',          icon: XCircle },
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [clients, setClients] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')

  const fetchData = async () => {
    const [ordersSnap, clientsSnap] = await Promise.all([
      getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'clients'))
    ])
    setOrders(ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
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
    if (!form.clientId || !form.orderDate) return
    setLoading(true)
    try {
      await addDoc(collection(db, 'orders'), {
        ...form,
        status: 'pending',
        totalUnits: form.items.reduce((sum, i) => sum + Number(i.quantity || 0), 0),
        createdAt: new Date().toISOString()
      })
      setForm(emptyForm)
      setShowModal(false)
      fetchData()
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const updateStatus = async (e, order, newStatus) => {
    e.stopPropagation()
    await updateDoc(doc(db, 'orders', order.id), { status: newStatus })
    // Send shipment email when marked as shipped
    if (newStatus === 'shipped') {
      const client = clients.find(c => c.id === order.clientId)
      if (client?.email) {
        await sendShipmentEmail(order, client.email)
      }
    }
    fetchData()
  }

  const filtered = orders.filter(o => {
    const matchesStatus = filterStatus ? o.status === filterStatus : true
    const matchesSearch = search
      ? o.clientName?.toLowerCase().includes(search.toLowerCase()) ||
        o.orderNumber?.toLowerCase().includes(search.toLowerCase())
      : true
    return matchesStatus && matchesSearch
  })

  const counts = {
    pending: orders.filter(o => o.status === 'pending').length,
    picking: orders.filter(o => o.status === 'picking').length,
    shipped: orders.filter(o => o.status === 'shipped').length,
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Orders</h2>
          <p className="text-sm text-gray-500 mt-0.5">{orders.length} total orders</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setShowModal(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Order
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Pending', value: counts.pending, color: 'text-yellow-400' },
          { label: 'Picking', value: counts.picking, color: 'text-blue-400' },
          { label: 'Shipped', value: counts.shipped, color: 'text-green-400' },
        ].map(card => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search client or order #..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 w-64"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
        >
          <option value="">All statuses</option>
          {Object.entries(statusConfig).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <ShoppingCart size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No orders found</p>
          </div>
        ) : (
          filtered.map((order) => {
            const status = statusConfig[order.status] || statusConfig.pending
            const StatusIcon = status.icon
            return (
              <div key={order.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 bg-blue-600/10 border border-blue-600/20 rounded-lg flex items-center justify-center">
                      <ShoppingCart size={16} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm">{order.clientName}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {order.orderNumber ? `#${order.orderNumber} · ` : ''}{order.orderDate} · {order.totalUnits} units
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${status.color}`}>
                      <StatusIcon size={10} />
                      {status.label}
                    </span>
                    {order.status === 'pending' && (
                      <button
                        onClick={e => updateStatus(e, order, 'picking')}
                        className="text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-2 py-1 rounded transition-colors"
                      >
                        Start Picking
                      </button>
                    )}
                    {order.status === 'picking' && (
                      <button
                        onClick={e => updateStatus(e, order, 'shipped')}
                        className="text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 px-2 py-1 rounded transition-colors"
                      >
                        Mark Shipped
                      </button>
                    )}
                    <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {expandedId === order.id && (
                  <div className="border-t border-gray-800 px-5 py-4">
                    <table className="w-full text-sm mb-3">
                      <thead>
                        <tr className="text-gray-500 text-xs">
                          <th className="text-left pb-2 font-medium">SKU</th>
                          <th className="text-left pb-2 font-medium">Description</th>
                          <th className="text-left pb-2 font-medium">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {order.items?.map((item, i) => (
                          <tr key={i}>
                            <td className="py-2 text-white font-mono text-xs">{item.sku}</td>
                            <td className="py-2 text-gray-300">{item.description}</td>
                            <td className="py-2 text-gray-300">{item.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {order.shipTo && <p className="text-gray-500 text-xs">Ship to: {order.shipTo}</p>}
                    {order.trackingNumber && <p className="text-gray-500 text-xs mt-1">Tracking: {order.trackingNumber}</p>}
                    {order.notes && <p className="text-gray-500 text-xs mt-1">Notes: {order.notes}</p>}
                    {order.status === 'picking' && (
                      <div className="mt-3 flex gap-2">
                        <input
                          placeholder="Enter tracking number..."
                          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 flex-1"
                          onKeyDown={async e => {
                            if (e.key === 'Enter' && e.target.value) {
                              await updateDoc(doc(db, 'orders', order.id), { trackingNumber: e.target.value })
                              fetchData()
                            }
                          }}
                        />
                        <span className="text-gray-500 text-xs flex items-center">press Enter to save</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">New Outbound Order</h3>
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
                  <label className="text-gray-400 text-xs mb-1 block">Order Number</label>
                  <input
                    value={form.orderNumber}
                    onChange={e => setForm({ ...form, orderNumber: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="ORD-001"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Order Date *</label>
                  <input
                    type="date"
                    value={form.orderDate}
                    onChange={e => setForm({ ...form, orderDate: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Ship To Address</label>
                <input
                  value={form.shipTo}
                  onChange={e => setForm({ ...form, shipTo: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="123 Main St, City, State ZIP"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-gray-400 text-xs">Items to Pick</label>
                  <button onClick={addItem} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                    <Plus size={12} /> Add item
                  </button>
                </div>
                <div className="space-y-2">
                  {form.items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        value={item.sku}
                        onChange={e => updateItem(i, 'sku', e.target.value)}
                        className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 uppercase"
                        placeholder="SKU"
                      />
                      <input
                        value={item.description}
                        onChange={e => updateItem(i, 'description', e.target.value)}
                        className="col-span-6 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Description"
                      />
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateItem(i, 'quantity', e.target.value)}
                        className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Qty"
                      />
                      <button
                        onClick={() => removeItem(i)}
                        disabled={form.items.length === 1}
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
                  placeholder="Special instructions..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !form.clientId || !form.orderDate}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}