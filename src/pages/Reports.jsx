import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  BarChart3, TrendingUp, Package, DollarSign, ShoppingCart, Calendar,
  Download, RefreshCw, X, LayoutDashboard, Truck, Wallet, Boxes, MapPin,
  AlertTriangle, Users, Receipt, FileText
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts'

// ─── Date helpers ─────────────────────────────────────────────
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
const receiptDate    = (r) => toDate(r.receivedDate) || toDate(r.arrivalDate) || toDate(r.createdAt)
const orderDate      = (o) => toDate(o.shippedDate) || toDate(o.shippedAt) || toDate(o.orderDate) || toDate(o.createdAt)
const invoiceDate    = (i) => toDate(i.invoiceDate) || toDate(i.createdAt)
const inventoryDate  = (i) => toDate(i.receivedDate) || toDate(i.createdAt)

const inRange = (d, from, to) => {
  if (!d) return !from && !to
  if (from && d < from) return false
  if (to   && d > to)   return false
  return true
}

const daysBetween = (a, b) => Math.floor((b - a) / (1000 * 60 * 60 * 24))

const fmtDate = (d) => d ? d.toLocaleDateString() : '—'
const dayKey = (d) => d ? d.toISOString().slice(0, 10) : null
const fmtDay = (key) => {
  if (!key) return ''
  const [, m, day] = key.split('-')
  return `${m}/${day}`
}

const dailySeries = (fromD, toD, dataPoints) => {
  if (!fromD || !toD) {
    const keys = Object.keys(dataPoints).sort()
    return keys.map(k => ({ date: k, label: fmtDay(k), ...dataPoints[k] }))
  }
  const out = []
  const d = new Date(fromD); d.setHours(0, 0, 0, 0)
  const end = new Date(toD); end.setHours(0, 0, 0, 0)
  while (d <= end) {
    const k = dayKey(d)
    out.push({ date: k, label: fmtDay(k), ...(dataPoints[k] || {}) })
    d.setDate(d.getDate() + 1)
  }
  return out
}

const presets = [
  { label: 'Today',        days: 0 },
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This year',    days: 'ytd' },
  { label: 'All time',     days: 'all' },
]

const TABS = [
  { id: 'overview',     label: 'Overview',     icon: LayoutDashboard },
  { id: 'operations',   label: 'Operations',   icon: Truck },
  { id: 'transactions', label: 'Transactions', icon: Receipt },
  { id: 'inventory',    label: 'Inventory',    icon: Boxes },
  { id: 'locations',    label: 'Locations',    icon: MapPin },
]

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']
const STATUS_COLORS = { pending: '#f59e0b', picking: '#3b82f6', shipped: '#10b981', cancelled: '#ef4444' }
const CONDITION_COLORS = { A: '#10b981', B: '#f59e0b', C: '#ef4444' }
const AGING_COLORS = { '0-30': '#10b981', '31-60': '#f59e0b', '61-90': '#fb923c', '90+': '#ef4444' }

const TXN_TYPE_COLORS = {
  receipt: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  order:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  invoice: 'bg-green-500/10 text-green-400 border-green-500/20',
}

