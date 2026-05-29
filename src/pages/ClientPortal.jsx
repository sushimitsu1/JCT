import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { Package, ShoppingCart, FileText, LogOut, TrendingUp } from 'lucide-react'

const conditionColors = {
  A: 'bg-green-500/10 text-green-400 border-green-500/20',
  B: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  C: 'bg-red-500/10 text-red-400 border-red-500/20'
}

const statusColors = {
  available: 'bg-green-500/10 text-green-400 border-green-500/20',
  'on-hold': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  damaged: 'bg-red-500/10 text-red-400 border-red-500/20',
  shipped: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

export default function ClientPortal() {
  const { userClientId } = useAuth()
  const [activePage, setActivePage] = useState('inventory')
  const [inventory, setInventory] = useState([])
  const [orders, setOrders] = useState([])
  const [invoices, setInvoices] = useState([])
  const [clientName, setClientName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      if (!userClientId) return
      const [invSnap, ordersSnap, invoicesSnap, clientSnap] = await Promise.all([
        getDocs(query(collection(db, 'inventory'), where('clientId', '==', userClientId))),
        getDocs(query(collection(db, 'orders'), where('clientId', '==', userClientId))),
        getDocs(query(collection(db, 'invoices'), where('clientId', '==', userClientId))),
        getDocs(query(collection(db, 'clients'), where('__name__', '==', userClientId)))
      ])
      setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setOrders(ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      if (!clientSnap.empty) setClientName(clientSnap.docs[0].data().companyName)
      setLoading(false)
    }
    fetchData()
  }, [userClientId])

  const availablePallets = inventory.filter(i => (i.status || 'available') === 'available').length
  const openOrders = orders.filter(o => o.status !== 'shipped' && o.status !== 'cancelled').length
  const pendingInvoices = invoices.filter(i => i.status === 'pending').length
  const totalOwed = invoices.filter(i => i.status === 'pending').reduce((sum, i) => sum + Number(i.total || 0), 0)

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-500 text-sm">Loading your portal...</p>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white">JCT WMS</h1>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{clientName}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {[
            { icon: Package, label: 'My Inventory', id: 'inventory' },
            { icon: ShoppingCart, label: 'My Orders', id: 'orders' },
            { icon: FileText, label: 'My Invoices', id: 'invoices' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left
                ${activePage === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-gray-800">
          <button
            onClick={() => signOut(auth)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-6">
          <h2 className="text-sm font-medium text-gray-300 capitalize">
            {activePage === 'inventory' ? 'My Inventory' : activePage === 'orders' ? 'My Orders' : 'My Invoices'}
          </h2>
        </div>

        <div className="flex-1 overflow-auto p-6">

          {/* Summary cards always visible */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Available Pallets', value: availablePallets, color: 'text-green-400' },
              { label: 'Open Orders', value: openOrders, color: 'text-blue-400' },
              { label: 'Pending Invoices', value: pendingInvoices, color: 'text-yellow-400' },
              { label: 'Amount Owed', value: `$${totalOwed.toLocaleString()}`, color: 'text-white' },
            ].map(card => (
              <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Inventory tab */}
          {activePage === 'inventory' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Pallet ID</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">SKU</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Description</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Units</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Condition</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Location</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-500 text-sm">No inventory on file</td></tr>
                  ) : inventory.map((item, i) => (
                    <tr key={item.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                      <td className="px-4 py-3 text-blue-400 font-mono text-xs">{item.palletId || '—'}</td>
                      <td className="px-4 py-3 text-white font-mono text-xs">{item.sku}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs max-w-xs truncate">{item.description || '—'}</td>
                      <td className="px-4 py-3 text-gray-300">{item.units || item.quantity || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[item.condition]}`}>
                          {item.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{item.location || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[item.status || 'available']}`}>
                          {item.status || 'available'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{item.receivedDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Orders tab */}
          {activePage === 'orders' && (
            <div className="space-y-3">
              {orders.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
                  <ShoppingCart size={32} className="text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No orders on file</p>
                </div>
              ) : orders.map(order => (
                <div key={order.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium text-sm">
                        {order.orderNumber ? `Order #${order.orderNumber}` : 'Order'}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">{order.orderDate} · {order.totalUnits} units</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      order.status === 'shipped' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                      order.status === 'picking' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  {order.trackingNumber && (
                    <p className="text-gray-500 text-xs mt-2">Tracking: {order.trackingNumber}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Invoices tab */}
          {activePage === 'invoices' && (
            <div className="space-y-3">
              {invoices.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
                  <FileText size={32} className="text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No invoices on file</p>
                </div>
              ) : invoices.map(inv => (
                <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium text-sm">
                        {inv.invoiceNumber || 'Invoice'} — {inv.period}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        Issued {new Date(inv.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        inv.status === 'paid'
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                      }`}>
                        {inv.status}
                      </span>
                      <p className="text-white font-semibold">${Number(inv.total).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}