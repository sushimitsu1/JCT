import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import {
  LayoutDashboard, Package, PackagePlus, ShoppingCart,
  DollarSign, Users, BarChart3, LogOut
} from 'lucide-react'
import Clients from './Clients'
import Receiving from './Receiving'
import Inventory from './Inventory'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
  { icon: PackagePlus, label: 'Receiving', id: 'receiving' },
  { icon: Package, label: 'Inventory', id: 'inventory' },
  { icon: ShoppingCart, label: 'Orders', id: 'orders' },
  { icon: DollarSign, label: 'Billing', id: 'billing' },
  { icon: Users, label: 'Clients', id: 'clients' },
  { icon: BarChart3, label: 'Reports', id: 'reports' },
]

function DashboardHome() {
  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Clients', value: '0' },
          { label: 'Active SKUs', value: '0' },
          { label: 'Open Orders', value: '0' },
          { label: 'Monthly Revenue', value: '$0' },
        ].map((card) => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className="text-2xl font-semibold text-white">{card.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-white font-medium mb-1">Welcome to JCT WMS</h3>
        <p className="text-gray-400 text-sm">Your warehouse management system is ready. Start by adding your clients.</p>
      </div>
    </div>
  )
}

function ComingSoon({ label }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <p className="text-gray-500 text-sm">{label} — coming soon</p>
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
      case 'clients': return <Clients />
      default: return <ComingSoon label={navItems.find(n => n.id === activePage)?.label} />
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