import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { BarChart3, TrendingUp, Package, Users, DollarSign, ShoppingCart } from 'lucide-react'

export default function Reports() {
  const [data, setData] = useState({
    clients: [], inventory: [], orders: [], invoices: [], receipts: []
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      const [c, inv, ord, invoices, rec] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'receipts'))
      ])
      setData({
        clients: c.docs.map(d => ({ id: d.id, ...d.data() })),
        inventory: inv.docs.map(d => ({ id: d.id, ...d.data() })),
        orders: ord.docs.map(d => ({ id: d.id, ...d.data() })),
        invoices: invoices.docs.map(d => ({ id: d.id, ...d.data() })),
        receipts: rec.docs.map(d => ({ id: d.id, ...d.data() }))
      })
      setLoading(false)
    }
    fetchAll()
  }, [])

  const totalRevenue = data.invoices.reduce((sum, i) => sum + Number(i.total || 0), 0)
  const totalUnits = data.inventory.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
  const openOrders = data.orders.filter(o => o.status !== 'shipped' && o.status !== 'cancelled').length
  const shippedOrders = data.orders.filter(o => o.status === 'shipped').length

  // Inventory by client
  const inventoryByClient = data.clients.map(client => {
    const items = data.inventory.filter(i => i.clientId === client.id)
    const units = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
    const skus = items.length
    return { name: client.companyName, units, skus }
  }).sort((a, b) => b.units - a.units)

  // Revenue by client
  const revenueByClient = data.clients.map(client => {
    const clientInvoices = data.invoices.filter(i => i.clientId === client.id)
    const revenue = clientInvoices.reduce((sum, i) => sum + Number(i.total || 0), 0)
    return { name: client.companyName, revenue, invoices: clientInvoices.length }
  }).sort((a, b) => b.revenue - a.revenue)

  // Orders by status
  const ordersByStatus = [
    { label: 'Pending', count: data.orders.filter(o => o.status === 'pending').length, color: 'bg-yellow-500' },
    { label: 'Picking', count: data.orders.filter(o => o.status === 'picking').length, color: 'bg-blue-500' },
    { label: 'Shipped', count: data.orders.filter(o => o.status === 'shipped').length, color: 'bg-green-500' },
    { label: 'Cancelled', count: data.orders.filter(o => o.status === 'cancelled').length, color: 'bg-red-500' },
  ]

  // Inventory by condition
  const byCondition = ['A', 'B', 'C'].map(grade => ({
    grade,
    count: data.inventory.filter(i => i.condition === grade).reduce((sum, i) => sum + Number(i.quantity || 0), 0)
  }))

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <p className="text-gray-500 text-sm">Loading reports...</p>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Reports</h2>
        <p className="text-sm text-gray-500 mt-0.5">Overview of your warehouse operations</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total Clients', value: data.clients.length, icon: Users, color: 'text-blue-400' },
          { label: 'Total SKUs', value: data.inventory.length, icon: Package, color: 'text-purple-400' },
          { label: 'Units in Stock', value: totalUnits.toLocaleString(), icon: Package, color: 'text-green-400' },
          { label: 'Open Orders', value: openOrders, icon: ShoppingCart, color: 'text-yellow-400' },
          { label: 'Shipped Orders', value: shippedOrders, icon: TrendingUp, color: 'text-green-400' },
          { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-green-400' },
        ].map(card => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <card.icon size={16} className={`${card.color} mb-2`} />
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className="text-xl font-semibold text-white">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Inventory by client */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Inventory by Client</h3>
          {inventoryByClient.length === 0 ? (
            <p className="text-gray-500 text-sm">No inventory data</p>
          ) : (
            <div className="space-y-3">
              {inventoryByClient.map(client => {
                const pct = totalUnits > 0 ? (client.units / totalUnits) * 100 : 0
                return (
                  <div key={client.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-300 text-xs">{client.name}</span>
                      <span className="text-gray-400 text-xs">{client.units} units · {client.skus} SKUs</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Revenue by client */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Revenue by Client</h3>
          {revenueByClient.length === 0 ? (
            <p className="text-gray-500 text-sm">No invoice data</p>
          ) : (
            <div className="space-y-3">
              {revenueByClient.map(client => {
                const pct = totalRevenue > 0 ? (client.revenue / totalRevenue) * 100 : 0
                return (
                  <div key={client.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-300 text-xs">{client.name}</span>
                      <span className="text-gray-400 text-xs">${client.revenue.toLocaleString()} · {client.invoices} invoices</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Orders by status */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Orders by Status</h3>
          <div className="space-y-3">
            {ordersByStatus.map(s => {
              const pct = data.orders.length > 0 ? (s.count / data.orders.length) * 100 : 0
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-300 text-xs">{s.label}</span>
                    <span className="text-gray-400 text-xs">{s.count} orders</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${s.color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Inventory by condition */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Inventory by Condition</h3>
          <div className="space-y-3">
            {byCondition.map(c => {
              const pct = totalUnits > 0 ? (c.count / totalUnits) * 100 : 0
              const colors = { A: 'bg-green-500', B: 'bg-yellow-500', C: 'bg-red-500' }
              return (
                <div key={c.grade}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-300 text-xs">Grade {c.grade}</span>
                    <span className="text-gray-400 text-xs">{c.count} units ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${colors[c.grade]} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}