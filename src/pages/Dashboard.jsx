import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  LayoutDashboard, Package, PackagePlus, ShoppingCart,
  DollarSign, Users, BarChart3, LogOut, KeyRound
} from 'lucide-react'
import Clients from './Clients'
import Receiving from './Receiving'
import Inventory from './Inventory'
import Billing from './Billing'
import Orders from './Orders'
import Reports from './Reports'
import ClientAccounts from './ClientAccounts'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
  { icon: PackagePlus, label: 'Receiving', id: 'receiving' },
  { icon: Package, label: 'Inventory', id: 'inventory' },
  { icon: ShoppingCart, label: 'Orders', id: 'orders' },
  { icon: DollarSign, label: 'Billing', id: 'billing' },
  { icon: Users, label: 'Clients', id: 'clients' },
  { icon: KeyRound, label: 'Client Accounts', id: 'accounts' },
  { icon: BarChart3, label: 'Reports', id: 'reports' },
]

function DashboardHome() {
  const [stats, setStats] = useState({ clients: 0, skus: 0, openOrders: 0, revenue: 0 })

  useEffect(() => {
    const fetchStats = async () => {
      const [clients, inventory, orders, invoices] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'invoices'))
      ])
      const openOrders = orders.docs.filter(d =>
        d.data().status !== 'shipped' && d.data().status !== 'cancelled'
      ).length
      const revenue = invoices.docs.reduce((sum, d) => sum + Number(d.data().total || 0), 0)
      setStats({ clients: clients.size, skus: inventory.size, openOrders, revenue })
    }
    fetchStats()
  }, [])

  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Clients', value: stats.clients },
          { label: 'Active Pallets', value: stats.skus },
          { label: 'Open Orders', value: stats.openOrders },
          { label: 'Total Revenue', value: `$${stats.revenue.toLocaleString()}` },
        ].map((card) => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className="text-2xl font-semibold text-white">{card.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-white font-medium mb-1">Welcome to JCT WMS</h3>
        <p className="text-gray-400 text-sm">Your warehouse management system is live and tracking real data.</p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [activePage, setActivePage] = useState('dashboard')
  const handleSignOut = () => signOut(auth)

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardHome />
      case 'receiving': return <Receiving />
      case 'inventory': return <Inventory />
      case 'orders': return <Orders />
      case 'billing': return <Billing />
      case 'clients': return <Clients />
      case 'accounts': return <ClientAccounts />
      case 'reports': return <Reports />
      default: return null
    }
  }

  const pageTitle = navItems.find(n => n.id === activePage)?.label

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white">JCT WMS</h1>
          <p className="text-xs text-gray-500 mt-0.5">Warehouse Management</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
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
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-6">
          <h2 className="text-sm font-medium text-gray-300">{pageTitle}</h2>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {renderPage()}
        </div>
      </div>
    </div>
  )
}