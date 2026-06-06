import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  Settings, Eye, EyeOff, ChevronUp, ChevronDown, X, RefreshCw, RotateCcw,
  PackagePlus, ShoppingCart, Package, DollarSign, Users, Clock,
  TrendingUp, AlertTriangle, Truck, Receipt
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts'

// ─── Card config ──────────────────────────────────────────────
const DEFAULT_CARDS = [
  { id: 'today-strip',         label: "Today's metrics",          visible: true,  group: 'top'      },
  { id: 'overall-kpis',        label: 'Overall KPIs',             visible: true,  group: 'top'      },
  { id: 'inbound-performance', label: 'Inbound performance',      visible: true,  group: 'columns'  },
  { id: 'outbound-performance',label: 'Outbound performance',     visible: true,  group: 'columns'  },
  { id: 'hourly-activity',     label: "Today's hourly activity",  visible: true,  group: 'wide'     },
  { id: 'throughput-7d',       label: 'Throughput (last 7 days)', visible: true,  group: 'wide'     },
  { id: 'aging-alerts',        label: 'Aging inventory alerts',   visible: true,  group: 'columns'  },
  { id: 'recent-transactions', label: 'Recent transactions',      visible: true,  group: 'columns'  },
  { id: 'top-skus',            label: 'Top SKUs (last 30 days)',  visible: false, group: 'wide'     },
  { id: 'orders-by-status',    label: 'Orders by status',         visible: false, group: 'columns'  },
]

const CONFIG_KEY = 'jct-dashboard-config-v1'

const loadConfig = () => {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CARDS.map((c, i) => ({ id: c.id, visible: c.visible, order: i }))
    const saved = JSON.parse(raw)
    // Merge with defaults to pick up any new cards we add later
    const byId = new Map(saved.map(s => [s.id, s]))
    return DEFAULT_CARDS.map((c, i) => {
      const s = byId.get(c.id)
      return s ? { id: c.id, visible: s.visible, order: s.order ?? i } : { id: c.id, visible: c.visible, order: i }
    }).sort((a, b) => a.order - b.order)
  } catch {
    return DEFAULT_CARDS.map((c, i) => ({ id: c.id, visible: c.visible, order: i }))
  }
}

const saveConfig = (cards) => {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cards)) } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
const isToday = (d) => {
  if (!d) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d }
const fmtTime = (d) => d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '-'
const fmtDate = (d) => d ? d.toLocaleDateString() : '-'

const STATUS_COLORS = { pending: '#f59e0b', picking: '#3b82f6', shipped: '#10b981', cancelled: '#ef4444' }

