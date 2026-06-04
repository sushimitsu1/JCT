import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  LayoutDashboard, Package, PackagePlus, ShoppingCart,
  DollarSign, Users, BarChart3, LogOut, KeyRound, UserCog,
  Palette, Tag, X, Plus, Menu, MapPin, ChevronLeft, ChevronRight
} from 'lucide-react'
import { useAuth, ROLE_ACCESS } from '../context/AuthContext'
import { useTheme, THEMES } from '../context/ThemeContext'
import Clients from './Clients'
import Receiving from './Receiving'
import Inventory from './Inventory'
import Billing from './Billing'
import Orders from './Orders'
import Reports from './Reports'
import ClientAccounts from './ClientAccounts'
import StaffManagement from './StaffManagement'
import Items from './Items'
import Locations from './Locations'

const allNavItems = [
  { icon: LayoutDashboard, label: 'Dashboard',      id: 'dashboard' },
  { icon: Tag,             label: 'Items / SKUs',   id: 'items'     },
  { icon: PackagePlus,     label: 'Receiving',       id: 'receiving' },
  { icon: Package,         label: 'Inventory',       id: 'inventory' },
  { icon: MapPin,          label: 'Locations',       id: 'locations' },
  { icon: ShoppingCart,    label: 'Orders',          id: 'orders'    },
  { icon: DollarSign,      label: 'Billing',         id: 'billing'   },
  { icon: Users,           label: 'Clients',         id: 'clients'   },
  { icon: KeyRound,        label: 'Client Accounts', id: 'accounts'  },
  { icon: UserCog,         label: 'Staff',           id: 'staff'     },
  { icon: BarChart3,       label: 'Reports',         id: 'reports'   },
]