const axisStyle = { fontSize: 11, fill: '#9ca3af' }
const gridStyle = { stroke: '#374151', strokeDasharray: '3 3' }
const tooltipStyle = {
  contentStyle: { background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e5e7eb' },
  itemStyle: { color: '#d1d5db' }
}

export default function Reports() {
  const [data, setData] = useState({ clients: [], inventory: [], orders: [], invoices: [], receipts: [], items: [], locations: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  const [stockClientFilter, setStockClientFilter] = useState('')
  const [stockSearch, setStockSearch] = useState('')

  // Transactions filters
  const [txnTypeFilter, setTxnTypeFilter] = useState('')   // '' | 'receipt' | 'order' | 'invoice'
  const [txnClientFilter, setTxnClientFilter] = useState('')
  const [txnSearch, setTxnSearch] = useState('')

  const fetchAll = async () => {
    setRefreshing(true)
    try {
      const [c, inv, ord, invoices, rec, items, locs] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'receipts')),
        getDocs(collection(db, 'items')),
        getDocs(collection(db, 'locations')),
      ])
      setData({
        clients:   c.docs.map(d => ({ id: d.id, ...d.data() })),
        inventory: inv.docs.map(d => ({ id: d.id, ...d.data() })),
        orders:    ord.docs.map(d => ({ id: d.id, ...d.data() })),
        invoices:  invoices.docs.map(d => ({ id: d.id, ...d.data() })),
        receipts:  rec.docs.map(d => ({ id: d.id, ...d.data() })),
        items:     items.docs.map(d => ({ id: d.id, ...d.data() })),
        locations: locs.docs.map(d => ({ id: d.id, ...d.data() })),
      })
    } catch (e) {
      console.error('Failed to load reports', e)
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const fromD = useMemo(() => {
    if (!dateFrom) return null
    const d = new Date(dateFrom + 'T00:00:00')
    return isNaN(d.getTime()) ? null : d
  }, [dateFrom])
  const toD = useMemo(() => {
    if (!dateTo) return null
    const d = new Date(dateTo + 'T23:59:59')
    return isNaN(d.getTime()) ? null : d
  }, [dateTo])

  const applyPreset = (preset) => {
    const now = new Date()
    if (preset.days === 'all') { setDateFrom(''); setDateTo(''); return }
    if (preset.days === 'ytd') {
      setDateFrom(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10))
      setDateTo(now.toISOString().slice(0, 10)); return
    }
    const from = new Date()
    from.setDate(from.getDate() - preset.days)
    setDateFrom(from.toISOString().slice(0, 10))
    setDateTo(now.toISOString().slice(0, 10))
  }

  const filteredReceipts = useMemo(() => data.receipts.filter(r => inRange(receiptDate(r), fromD, toD)), [data.receipts, fromD, toD])
  const filteredOrders   = useMemo(() => data.orders.filter(o => inRange(orderDate(o), fromD, toD)), [data.orders, fromD, toD])
  const filteredInvoices = useMemo(() => data.invoices.filter(i => inRange(invoiceDate(i), fromD, toD)), [data.invoices, fromD, toD])

  const clientName = (id) => data.clients.find(c => c.id === id)?.companyName || id || '—'

  const totalRevenue  = filteredInvoices.reduce((s, i) => s + Number(i.total || 0), 0)
  const totalUnits    = data.inventory.reduce((s, i) => s + Number(i.units || i.quantity || 0), 0)
  const totalPallets  = data.inventory.length
  const openOrders    = filteredOrders.filter(o => o.status !== 'shipped' && o.status !== 'cancelled').length
  const shippedOrders = filteredOrders.filter(o => o.status === 'shipped').length
  const totalReceived = filteredReceipts.length

  const inventoryByClient = useMemo(() => data.clients.map(c => {
    const items = data.inventory.filter(i => i.clientId === c.id)
    return {
      name: c.companyName || c.id,
      units: items.reduce((s, i) => s + Number(i.units || i.quantity || 0), 0),
      pallets: items.length,
    }
  }).filter(r => r.pallets > 0).sort((a, b) => b.units - a.units), [data.clients, data.inventory])

  const ordersByStatus = useMemo(() => ['pending', 'picking', 'shipped', 'cancelled'].map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1),
    value: filteredOrders.filter(o => o.status === s).length,
    color: STATUS_COLORS[s],
  })).filter(r => r.value > 0), [filteredOrders])

  const byCondition = useMemo(() => ['A', 'B', 'C'].map(grade => ({
    name: `Grade ${grade}`,
    value: data.inventory.filter(i => i.condition === grade).reduce((s, i) => s + Number(i.units || i.quantity || 0), 0),
    color: CONDITION_COLORS[grade],
  })).filter(r => r.value > 0), [data.inventory])

  const throughput = useMemo(() => {
    const points = {}
    filteredReceipts.forEach(r => {
      const k = dayKey(receiptDate(r))
      if (!k) return
      if (!points[k]) points[k] = { receipts: 0, shipments: 0 }
      points[k].receipts += 1
    })
    filteredOrders.filter(o => o.status === 'shipped').forEach(o => {
      const k = dayKey(orderDate(o))
      if (!k) return
      if (!points[k]) points[k] = { receipts: 0, shipments: 0 }
      points[k].shipments += 1
    })
    return dailySeries(fromD, toD, points).map(d => ({ ...d, receipts: d.receipts || 0, shipments: d.shipments || 0 }))
  }, [filteredReceipts, filteredOrders, fromD, toD])

  const revenueTrend = useMemo(() => {
    const points = {}
    filteredInvoices.forEach(i => {
      const k = dayKey(invoiceDate(i))
      if (!k) return
      if (!points[k]) points[k] = { revenue: 0 }
      points[k].revenue += Number(i.total || 0)
    })
    return dailySeries(fromD, toD, points).map(d => ({ ...d, revenue: d.revenue || 0 }))
  }, [filteredInvoices, fromD, toD])

  const inventoryByLocation = useMemo(() => {
    const map = new Map()
    data.inventory.forEach(i => {
      const loc = i.location || '(unassigned)'
      if (!map.has(loc)) map.set(loc, { name: loc, pallets: 0, units: 0 })
      const e = map.get(loc)
      e.pallets += 1
      e.units += Number(i.units || i.quantity || 0)
    })
    return Array.from(map.values()).sort((a, b) => b.pallets - a.pallets)
  }, [data.inventory])

  // ═══════════════════════════════════════════════════════════════
  //  TRANSACTIONS (NEW)
  // ═══════════════════════════════════════════════════════════════
  // Canonical transactions only: confirmed/complete receipts, shipped orders, saved invoices

  const transactions = useMemo(() => {
    const rows = []

    // Receipts — confirmed or complete only
    filteredReceipts
      .filter(r => r.status === 'confirmed' || r.status === 'complete')
      .forEach(r => {
        // Count pallets + units from inventory side (more accurate), fallback to lineItems
        const lineItemUnits = (r.lineItems || []).reduce((s, li) =>
          s + (li.pallets || []).reduce((ss, p) => ss + Number(p.units || 0), 0), 0)
        const lineItemPallets = (r.lineItems || []).reduce((s, li) =>
          s + ((li.pallets || []).length || 0), 0)
        rows.push({
          id: 'receipt-' + r.id,
          type: 'receipt',
          typeLabel: 'Receipt',
          date: receiptDate(r),
          refNumber: r.transactionId || r.referenceId || r.id.slice(-6).toUpperCase(),
          clientId: r.clientId,
          clientName: r.clientName || clientName(r.clientId),
          units: lineItemUnits || Number(r.totalUnits || 0),
          pallets: lineItemPallets || Number(r.totalPallets || 0),
          amount: Number(r.totalCharges || 0),
          status: r.status,
          sourceId: r.id,
          source: r,
        })
      })

    // Orders — shipped only
    filteredOrders
      .filter(o => o.status === 'shipped')
      .forEach(o => {
        const allocUnits = (o.inventoryAllocations || []).reduce((s, a) => s + Number(a.unitsAllocated || 0), 0)
        const allocPallets = (o.inventoryAllocations || []).length
        rows.push({
          id: 'order-' + o.id,
          type: 'order',
          typeLabel: 'Order',
          date: orderDate(o),
          refNumber: o.orderNumber || o.transactionId || o.id.slice(-6).toUpperCase(),
          clientId: o.clientId,
          clientName: o.clientName || clientName(o.clientId),
          units: allocUnits,
          pallets: allocPallets,
          amount: Number(o.totalCharges || 0),
          status: o.status,
          picker: o.pickedByName || o.shippedByName || '',
          sourceId: o.id,
          source: o,
        })
      })

    // Invoices — all saved invoices in range
    filteredInvoices.forEach(i => {
      rows.push({
        id: 'invoice-' + i.id,
        type: 'invoice',
        typeLabel: 'Invoice',
        date: invoiceDate(i),
        refNumber: i.invoiceNumber || i.id.slice(-6).toUpperCase(),
        clientId: i.clientId,
        clientName: i.clientName || clientName(i.clientId),
        units: 0,
        pallets: 0,
        amount: Number(i.total || 0),
        status: i.status || 'pending',
        period: i.period || '',
        sourceId: i.id,
        source: i,
      })
    })

    return rows.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
  }, [filteredReceipts, filteredOrders, filteredInvoices, data.clients])

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (txnTypeFilter && t.type !== txnTypeFilter) return false
      if (txnClientFilter && t.clientId !== txnClientFilter) return false
      if (txnSearch) {
        const s = txnSearch.toLowerCase()
        const hay = [t.refNumber, t.clientName, t.picker, t.period].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [transactions, txnTypeFilter, txnClientFilter, txnSearch])

  const txnCounts = useMemo(() => ({
    receipt: transactions.filter(t => t.type === 'receipt').length,
    order:   transactions.filter(t => t.type === 'order').length,
    invoice: transactions.filter(t => t.type === 'invoice').length,
  }), [transactions])

  const txnTotalAmount = filteredTransactions.reduce((s, t) => s + (t.amount || 0), 0)
  const txnTotalUnits  = filteredTransactions.reduce((s, t) => s + (t.units || 0), 0)

  // ─── Item stock + aging + velocity (unchanged) ───
  const itemStock = useMemo(() => {
    const map = new Map()
    data.inventory.forEach(inv => {
      const key = `${inv.clientId || ''}__${inv.sku || ''}`
      if (!map.has(key)) {
        const catalog = data.items.find(it => it.clientId === inv.clientId && it.sku === inv.sku)
        map.set(key, {
          clientId: inv.clientId,
          clientName: inv.clientName || clientName(inv.clientId),
          sku: inv.sku,
          description: catalog?.description || inv.description || '',
          unitsPerPallet: Number(catalog?.unitsPerPallet || 0),
          units: 0, pallets: 0, locations: new Set(),
          available: 0, allocated: 0, onHold: 0,
        })
      }
      const e = map.get(key)
      const u = Number(inv.units || inv.quantity || 0)
      e.units += u; e.pallets += 1
      if (inv.location) e.locations.add(inv.location)
      const status = inv.status || 'available'
      if (status === 'available') e.available += u
      else if (status === 'allocated') e.allocated += u
      else if (status === 'on-hold') e.onHold += u
    })
    return Array.from(map.values()).map(r => ({ ...r, locationCount: r.locations.size, locations: undefined }))
      .sort((a, b) => b.units - a.units)
  }, [data.inventory, data.items, data.clients])

  const filteredItemStock = useMemo(() => itemStock.filter(r => {
    if (stockClientFilter && r.clientId !== stockClientFilter) return false
    if (stockSearch) {
      const s = stockSearch.toLowerCase()
      const hay = [r.sku, r.description, r.clientName].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  }), [itemStock, stockClientFilter, stockSearch])

  const aging = useMemo(() => {
    const now = new Date()
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    const palletDetails = []
    data.inventory.forEach(inv => {
      const d = inventoryDate(inv)
      const days = d ? daysBetween(d, now) : null
      let bucket
      if (days === null) bucket = '0-30'
      else if (days <= 30) bucket = '0-30'
      else if (days <= 60) bucket = '31-60'
      else if (days <= 90) bucket = '61-90'
      else bucket = '90+'
      buckets[bucket] += 1
      palletDetails.push({
        palletId: inv.palletId || inv.id, sku: inv.sku || '',
        clientName: inv.clientName || clientName(inv.clientId),
        units: Number(inv.units || inv.quantity || 0),
        location: inv.location || '', receivedDate: d, days: days ?? 0, bucket,
      })
    })
    const series = Object.entries(buckets).map(([name, value]) => ({ name, value, color: AGING_COLORS[name] }))
    return { series, palletDetails: palletDetails.sort((a, b) => b.days - a.days) }
  }, [data.inventory, data.clients])

  const stalePallets = useMemo(() => aging.palletDetails.filter(p => p.bucket === '90+'), [aging])

  const topSkus = useMemo(() => {
    const map = new Map()
    filteredOrders.filter(o => o.status === 'shipped').forEach(o => {
      (o.inventoryAllocations || []).forEach(a => {
        const sku = a.sku
        if (!sku) return
        if (!map.has(sku)) {
          const catalog = data.items.find(it => it.sku === sku)
          map.set(sku, { sku, description: catalog?.description || '', unitsShipped: 0, ordersShipped: new Set(), palletsShipped: new Set() })
        }
        const e = map.get(sku)
        e.unitsShipped += Number(a.unitsAllocated || 0)
        e.ordersShipped.add(o.id)
        if (a.palletId) e.palletsShipped.add(a.palletId)
      })
    })
    return Array.from(map.values()).map(r => ({
      sku: r.sku, description: r.description,
      unitsShipped: r.unitsShipped, orderCount: r.ordersShipped.size, palletCount: r.palletsShipped.size,
    })).sort((a, b) => b.unitsShipped - a.unitsShipped)
  }, [filteredOrders, data.items])

  const pickerProductivity = useMemo(() => {
    const map = new Map()
    filteredOrders.filter(o => o.status === 'shipped' && (o.pickedByName || o.pickedBy)).forEach(o => {
      const key = o.pickedByName || o.pickedBy
      if (!map.has(key)) map.set(key, { name: key, ordersPicked: 0, unitsPicked: 0, palletsPicked: 0 })
      const e = map.get(key)
      e.ordersPicked += 1
      const allocs = o.inventoryAllocations || []
      e.unitsPicked += allocs.reduce((s, a) => s + Number(a.unitsAllocated || 0), 0)
      e.palletsPicked += new Set(allocs.map(a => a.palletId).filter(Boolean)).size
    })
    return Array.from(map.values()).sort((a, b) => b.unitsPicked - a.unitsPicked)
  }, [filteredOrders])

  const storageUtilization = useMemo(() => {
    const palletCountByLoc = new Map()
    data.inventory.forEach(inv => {
      if (!inv.location) return
      palletCountByLoc.set(inv.location, (palletCountByLoc.get(inv.location) || 0) + 1)
    })
    const rows = data.locations.map(loc => {
      const used = palletCountByLoc.get(loc.label) || 0
      const cap = Number(loc.capacity || 0)
      const utilization = cap > 0 ? Math.round((used / cap) * 100) : null
      return {
        label: loc.label || loc.id, capacity: cap, used,
        free: cap > 0 ? Math.max(0, cap - used) : 0,
        utilization, type: loc.type || 'floor', active: loc.active !== false,
      }
    }).filter(r => r.active)
    const withCap = rows.filter(r => r.capacity > 0)
    const total = withCap.length
    const summary = {
      total,
      avgUtil: total ? Math.round(withCap.reduce((s, r) => s + r.utilization, 0) / total) : 0,
      over: withCap.filter(r => r.utilization > 100).length,
      full: withCap.filter(r => r.utilization >= 80 && r.utilization <= 100).length,
      half: withCap.filter(r => r.utilization >= 30 && r.utilization < 80).length,
      empty: withCap.filter(r => r.utilization < 30).length,
      noCapacity: rows.length - total,
    }
    return { rows: rows.sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1)), summary }
  }, [data.inventory, data.locations])

  // ─── Excel exports ────────────────────────────────────────────
  const exportSheet = (rows, sheetName, fileName) => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName)
    XLSX.writeFile(wb, fileName)
  }

  const exportTransactions = () => {
    const rows = [['Type', 'Date', 'Reference #', 'Client', 'Pallets', 'Units', 'Amount ($)', 'Status', 'Notes']]
    filteredTransactions.forEach(t => rows.push([
      t.typeLabel, fmtDate(t.date), t.refNumber, t.clientName,
      t.pallets || '', t.units || '', t.amount || 0, t.status || '',
      t.picker ? `Picker: ${t.picker}` : (t.period || '')
    ]))
    exportSheet(rows, 'Transactions', `JCT-Transactions-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const exportAll = () => {
    const wb = XLSX.utils.book_new()
    const rangeLabel = (fromD && toD) ? `${dateFrom} to ${dateTo}` : 'All time'

    const summary = [
      ['JCT Logistics — Reports'], ['Range', rangeLabel], ['Generated', new Date().toLocaleString()], [],
      ['Metric', 'Value'],
      ['Total revenue (range)', totalRevenue],
      ['Total invoices (range)', filteredInvoices.length],
      ['Orders shipped (range)', shippedOrders],
      ['Open orders (range)', openOrders],
      ['Receipts (range)', totalReceived],
      ['Current pallets', totalPallets],
      ['Current units', totalUnits],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')

    const txnSheet = [['Type', 'Date', 'Reference #', 'Client', 'Pallets', 'Units', 'Amount ($)', 'Status', 'Notes']]
    transactions.forEach(t => txnSheet.push([
      t.typeLabel, fmtDate(t.date), t.refNumber, t.clientName,
      t.pallets || '', t.units || '', t.amount || 0, t.status || '',
      t.picker ? `Picker: ${t.picker}` : (t.period || '')
    ]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txnSheet), 'Transactions')

    const stockSheet = [['Client', 'SKU', 'Description', 'Units', 'Pallets', 'Available', 'Allocated', 'On-hold', 'Locations']]
    itemStock.forEach(r => stockSheet.push([r.clientName, r.sku, r.description, r.units, r.pallets, r.available, r.allocated, r.onHold, r.locationCount]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stockSheet), 'Item Stock')

    const agingSheet = [['Pallet ID', 'SKU', 'Client', 'Units', 'Location', 'Received', 'Days in WH', 'Bucket']]
    aging.palletDetails.forEach(p => agingSheet.push([p.palletId, p.sku, p.clientName, p.units, p.location, fmtDate(p.receivedDate), p.days, p.bucket]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agingSheet), 'Aging')

    const velocitySheet = [['SKU', 'Description', 'Units Shipped', 'Orders', 'Pallets']]
    topSkus.forEach(r => velocitySheet.push([r.sku, r.description, r.unitsShipped, r.orderCount, r.palletCount]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(velocitySheet), 'Top SKUs')

    const pickerSheet = [['Picker', 'Orders', 'Units', 'Pallets']]
    pickerProductivity.forEach(r => pickerSheet.push([r.name, r.ordersPicked, r.unitsPicked, r.palletsPicked]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pickerSheet), 'Picker Productivity')

    const utilSheet = [['Location', 'Capacity', 'Used', 'Free', 'Utilization %', 'Type']]
    storageUtilization.rows.forEach(r => utilSheet.push([r.label, r.capacity, r.used, r.free, r.utilization ?? '', r.type]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(utilSheet), 'Storage Utilization')

    const invSheet = [['Client', 'Pallets', 'Units']]
    inventoryByClient.forEach(r => invSheet.push([r.name, r.pallets, r.units]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invSheet), 'Inventory by Client')

    XLSX.writeFile(wb, `JCT-Reports-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <p className="text-gray-500 text-sm">Loading reports...</p>
    </div>
  )

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <BarChart3 className="text-blue-400" size={22} /> Reports
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {(!fromD && !toD) ? 'All time' : `${dateFrom || '—'} to ${dateTo || '—'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} disabled={refreshing}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportAll}
            className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
            <Download size={14} /> Export all (Excel)
          </button>
        </div>
      </div>

      {/* Date range */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar size={14} className="text-gray-400" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-2 py-1.5" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-2 py-1.5" />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded flex items-center gap-1">
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {presets.map(p => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-2 py-1 rounded">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon
          const active = activeTab === t.id
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active ? 'border-red-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
              }`}>
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPI icon={DollarSign}   label="Revenue (range)" value={`$${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} color="text-green-400" />
            <KPI icon={ShoppingCart} label="Shipped (range)" value={shippedOrders}      color="text-blue-400" />
            <KPI icon={ShoppingCart} label="Open orders"     value={openOrders}         color="text-yellow-400" />
            <KPI icon={Package}      label="Receipts"        value={totalReceived}      color="text-purple-400" />
            <KPI icon={Package}      label="Current pallets" value={totalPallets}       color="text-cyan-400" />
            <KPI icon={TrendingUp}   label="Current units"   value={totalUnits.toLocaleString()} color="text-pink-400" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="Receipts vs shipments" subtitle="Daily activity in range" wide>
              <ChartLine data={throughput}
                lines={[{ key: 'receipts', name: 'Receipts', color: '#8b5cf6' }, { key: 'shipments', name: 'Shipments', color: '#10b981' }]}
                empty={!throughput.some(d => d.receipts || d.shipments) && 'No activity in range'} />
            </Card>
            <Card title="Orders by status" subtitle="In range">
              <ChartPie data={ordersByStatus} empty={ordersByStatus.length === 0 && 'No orders in range'} />
            </Card>
          </div>
        </div>
      )}

      {/* OPERATIONS */}
      {activeTab === 'operations' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI icon={Package}      label="Receipts (range)" value={totalReceived}  color="text-purple-400" />
            <KPI icon={ShoppingCart} label="Shipped (range)"  value={shippedOrders}  color="text-green-400" />
            <KPI icon={ShoppingCart} label="Open orders"      value={openOrders}     color="text-yellow-400" />
            <KPI icon={TrendingUp}   label="Net flow"         value={totalReceived - shippedOrders} color="text-blue-400" />
          </div>
          <Card title="Throughput — receipts vs shipments" subtitle="Daily volume in range"
            onExport={() => exportSheet([['Date', 'Receipts', 'Shipments'], ...throughput.map(r => [r.date, r.receipts, r.shipments])], 'Throughput', 'JCT-Throughput.xlsx')}>
            <ChartLine data={throughput} height={300}
              lines={[{ key: 'receipts', name: 'Receipts', color: '#8b5cf6' }, { key: 'shipments', name: 'Shipments', color: '#10b981' }]}
              empty={!throughput.some(d => d.receipts || d.shipments) && 'No activity in range'} />
          </Card>
          <Card title="Top SKUs by velocity" subtitle="Units shipped in range"
            onExport={() => exportSheet(
              [['SKU', 'Description', 'Units Shipped', 'Orders', 'Pallets'], ...topSkus.map(r => [r.sku, r.description, r.unitsShipped, r.orderCount, r.palletCount])],
              'Top SKUs', 'JCT-Top-SKUs.xlsx'
            )}>
            {topSkus.length === 0 ? (
              <Placeholder icon={Truck} label="No shipped orders in range" />
            ) : (
              <>
                <ChartBar data={topSkus.slice(0, 15)} xKey="sku"
                  bars={[{ key: 'unitsShipped', name: 'Units shipped', color: '#3b82f6' }]} />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-400 uppercase">
                      <tr>
                        <th className="px-2 py-1.5 text-left">SKU</th>
                        <th className="px-2 py-1.5 text-left">Description</th>
                        <th className="px-2 py-1.5 text-right">Units</th>
                        <th className="px-2 py-1.5 text-right">Orders</th>
                        <th className="px-2 py-1.5 text-right">Pallets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSkus.slice(0, 25).map(r => (
                        <tr key={r.sku} className="border-t border-gray-800">
                          <td className="px-2 py-1.5 font-mono text-white">{r.sku}</td>
                          <td className="px-2 py-1.5 text-gray-400 truncate max-w-xs">{r.description}</td>
                          <td className="px-2 py-1.5 text-right text-white font-medium">{r.unitsShipped.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right text-gray-300">{r.orderCount}</td>
                          <td className="px-2 py-1.5 text-right text-gray-300">{r.palletCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {topSkus.length > 25 && <p className="text-xs text-gray-500 mt-2">+{topSkus.length - 25} more — use Export</p>}
                </div>
              </>
            )}
          </Card>
          <Card title="Picker productivity" subtitle="Orders shipped in range, grouped by picker"
            onExport={() => exportSheet(
              [['Picker', 'Orders', 'Units', 'Pallets'], ...pickerProductivity.map(r => [r.name, r.ordersPicked, r.unitsPicked, r.palletsPicked])],
              'Pickers', 'JCT-Picker-productivity.xlsx'
            )}>
            {pickerProductivity.length === 0 ? (
              <Placeholder icon={Users} label="No shipped orders with picker info in range." />
            ) : (
              <>
                <ChartBar data={pickerProductivity} xKey="name"
                  bars={[{ key: 'unitsPicked', name: 'Units', color: '#10b981' }, { key: 'ordersPicked', name: 'Orders', color: '#3b82f6' }]} />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-400 uppercase">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Picker</th>
                        <th className="px-2 py-1.5 text-right">Orders</th>
                        <th className="px-2 py-1.5 text-right">Units</th>
                        <th className="px-2 py-1.5 text-right">Pallets</th>
                        <th className="px-2 py-1.5 text-right">Avg units/order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickerProductivity.map(r => (
                        <tr key={r.name} className="border-t border-gray-800">
                          <td className="px-2 py-1.5 text-white">{r.name}</td>
                          <td className="px-2 py-1.5 text-right text-gray-300">{r.ordersPicked}</td>
                          <td className="px-2 py-1.5 text-right text-white font-medium">{r.unitsPicked.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right text-gray-300">{r.palletsPicked}</td>
                          <td className="px-2 py-1.5 text-right text-gray-400">{(r.unitsPicked / r.ordersPicked).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Financial KPIs (kept from old Financial tab) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI icon={DollarSign} label="Revenue (range)" value={`$${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} color="text-green-400" />
            <KPI icon={Receipt}    label="Total transactions" value={transactions.length} color="text-blue-400" />
            <KPI icon={DollarSign} label="Filtered amount"
              value={`$${txnTotalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              color="text-cyan-400" />
            <KPI icon={TrendingUp} label="Filtered units" value={txnTotalUnits.toLocaleString()} color="text-pink-400" />
          </div>

          {/* Revenue trend */}
          <Card title="Revenue trend" subtitle="Daily revenue from invoices in range"
            onExport={() => exportSheet([['Date', 'Revenue'], ...revenueTrend.map(r => [r.date, r.revenue])], 'Revenue', 'JCT-Revenue-trend.xlsx')}>
            <ChartLine data={revenueTrend} height={220}
              lines={[{ key: 'revenue', name: 'Revenue', color: '#10b981' }]}
              yFormat={v => `$${v.toLocaleString()}`}
              empty={!revenueTrend.some(d => d.revenue) && 'No invoices in range'} />
          </Card>

          {/* Transactions table */}
          <Card title="All transactions" subtitle="Confirmed receipts, shipped orders, and saved invoices" onExport={exportTransactions}>
            {/* Filters */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="flex gap-1">
                {[
                  { id: '',         label: `All (${transactions.length})` },
                  { id: 'receipt',  label: `Receipts (${txnCounts.receipt})` },
                  { id: 'order',    label: `Orders (${txnCounts.order})` },
                  { id: 'invoice',  label: `Invoices (${txnCounts.invoice})` },
                ].map(f => (
                  <button key={f.id} onClick={() => setTxnTypeFilter(f.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      txnTypeFilter === f.id
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                    }`}>{f.label}</button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search ref #, client, picker..."
                value={txnSearch}
                onChange={(e) => setTxnSearch(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5 flex-1 min-w-[200px]"
              />
              <select
                value={txnClientFilter}
                onChange={(e) => setTxnClientFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5"
              >
                <option value="">All clients</option>
                {data.clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
              <span className="text-xs text-gray-500">{filteredTransactions.length} of {transactions.length}</span>
            </div>

            {filteredTransactions.length === 0 ? (
              <Placeholder icon={Receipt} label="No transactions match these filters" />
            ) : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-400 uppercase sticky top-0 bg-gray-900">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Type</th>
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Reference</th>
                      <th className="px-2 py-1.5 text-left">Client</th>
                      <th className="px-2 py-1.5 text-right">Pallets</th>
                      <th className="px-2 py-1.5 text-right">Units</th>
                      <th className="px-2 py-1.5 text-right">Amount</th>
                      <th className="px-2 py-1.5 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.slice(0, 500).map(t => (
                      <tr key={t.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                        <td className="px-2 py-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TXN_TYPE_COLORS[t.type]}`}>
                            {t.typeLabel}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{fmtDate(t.date)}</td>
                        <td className="px-2 py-1.5 font-mono text-white">{t.refNumber}</td>
                        <td className="px-2 py-1.5 text-gray-300 truncate max-w-[180px]">{t.clientName}</td>
                        <td className="px-2 py-1.5 text-right text-gray-300">{t.pallets || ''}</td>
                        <td className="px-2 py-1.5 text-right text-white font-medium">{t.units ? t.units.toLocaleString() : ''}</td>
                        <td className="px-2 py-1.5 text-right text-green-400 whitespace-nowrap">{t.amount ? `$${t.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}</td>
                        <td className="px-2 py-1.5 text-gray-500 truncate max-w-[180px]">
                          {t.picker ? `Picker: ${t.picker}` : (t.period || t.status || '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredTransactions.length > 500 && (
                  <p className="text-xs text-gray-500 mt-2 px-2">+{filteredTransactions.length - 500} more — use Export</p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI icon={Package}    label="Current pallets" value={totalPallets}                color="text-cyan-400" />
            <KPI icon={TrendingUp} label="Current units"   value={totalUnits.toLocaleString()} color="text-pink-400" />
            <KPI icon={Boxes}      label="Unique SKUs"     value={itemStock.length}            color="text-blue-400" />
            <KPI icon={AlertTriangle} label="Pallets > 90 days" value={stalePallets.length}    color="text-red-400" />
          </div>
          <Card title="Item stock report" subtitle="Current inventory grouped by SKU"
            onExport={() => exportSheet(
              [['Client', 'SKU', 'Description', 'Units', 'Pallets', 'Available', 'Allocated', 'On-hold', 'Locations'],
                ...filteredItemStock.map(r => [r.clientName, r.sku, r.description, r.units, r.pallets, r.available, r.allocated, r.onHold, r.locationCount])],
              'Item Stock', 'JCT-Item-Stock.xlsx'
            )}>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <input type="text" placeholder="Search SKU, description, client..." value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5 flex-1 min-w-[200px]" />
              <select value={stockClientFilter} onChange={(e) => setStockClientFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5">
                <option value="">All clients</option>
                {data.clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
              <span className="text-xs text-gray-500">{filteredItemStock.length} of {itemStock.length} SKUs</span>
            </div>
            {filteredItemStock.length === 0 ? (
              <Placeholder icon={Boxes} label="No items match your filters" />
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-400 uppercase sticky top-0 bg-gray-900">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Client</th>
                      <th className="px-2 py-1.5 text-left">SKU</th>
                      <th className="px-2 py-1.5 text-left">Description</th>
                      <th className="px-2 py-1.5 text-right">Units</th>
                      <th className="px-2 py-1.5 text-right">Pallets</th>
                      <th className="px-2 py-1.5 text-right">Available</th>
                      <th className="px-2 py-1.5 text-right">Allocated</th>
                      <th className="px-2 py-1.5 text-right">On hold</th>
                      <th className="px-2 py-1.5 text-right">Locs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItemStock.slice(0, 200).map(r => (
                      <tr key={`${r.clientId}_${r.sku}`} className="border-t border-gray-800 hover:bg-gray-800/40">
                        <td className="px-2 py-1.5 text-gray-300 truncate max-w-[150px]">{r.clientName}</td>
                        <td className="px-2 py-1.5 font-mono text-white">{r.sku}</td>
                        <td className="px-2 py-1.5 text-gray-400 truncate max-w-[200px]">{r.description}</td>
                        <td className="px-2 py-1.5 text-right text-white font-medium">{r.units.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right text-gray-300">{r.pallets}</td>
                        <td className="px-2 py-1.5 text-right text-green-400">{r.available.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right text-blue-400">{r.allocated.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right text-yellow-400">{r.onHold.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right text-gray-300">{r.locationCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredItemStock.length > 200 && <p className="text-xs text-gray-500 mt-2 px-2">+{filteredItemStock.length - 200} more — use Export</p>}
              </div>
            )}
          </Card>
          <Card title="Aging inventory" subtitle="Pallets bucketed by days in warehouse"
            onExport={() => exportSheet(
              [['Pallet ID', 'SKU', 'Client', 'Units', 'Location', 'Received', 'Days', 'Bucket'],
                ...aging.palletDetails.map(p => [p.palletId, p.sku, p.clientName, p.units, p.location, fmtDate(p.receivedDate), p.days, p.bucket])],
              'Aging', 'JCT-Aging.xlsx'
            )}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ChartPie data={aging.series} empty={aging.series.every(s => s.value === 0) && 'No inventory'} />
              <div className="space-y-2">
                {aging.series.map(b => (
                  <div key={b.name} className="flex items-center gap-3">
                    <span className="text-xs px-2 py-0.5 rounded-full border" style={{ background: b.color + '15', color: b.color, borderColor: b.color + '30' }}>
                      {b.name === '90+' ? '90+ days' : `${b.name} days`}
                    </span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(b.value / Math.max(...aging.series.map(s => s.value), 1)) * 100}%`, background: b.color }} />
                    </div>
                    <span className="text-white font-medium text-sm w-16 text-right">{b.value} pallets</span>
                  </div>
                ))}
              </div>
            </div>
            {stalePallets.length > 0 && (
              <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                <p className="text-xs text-red-400 font-medium flex items-center gap-1 mb-2">
                  <AlertTriangle size={12} /> {stalePallets.length} pallet{stalePallets.length !== 1 ? 's' : ''} over 90 days
                </p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-400 uppercase">
                      <tr>
                        <th className="px-2 py-1 text-left">Pallet</th>
                        <th className="px-2 py-1 text-left">SKU</th>
                        <th className="px-2 py-1 text-left">Client</th>
                        <th className="px-2 py-1 text-right">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stalePallets.slice(0, 50).map(p => (
                        <tr key={p.palletId} className="border-t border-red-500/10">
                          <td className="px-2 py-1 font-mono text-white">{p.palletId}</td>
                          <td className="px-2 py-1 font-mono text-gray-300">{p.sku}</td>
                          <td className="px-2 py-1 text-gray-400 truncate max-w-[150px]">{p.clientName}</td>
                          <td className="px-2 py-1 text-right text-red-400 font-medium">{p.days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
          <Card title="Inventory by client" subtitle="Current snapshot"
            onExport={() => exportSheet([['Client', 'Pallets', 'Units'], ...inventoryByClient.map(r => [r.name, r.pallets, r.units])], 'Inventory', 'JCT-Inventory-by-client.xlsx')}>
            <ChartBar data={inventoryByClient.slice(0, 15)} xKey="name"
              bars={[{ key: 'units', name: 'Units', color: '#3b82f6' }, { key: 'pallets', name: 'Pallets', color: '#06b6d4' }]}
              empty={inventoryByClient.length === 0 && 'No inventory'} />
          </Card>
          <Card title="Inventory by condition" subtitle="Current units"
            onExport={() => exportSheet([['Condition', 'Units'], ...byCondition.map(r => [r.name, r.value])], 'Condition', 'JCT-Inventory-by-condition.xlsx')}>
            <ChartPie data={byCondition} empty={byCondition.length === 0 && 'No inventory'} />
          </Card>
        </div>
      )}

      {/* LOCATIONS */}
      {activeTab === 'locations' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI icon={MapPin}    label="Total locations"  value={storageUtilization.rows.length}                 color="text-purple-400" />
            <KPI icon={TrendingUp} label="Avg utilization" value={`${storageUtilization.summary.avgUtil}%`}        color="text-blue-400" />
            <KPI icon={AlertTriangle} label="Over capacity" value={storageUtilization.summary.over}                color="text-red-400" />
            <KPI icon={MapPin}    label="No capacity set"  value={storageUtilization.summary.noCapacity}          color="text-yellow-400" />
          </div>
          <Card title="Storage utilization" subtitle="Current pallets vs each location's capacity"
            onExport={() => exportSheet(
              [['Location', 'Capacity', 'Used', 'Free', 'Utilization %', 'Type'],
                ...storageUtilization.rows.map(r => [r.label, r.capacity, r.used, r.free, r.utilization ?? '', r.type])],
              'Utilization', 'JCT-Storage-Utilization.xlsx'
            )}>
            {storageUtilization.rows.length === 0 ? (
              <Placeholder icon={MapPin} label="No locations configured." />
            ) : (
              <>
                {storageUtilization.summary.noCapacity > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5 text-xs text-yellow-300 mb-3 flex items-center gap-2">
                    <AlertTriangle size={12} />
                    {storageUtilization.summary.noCapacity} location{storageUtilization.summary.noCapacity !== 1 ? 's have' : ' has'} no capacity set.
                  </div>
                )}
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-400 uppercase sticky top-0 bg-gray-900">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Location</th>
                        <th className="px-2 py-1.5 text-left">Type</th>
                        <th className="px-2 py-1.5 text-right">Capacity</th>
                        <th className="px-2 py-1.5 text-right">Used</th>
                        <th className="px-2 py-1.5 text-right">Free</th>
                        <th className="px-2 py-1.5 text-left w-40">Utilization</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storageUtilization.rows.slice(0, 200).map(r => {
                        const u = r.utilization
                        let barColor = '#6b7280'
                        if (u !== null) {
                          if (u > 100) barColor = '#ef4444'
                          else if (u >= 80) barColor = '#f59e0b'
                          else if (u >= 30) barColor = '#10b981'
                          else barColor = '#06b6d4'
                        }
                        return (
                          <tr key={r.label} className="border-t border-gray-800 hover:bg-gray-800/40">
                            <td className="px-2 py-1.5 font-mono text-white">{r.label}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r.type}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{r.capacity || '—'}</td>
                            <td className="px-2 py-1.5 text-right text-white font-medium">{r.used}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{r.capacity ? r.free : '—'}</td>
                            <td className="px-2 py-1.5">
                              {u === null ? (
                                <span className="text-xs text-gray-600">no capacity</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${Math.min(u, 100)}%`, background: barColor }} />
                                  </div>
                                  <span className="text-xs font-medium w-10 text-right" style={{ color: barColor }}>{u}%</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
          <Card title="Top locations by pallet count" subtitle="Current snapshot"
            onExport={() => exportSheet([['Location', 'Pallets', 'Units'], ...inventoryByLocation.map(r => [r.name, r.pallets, r.units])], 'Locations', 'JCT-Inventory-by-location.xlsx')}>
            <ChartBar data={inventoryByLocation.slice(0, 20)} xKey="name"
              bars={[{ key: 'pallets', name: 'Pallets', color: '#8b5cf6' }]}
              empty={inventoryByLocation.length === 0 && 'No inventory in locations'} />
          </Card>
        </div>
      )}
    </div>
  )
}

function KPI({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
        <Icon size={12} /> {label}
      </div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  )
}

function Card({ title, subtitle, children, onExport, wide }) {
  return (
    <div className={`bg-gray-900/50 border border-gray-800 rounded-lg p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {onExport && (
          <button onClick={onExport}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 hover:bg-gray-800 rounded">
            <Download size={11} /> Export
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function Placeholder({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 text-gray-500 text-sm">
      <Icon size={28} className="text-gray-700 mb-2" />
      <p>{label}</p>
    </div>
  )
}

function ChartLine({ data, lines, height = 220, yFormat, empty }) {
  if (empty) return <Placeholder icon={TrendingUp} label={empty} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="label" tick={axisStyle} stroke="#4b5563" />
        <YAxis tick={axisStyle} stroke="#4b5563" tickFormatter={yFormat} />
        <Tooltip {...tooltipStyle} formatter={yFormat ? (v) => yFormat(v) : undefined} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
        {lines.map(l => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function ChartBar({ data, xKey, bars, height = 280, yFormat, empty }) {
  if (empty) return <Placeholder icon={BarChart3} label={empty} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey={xKey} tick={axisStyle} stroke="#4b5563" angle={-25} textAnchor="end" interval={0} />
        <YAxis tick={axisStyle} stroke="#4b5563" tickFormatter={yFormat} />
        <Tooltip {...tooltipStyle} formatter={yFormat ? (v) => yFormat(v) : undefined} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
        {bars.map(b => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} />)}
      </BarChart>
    </ResponsiveContainer>
  )
}

function ChartPie({ data, empty, height = 240 }) {
  if (empty) return <Placeholder icon={BarChart3} label={empty} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