// ─── Main component ───────────────────────────────────────────
export default function DashboardHome() {
  const [data, setData] = useState({ clients: [], inventory: [], orders: [], invoices: [], receipts: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cards, setCards] = useState(loadConfig())
  const [showCustomize, setShowCustomize] = useState(false)

  useEffect(() => { saveConfig(cards) }, [cards])

  const fetchAll = async () => {
    setRefreshing(true)
    try {
      const [c, inv, ord, invoices, rec] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'receipts')),
      ])
      setData({
        clients:   c.docs.map(d => ({ id: d.id, ...d.data() })),
        inventory: inv.docs.map(d => ({ id: d.id, ...d.data() })),
        orders:    ord.docs.map(d => ({ id: d.id, ...d.data() })),
        invoices:  invoices.docs.map(d => ({ id: d.id, ...d.data() })),
        receipts:  rec.docs.map(d => ({ id: d.id, ...d.data() })),
      })
    } catch (e) {
      console.error('Dashboard fetch failed', e)
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  // ─── Computed metrics ─────────────────────────────────────
  const metrics = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const last7 = daysAgo(7)

    const receiptsToday = data.receipts.filter(r => isToday(toDate(r.receivedDate) || toDate(r.createdAt)))
    const receiptsClosedToday = receiptsToday.filter(r => r.status === 'confirmed' || r.status === 'complete')
    const receiptsOpen = data.receipts.filter(r => r.status === 'open' || r.status === 'pending' || !r.status)

    const ordersToday = data.orders.filter(o => isToday(toDate(o.shippedAt) || toDate(o.createdAt)))
    const ordersShippedToday = ordersToday.filter(o => o.status === 'shipped')
    const ordersPending = data.orders.filter(o => o.status !== 'shipped' && o.status !== 'cancelled')
    const ordersUnfulfilled = ordersPending.filter(o => !o.inventoryAllocations || o.inventoryAllocations.length === 0)

    const totalPallets = data.inventory.length
    const totalUnits = data.inventory.reduce((s, i) => s + Number(i.units || i.quantity || 0), 0)
    const totalRevenue = data.invoices.reduce((s, i) => s + Number(i.total || 0), 0)

    // Hourly activity for today
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`,
      receipts: 0,
      orders: 0,
    }))
    receiptsClosedToday.forEach(r => {
      const d = toDate(r.confirmedAt) || toDate(r.completedAt) || toDate(r.receivedDate) || toDate(r.createdAt)
      if (d) hours[d.getHours()].receipts += 1
    })
    ordersShippedToday.forEach(o => {
      const d = toDate(o.shippedAt) || toDate(o.createdAt)
      if (d) hours[d.getHours()].orders += 1
    })

    // Last 7 days throughput
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const rec = data.receipts.filter(r => {
        const rd = toDate(r.receivedDate) || toDate(r.createdAt)
        return rd && rd >= d && rd < next && (r.status === 'confirmed' || r.status === 'complete')
      })
      const ord = data.orders.filter(o => {
        const od = toDate(o.shippedAt) || toDate(o.createdAt)
        return od && od >= d && od < next && o.status === 'shipped'
      })
      days.push({
        label: d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' }),
        receipts: rec.length,
        orders: ord.length,
      })
    }

    // Aging alerts
    const now = new Date()
    const aging = { stale: [], near: [] }
    data.inventory.forEach(inv => {
      const d = toDate(inv.receivedDate) || toDate(inv.createdAt)
      if (!d) return
      const days = Math.floor((now - d) / (1000 * 60 * 60 * 24))
      if (days > 90) aging.stale.push({ ...inv, days })
      else if (days > 60) aging.near.push({ ...inv, days })
    })
    aging.stale.sort((a, b) => b.days - a.days)

    // Recent transactions (last 10 confirmed/shipped/invoiced)
    const recent = []
    data.receipts.filter(r => r.status === 'confirmed' || r.status === 'complete').forEach(r => {
      recent.push({
        id: 'r-' + r.id,
        type: 'receipt',
        date: toDate(r.confirmedAt) || toDate(r.receivedDate) || toDate(r.createdAt),
        ref: r.transactionId || r.id.slice(-6).toUpperCase(),
        clientName: r.clientName || '',
        amount: Number(r.totalCharges || 0),
      })
    })
    data.orders.filter(o => o.status === 'shipped').forEach(o => {
      recent.push({
        id: 'o-' + o.id,
        type: 'order',
        date: toDate(o.shippedAt) || toDate(o.createdAt),
        ref: o.orderNumber || o.id.slice(-6).toUpperCase(),
        clientName: o.clientName || '',
        amount: Number(o.totalCharges || 0),
      })
    })
    data.invoices.forEach(i => {
      recent.push({
        id: 'i-' + i.id,
        type: 'invoice',
        date: toDate(i.invoiceDate) || toDate(i.createdAt),
        ref: i.invoiceNumber || i.id.slice(-6).toUpperCase(),
        clientName: i.clientName || '',
        amount: Number(i.total || 0),
      })
    })
    recent.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))

    // Top SKUs (last 30 days)
    const last30 = daysAgo(30)
    const skuMap = new Map()
    data.orders.filter(o => {
      const od = toDate(o.shippedAt) || toDate(o.createdAt)
      return o.status === 'shipped' && od && od >= last30
    }).forEach(o => {
      ;(o.inventoryAllocations || []).forEach(a => {
        if (!a.sku) return
        if (!skuMap.has(a.sku)) skuMap.set(a.sku, { sku: a.sku, units: 0, orders: new Set() })
        const e = skuMap.get(a.sku)
        e.units += Number(a.unitsAllocated || 0)
        e.orders.add(o.id)
      })
    })
    const topSkus = Array.from(skuMap.values())
      .map(s => ({ sku: s.sku, units: s.units, orders: s.orders.size }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10)

    // Orders by status
    const ordersByStatus = ['pending', 'picking', 'shipped', 'cancelled'].map(s => ({
      name: s.charAt(0).toUpperCase() + s.slice(1),
      value: data.orders.filter(o => o.status === s).length,
      color: STATUS_COLORS[s],
    })).filter(r => r.value > 0)

    return {
      receiptsClosedToday: receiptsClosedToday.length,
      ordersShippedToday: ordersShippedToday.length,
      receiptsOpen: receiptsOpen.length,
      ordersPending: ordersPending.length,
      ordersUnfulfilled: ordersUnfulfilled.length,
      totalClients: data.clients.length,
      totalPallets,
      totalUnits,
      totalRevenue,
      totalOpenReceipts: receiptsOpen.length,
      totalReceiptsAhead: data.receipts.filter(r => {
        const d = toDate(r.arrivalDate); const now = new Date(); now.setHours(0,0,0,0)
        return d && d >= now && (r.status === 'open' || r.status === 'pending')
      }).length,
      hours,
      days,
      aging,
      recent: recent.slice(0, 10),
      topSkus,
      ordersByStatus,
    }
  }, [data])

  const isVisible = (id) => cards.find(c => c.id === id)?.visible

  const moveCard = (id, dir) => {
    setCards(prev => {
      const idx = prev.findIndex(c => c.id === id)
      if (idx === -1) return prev
      const next = [...prev]
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next.map((c, i) => ({ ...c, order: i }))
    })
  }

  const toggleCard = (id) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  const resetConfig = () => {
    setCards(DEFAULT_CARDS.map((c, i) => ({ id: c.id, visible: c.visible, order: i })))
  }

  if (loading) {
    return <div className="p-6 text-center text-gray-500 text-sm">Loading dashboard…</div>
  }

  // Render cards in user-defined order, only visible ones
  const orderedVisible = cards.filter(c => isVisible(c.id))

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} disabled={refreshing}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setShowCustomize(true)}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
            <Settings size={14} /> Customize
          </button>
        </div>
      </div>

      {/* Render cards in order */}
      {orderedVisible.map(c => {
        switch (c.id) {
          case 'today-strip':         return <TodayStrip key={c.id} m={metrics} />
          case 'overall-kpis':        return <OverallKpis key={c.id} m={metrics} />
          case 'inbound-performance': return <InboundPerformance key={c.id} m={metrics} />
          case 'outbound-performance':return <OutboundPerformance key={c.id} m={metrics} />
          case 'hourly-activity':     return <HourlyActivity key={c.id} m={metrics} />
          case 'throughput-7d':       return <Throughput7d key={c.id} m={metrics} />
          case 'aging-alerts':        return <AgingAlerts key={c.id} m={metrics} />
          case 'recent-transactions': return <RecentTransactions key={c.id} m={metrics} />
          case 'top-skus':            return <TopSkus key={c.id} m={metrics} />
          case 'orders-by-status':    return <OrdersByStatusCard key={c.id} m={metrics} />
          default: return null
        }
      })}

      {/* Customize panel */}
      {showCustomize && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowCustomize(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Customize dashboard</h3>
              <button onClick={() => setShowCustomize(false)} className="text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto p-3 space-y-1">
              {cards.map((c, i) => {
                const meta = DEFAULT_CARDS.find(d => d.id === c.id)
                return (
                  <div key={c.id} className="flex items-center gap-2 bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2">
                    <button onClick={() => toggleCard(c.id)}
                      className={`flex-shrink-0 ${c.visible ? 'text-blue-400' : 'text-gray-600'} hover:text-white`}>
                      {c.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span className={`flex-1 text-sm ${c.visible ? 'text-white' : 'text-gray-500'}`}>
                      {meta?.label || c.id}
                    </span>
                    <button onClick={() => moveCard(c.id, 'up')} disabled={i === 0}
                      className="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed">
                      <ChevronUp size={14} />
                    </button>
                    <button onClick={() => moveCard(c.id, 'down')} disabled={i === cards.length - 1}
                      className="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed">
                      <ChevronDown size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="px-4 py-3 border-t border-gray-800 flex justify-between">
              <button onClick={resetConfig}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5">
                <RotateCcw size={12} /> Reset to defaults
              </button>
              <button onClick={() => setShowCustomize(false)}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Card components ──────────────────────────────────────────
function KPI({ icon: Icon, label, value, sub, color = 'text-white', accent = 'text-blue-400' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
        <Icon size={12} className={accent} /> {label}
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function TodayStrip({ m }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KPI icon={PackagePlus}  label="Receipts closed today" value={m.receiptsClosedToday} accent="text-purple-400" />
      <KPI icon={Truck}        label="Orders shipped today"  value={m.ordersShippedToday}  accent="text-green-400" />
      <KPI icon={Clock}        label="Open receipts"         value={m.receiptsOpen}        accent="text-yellow-400" />
      <KPI icon={ShoppingCart} label="Pending orders"        value={m.ordersPending}       accent="text-blue-400" />
    </div>
  )
}

function OverallKpis({ m }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KPI icon={Users}      label="Total clients"   value={m.totalClients}                              accent="text-pink-400" />
      <KPI icon={Package}    label="Active pallets"  value={m.totalPallets}                              accent="text-cyan-400" />
      <KPI icon={TrendingUp} label="Total units"     value={m.totalUnits.toLocaleString()}               accent="text-blue-400" />
      <KPI icon={DollarSign} label="Total revenue"   value={`$${m.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} accent="text-green-400" />
    </div>
  )
}

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function InboundPerformance({ m }) {
  const data = [
    { name: 'Closed today',     value: m.receiptsClosedToday, color: '#8b5cf6' },
    { name: 'Open receipts',    value: m.totalOpenReceipts,   color: '#3b82f6' },
    { name: 'Receipts ahead',   value: m.totalReceiptsAhead,  color: '#06b6d4' },
  ]
  return (
    <Card title="Inbound performance" subtitle="Receiving snapshot">
      <div className="text-center mb-3">
        <p className="text-xs text-gray-500">Total receipts closed today</p>
        <p className="text-4xl font-bold text-purple-400">{m.receiptsClosedToday}</p>
      </div>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-400">{d.name}</span>
              <span className="text-white font-medium">{d.value}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (d.value / Math.max(...data.map(x => x.value), 1)) * 100)}%`, background: d.color }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function OutboundPerformance({ m }) {
  const data = [
    { name: 'Shipped today',    value: m.ordersShippedToday,  color: '#10b981' },
    { name: 'Pending orders',   value: m.ordersPending,       color: '#f59e0b' },
    { name: 'Unfulfilled',      value: m.ordersUnfulfilled,   color: '#ef4444' },
  ]
  return (
    <Card title="Outbound performance" subtitle="Order fulfillment snapshot">
      <div className="text-center mb-3">
        <p className="text-xs text-gray-500">Total orders closed today</p>
        <p className="text-4xl font-bold text-green-400">{m.ordersShippedToday}</p>
      </div>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-400">{d.name}</span>
              <span className="text-white font-medium">{d.value}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (d.value / Math.max(...data.map(x => x.value), 1)) * 100)}%`, background: d.color }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function HourlyActivity({ m }) {
  const hasData = m.hours.some(h => h.receipts > 0 || h.orders > 0)
  return (
    <Card title="Today's activity by hour" subtitle="Receipts confirmed and orders shipped by hour">
      {!hasData ? (
        <div className="py-8 text-center text-gray-500 text-sm">No activity yet today</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={m.hours} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#4b5563" interval={1} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#4b5563" />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
            <Bar dataKey="receipts" name="Receipts" fill="#8b5cf6" />
            <Bar dataKey="orders"   name="Orders shipped" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function Throughput7d({ m }) {
  return (
    <Card title="Throughput (last 7 days)" subtitle="Receipts confirmed and orders shipped per day">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={m.days} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#4b5563" />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#4b5563" />
          <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
          <Line type="monotone" dataKey="receipts" name="Receipts" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="orders"   name="Orders shipped" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

function AgingAlerts({ m }) {
  return (
    <Card title="Aging inventory alerts" subtitle="Pallets that need attention">
      <div className="space-y-2">
        {m.aging.stale.length === 0 && m.aging.near.length === 0 ? (
          <div className="py-6 text-center text-gray-500 text-sm">No aging concerns. All pallets under 60 days.</div>
        ) : (
          <>
            {m.aging.stale.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                <p className="text-xs text-red-400 font-medium flex items-center gap-1 mb-2">
                  <AlertTriangle size={12} /> {m.aging.stale.length} pallet{m.aging.stale.length !== 1 ? 's' : ''} over 90 days
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {m.aging.stale.slice(0, 10).map(p => (
                    <div key={p.id} className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-mono truncate">{p.palletId || p.id.slice(-6)}</span>
                      <span className="text-gray-500 truncate mx-2">{p.sku}</span>
                      <span className="text-red-400 font-medium whitespace-nowrap">{p.days}d</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {m.aging.near.length > 0 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                <p className="text-xs text-yellow-400 font-medium flex items-center gap-1">
                  <Clock size={12} /> {m.aging.near.length} pallet{m.aging.near.length !== 1 ? 's' : ''} approaching 90 days
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

const TXN_BADGES = {
  receipt: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  order:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  invoice: 'bg-green-500/10 text-green-400 border-green-500/20',
}

function RecentTransactions({ m }) {
  return (
    <Card title="Recent transactions" subtitle="Last 10 across receipts, orders, and invoices">
      {m.recent.length === 0 ? (
        <div className="py-6 text-center text-gray-500 text-sm">No recent transactions</div>
      ) : (
        <div className="space-y-1">
          {m.recent.map(t => (
            <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs border-b border-gray-800/30 last:border-0">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TXN_BADGES[t.type]} flex-shrink-0`}>
                {t.type}
              </span>
              <span className="text-white font-mono flex-shrink-0">{t.ref}</span>
              <span className="text-gray-400 flex-1 truncate">{t.clientName}</span>
              <span className="text-gray-500 whitespace-nowrap">{fmtDate(t.date)}</span>
              {t.amount > 0 && (
                <span className="text-green-400 font-medium whitespace-nowrap w-20 text-right">
                  ${t.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function TopSkus({ m }) {
  return (
    <Card title="Top SKUs (last 30 days)" subtitle="Units shipped">
      {m.topSkus.length === 0 ? (
        <div className="py-6 text-center text-gray-500 text-sm">No shipments in the last 30 days</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={m.topSkus} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
            <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#4b5563" />
            <YAxis type="category" dataKey="sku" tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#4b5563" width={80} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="units" fill="#3b82f6" name="Units shipped" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function OrdersByStatusCard({ m }) {
  return (
    <Card title="Orders by status" subtitle="Current snapshot">
      {m.ordersByStatus.length === 0 ? (
        <div className="py-6 text-center text-gray-500 text-sm">No orders</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={m.ordersByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
              {m.ordersByStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}