function DashboardHome({ t }) {
  const [stats, setStats] = useState({ clients: 0, pallets: 0, openOrders: 0, revenue: 0 })

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
      setStats({ clients: clients.size, pallets: inventory.size, openOrders, revenue })
    }
    fetchStats()
  }, [])

  return (
    <div className="p-6">
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Clients',  value: stats.clients },
          { label: 'Active Pallets', value: stats.pallets },
          { label: 'Open Orders',    value: stats.openOrders },
          { label: 'Total Revenue',  value: `$${stats.revenue.toLocaleString()}` },
        ].map((card) => (
          <div key={card.label} style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }} className="rounded-xl p-4">
            <p style={{ color: t.textSubtle }} className="text-sm mb-1">{card.label}</p>
            <p style={{ color: t.text }} className="text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>
      <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }} className="rounded-xl p-6">
        <h3 style={{ color: t.text }} className="font-medium mb-1 text-base">Welcome to JCT WMS</h3>
        <p style={{ color: t.textSubtle }} className="text-sm">
          Your warehouse management system is live. Click any section in the sidebar to open it in a tab.
        </p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { userRole, userName } = useAuth()
  const { theme: t, themeId, switchTheme } = useTheme()
  const allowedPages = ROLE_ACCESS[userRole] || ROLE_ACCESS.admin
  const navItems = allNavItems.filter(item => allowedPages.includes(item.id))

  const [showThemePicker, setShowThemePicker] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('jct-sidebar-collapsed') === 'true')
  const toggleSidebar = () => { const v = !sidebarCollapsed; setSidebarCollapsed(v); localStorage.setItem('jct-sidebar-collapsed', String(v)) }

  // Global tab system
  const [tabs, setTabs] = useState([{ id: 'tab_dashboard', pageId: 'dashboard', label: 'Dashboard' }])
  const [activeTabId, setActiveTabId] = useState('tab_dashboard')

  const openTab = (pageId) => {
    const existing = tabs.find(t => t.pageId === pageId)
    if (existing) {
      setActiveTabId(existing.id)
      return
    }
    const navItem = allNavItems.find(n => n.id === pageId)
    const newTabId = `tab_${pageId}_${Date.now()}`
    setTabs(prev => [...prev, { id: newTabId, pageId, label: navItem?.label || pageId }])
    setActiveTabId(newTabId)
  }

  const closeTab = (e, tabId) => {
    e.stopPropagation()
    const remaining = tabs.filter(t => t.id !== tabId)
    if (remaining.length === 0) {
      const newTab = { id: 'tab_dashboard', pageId: 'dashboard', label: 'Dashboard' }
      setTabs([newTab])
      setActiveTabId('tab_dashboard')
    } else {
      setTabs(remaining)
      if (activeTabId === tabId) {
        setActiveTabId(remaining[remaining.length - 1].id)
      }
    }
  }

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activePage = activeTab?.pageId || 'dashboard'

  const renderPage = () => {
    if (!allowedPages.includes(activePage) && activePage !== 'dashboard') return (
      <div className="flex items-center justify-center h-64">
        <p style={{ color: t.textSubtle }} className="text-sm">You don't have access to this page.</p>
      </div>
    )
    switch (activePage) {
      case 'dashboard': return <DashboardHome t={t} />
      case 'items':     return <Items />
      case 'receiving': return <Receiving />
      case 'inventory': return <Inventory />
      case 'orders':    return <Orders />
      case 'billing':   return <Billing />
      case 'clients':   return <Clients />
      case 'accounts':  return <ClientAccounts />
      case 'locations': return <Locations />
      case 'staff':     return <StaffManagement />
      case 'reports':   return <Reports />
      default:          return null
    }
  }

  return (
    <div style={{ background: t.mainBg }} className="flex h-screen overflow-hidden">

      {/* -- Mobile menu overlay -- */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div
            style={{ background: t.sidebar, borderRight: `1px solid ${t.sidebarBorder}` }}
            className="w-72 flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div style={{ borderBottom: `1px solid ${t.sidebarBorder}` }} className="px-6 py-5 flex items-center justify-between">
              <div>
                <h1 style={{ color: t.logo }} className="text-lg font-bold">JCT WMS</h1>
                <p style={{ color: t.logoSub }} className="text-xs mt-0.5">{userName || 'Admin'}</p>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} style={{ color: t.sidebarText }}>
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { openTab(item.id); setMobileMenuOpen(false) }}
                  style={{
                    background: activePage === item.id ? t.sidebarActiveBg : 'transparent',
                    color: activePage === item.id ? t.sidebarActiveText : t.sidebarText,
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors text-left font-medium"
                >
                  <item.icon size={18} />
                  {item.label}
                </button>
              ))}
            </nav>
            <div style={{ borderTop: `1px solid ${t.sidebarBorder}` }} className="px-3 py-4">
              <button
                onClick={() => signOut(auth)}
                style={{ color: t.sidebarText }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
          {/* Backdrop */}
          <div className="flex-1 bg-black/50" />
        </div>
      )}
      {/* Desktop sidebar */}
      <div
        style={{ background: t.sidebar, borderRight: `1px solid ${t.sidebarBorder}`, width: sidebarCollapsed ? '56px' : '224px', transition: 'width 0.1s ease' }}
        className="desktop-sidebar flex-col flex-shrink-0 relative"
      >
        <button onClick={toggleSidebar}
          style={{ background: t.sidebar, border: `1px solid ${t.sidebarBorder}`, color: t.sidebarText }}
          className="absolute -right-3 top-7 z-20 w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 hover:scale-110 transition-transform"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {sidebarCollapsed ? <ChevronRight size={14}/> : <ChevronLeft size={14}/>}
        </button>
        <div style={{ borderBottom: `1px solid ${t.sidebarBorder}` }} className={sidebarCollapsed ? 'px-3 py-5' : 'px-6 py-5'}>
          {sidebarCollapsed ? (
            <h1 style={{ color: t.logo }} className="text-sm font-bold text-center">J</h1>
          ) : (
            <>
              <h1 style={{ color: t.logo }} className="text-lg font-bold">JCT WMS</h1>
              <p style={{ color: t.logoSub }} className="text-xs mt-0.5">{userName || 'Admin'}</p>
            </>
          )}
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => openTab(item.id)}
              title={sidebarCollapsed ? item.label : ''}
              style={{
                background: activePage === item.id ? t.sidebarActiveBg : 'transparent',
                color: activePage === item.id ? t.sidebarActiveText : t.sidebarText,
              }}
              onMouseEnter={e => { if (activePage !== item.id) e.currentTarget.style.background = t.sidebarHover }}
              onMouseLeave={e => { if (activePage !== item.id) e.currentTarget.style.background = 'transparent' }}
              className={`w-full flex items-center gap-3 ${sidebarCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-lg text-sm transition-colors text-left font-medium`}
            >
              <item.icon size={16} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <div style={{ borderTop: `1px solid ${t.sidebarBorder}` }} className="px-2 py-4">
          <button
            onClick={() => signOut(auth)}
            title={sidebarCollapsed ? 'Sign out' : ''}
            style={{ color: t.sidebarText }}
            onMouseEnter={e => { e.currentTarget.style.color = t.signOutHover }}
            onMouseLeave={e => { e.currentTarget.style.color = t.sidebarText }}
            className={`w-full flex items-center gap-3 ${sidebarCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-lg text-sm transition-colors`}
          >
            <LogOut size={16} />
            {!sidebarCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </div>

      {/* -- Main content -- */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Header */}
        <div
          style={{ background: t.header, borderBottom: `1px solid ${t.headerBorder}` }}
          className="h-12 flex items-center px-4 justify-between flex-shrink-0"
        >
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              style={{ color: t.headerText }}
              className="mobile-hamburger p-1 opacity-80 hover:opacity-100 items-center"
            >
              <Menu size={20} />
            </button>
            {/* Title — desktop */}
            <span style={{ color: t.headerText }} className="text-sm font-medium opacity-70 desktop-sidebar">
              JCT Logistics Inc.
            </span>
            {/* Active page label — mobile */}
            <span style={{ color: t.headerText }} className="text-sm font-semibold mobile-page-title">
              {activeTab?.label}
            </span>
          </div>

          {/* Theme switcher */}
          <div className="relative">
            <button
              onClick={() => setShowThemePicker(!showThemePicker)}
              style={{ color: t.headerText, opacity: 0.7 }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg hover:opacity-100 transition-opacity"
            >
              <Palette size={14} />
              <span className="hidden sm:inline">Theme</span>
            </button>
            {showThemePicker && (
              <div
                style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
                className="absolute right-0 top-10 rounded-xl shadow-lg z-50 p-2 w-44"
              >
                {Object.values(THEMES).map(th => (
                  <button
                    key={th.id}
                    onClick={() => { switchTheme(th.id); setShowThemePicker(false) }}
                    style={{
                      background: themeId === th.id ? t.sidebarActiveBg : 'transparent',
                      color: themeId === th.id ? t.sidebarActiveText : t.textMuted,
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
                  >
                    <span>{th.emoji}</span>
                    {th.label}
                    {themeId === th.id && <span className="ml-auto text-xs">?</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Global Tab Bar — horizontally scrollable */}
        <div
          style={{ background: t.sidebar, borderBottom: `1px solid ${t.sidebarBorder}` }}
          className="flex items-center overflow-x-auto flex-shrink-0 scrollbar-hide"
        >
          {tabs.map(tab => {
            const navItem = allNavItems.find(n => n.id === tab.pageId)
            const Icon = navItem?.icon
            const isActive = activeTabId === tab.id
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  borderBottom: isActive ? `2px solid ${t.btnPrimary}` : '2px solid transparent',
                  color: isActive ? t.sidebarActiveText : t.sidebarText,
                  background: isActive ? t.sidebarActiveBg : 'transparent',
                }}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs cursor-pointer whitespace-nowrap transition-all select-none flex-shrink-0"
              >
                {Icon && <Icon size={13} />}
                {/* Label hidden on very small screens */}
                <span className="tab-label font-medium max-w-28 truncate">{tab.label}</span>
                <button
                  onClick={e => closeTab(e, tab.id)}
                  className="ml-1 opacity-40 hover:opacity-100 hover:text-red-400 transition-all"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
          {/* New tab button */}
          <button
            onClick={() => openTab('dashboard')}
            style={{ color: t.sidebarText }}
            className="px-3 py-2.5 opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
            title="New tab"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Page content */}
        <div style={{ background: t.mainBg }} className="flex-1 overflow-auto">
          {renderPage()}
        </div>
      </div>
    </div>
  )
}
