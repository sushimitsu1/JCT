import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs, doc, updateDoc, addDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import {
  Package, MapPin, Pencil, Check, X, Plus, Minus,
  ClipboardList, Download, RefreshCw, ChevronDown,
  ChevronRight, Search, SlidersHorizontal
} from 'lucide-react'
import * as XLSX from 'xlsx'
import BarcodeScanner from '../components/BarcodeScanner'

const conditionColors = {
  A: 'bg-green-500/10 text-green-400 border-green-500/20',
  B: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  C: 'bg-red-500/10 text-red-400 border-red-500/20'
}
const statusColors = {
  available:  'bg-green-500/10 text-green-400 border-green-500/20',
  'on-hold':  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  damaged:    'bg-red-500/10 text-red-400 border-red-500/20',
  shipped:    'bg-gray-500/10 text-gray-400 border-gray-500/20',
  allocated:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
}
const ADJUSTMENT_REASONS = [
  'Damaged in warehouse', 'Miscount correction', 'Customer return',
  'Lost/missing', 'Quality hold removal', 'Inventory correction', 'Other'
]
const TABS = [
  { id: 'inventory',    label: 'Inventory',      icon: Package },
  { id: 'adjustments', label: 'Adjustments Log', icon: ClipboardList },
  { id: 'cycle',        label: 'Cycle Count',     icon: ClipboardList },
]
const emptyFilters = {
  clientId: '', sku: '', description: '', location: '',
  status: 'available', condition: '', receiptNumber: '',
  dateFrom: '', dateTo: ''
}

export default function Inventory() {
  const [inventory, setInventory] = useState([])
  const [clients, setClients] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [activeTab, setActiveTab] = useState('inventory')
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState(null)

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [filters, setFilters] = useState({ ...emptyFilters })
  const [appliedFilters, setAppliedFilters] = useState({ ...emptyFilters })
  const [collapsedSections, setCollapsedSections] = useState({})

  // Inline editing
  const [editingLocation, setEditingLocation] = useState(null)

  // Barcode scanner
  const [showScanner, setShowScanner] = useState(false)

  // Adjustment modal
  const [showAdjModal, setShowAdjModal] = useState(false)
  const [adjItem, setAdjItem] = useState(null)
  const [adjType, setAdjType] = useState('subtract')
  const [adjQty, setAdjQty] = useState('')
  const [adjReason, setAdjReason] = useState(ADJUSTMENT_REASONS[0])
  const [adjNotes, setAdjNotes] = useState('')
  const [adjLoading, setAdjLoading] = useState(false)

  // Cycle count
  const [cycleClient, setCycleClient] = useState('')
  const [cycleCounts, setCycleCounts] = useState({})
  const [cycleStarted, setCycleStarted] = useState(false)
  const [cycleVariances, setCycleVariances] = useState([])
  const [cycleSubmitted, setCycleSubmitted] = useState(false)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    else setRefreshing(true)
    const [invSnap, clientsSnap, adjSnap] = await Promise.all([
      getDocs(collection(db, 'inventory')),
      getDocs(collection(db, 'clients')),
      getDocs(query(collection(db, 'adjustments'), orderBy('createdAt', 'desc')))
    ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setAdjustments(adjSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLastRefreshed(new Date())
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData(true)
    setRefreshing(false)
  }

  // ─── BARCODE SCAN ─────────────────────────────────────────────────
  const handleInventoryScan = (barcode) => {
    setShowScanner(false)
    setFilters(f => ({ ...f, sku: barcode }))
    setAppliedFilters(f => ({ ...f, sku: barcode }))
  }

  const toggleSection = (key) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))

  const applyFilters = () => setAppliedFilters({ ...filters })
  const clearFilters = () => {
    setFilters({ ...emptyFilters })
    setAppliedFilters({ ...emptyFilters })
  }

  const updateStatus = async (id, status) => {
    await updateDoc(doc(db, 'inventory', id), { status })
    setInventory(inv => inv.map(i => i.id === id ? { ...i, status } : i))
  }

  const saveLocation = async (id, location) => {
    await updateDoc(doc(db, 'inventory', id), { location })
    setInventory(inv => inv.map(i => i.id === id ? { ...i, location } : i))
    setEditingLocation(null)
  }

  // Adjustment
  const openAdjModal = (item) => {
    setAdjItem(item)
    setAdjType('subtract')
    setAdjQty('')
    setAdjReason(ADJUSTMENT_REASONS[0])
    setAdjNotes('')
    setShowAdjModal(true)
  }

  const submitAdjustment = async () => {
    if (!adjQty || Number(adjQty) <= 0) return
    setAdjLoading(true)
    try {
      const qty = Number(adjQty)
      const currentUnits = Number(adjItem.units || adjItem.quantity || 0)
      const newUnits = adjType === 'add' ? currentUnits + qty : Math.max(0, currentUnits - qty)
      await updateDoc(doc(db, 'inventory', adjItem.id), { units: newUnits })
      await addDoc(collection(db, 'adjustments'), {
        inventoryId: adjItem.id, palletId: adjItem.palletId, sku: adjItem.sku,
        clientId: adjItem.clientId, clientName: adjItem.clientName,
        type: adjType, quantity: qty, previousUnits: currentUnits, newUnits,
        reason: adjReason, notes: adjNotes, createdAt: new Date().toISOString()
      })
      setInventory(inv => inv.map(i => i.id === adjItem.id ? { ...i, units: newUnits } : i))
      setShowAdjModal(false)
      fetchData(true)
    } catch (err) { console.error(err) }
    setAdjLoading(false)
  }

  // Cycle count
  const cycleInventory = inventory
    .filter(i => cycleClient ? i.clientId === cycleClient : true)
    .filter(i => (i.status || 'available') === 'available')

  const startCycleCount = () => {
    const counts = {}
    cycleInventory.forEach(item => { counts[item.id] = '' })
    setCycleCounts(counts)
    setCycleStarted(true)
    setCycleVariances([])
    setCycleSubmitted(false)
  }

  const calculateVariances = () => {
    const variances = []
    cycleInventory.forEach(item => {
      const counted = cycleCounts[item.id]
      if (counted === '' || counted === undefined) return
      const system = Number(item.units || item.quantity || 0)
      const physical = Number(counted)
      if (physical - system !== 0)
        variances.push({ ...item, systemUnits: system, physicalUnits: physical, variance: physical - system })
    })
    setCycleVariances(variances)
    return variances
  }

  const submitCycleCount = async () => {
    const variances = calculateVariances()
    setAdjLoading(true)
    try {
      for (const item of variances) {
        await updateDoc(doc(db, 'inventory', item.id), { units: item.physicalUnits })
        await addDoc(collection(db, 'adjustments'), {
          inventoryId: item.id, palletId: item.palletId, sku: item.sku,
          clientId: item.clientId, clientName: item.clientName,
          type: item.variance > 0 ? 'add' : 'subtract',
          quantity: Math.abs(item.variance),
          previousUnits: item.systemUnits, newUnits: item.physicalUnits,
          reason: 'Cycle count adjustment',
          notes: `Cycle count — system: ${item.systemUnits}, physical: ${item.physicalUnits}`,
          createdAt: new Date().toISOString()
        })
      }
      setCycleSubmitted(true)
      fetchData(true)
    } catch (err) { console.error(err) }
    setAdjLoading(false)
  }

  const exportCycleCount = () => {
    const rows = cycleInventory.map(item => ({
      'Pallet ID': item.palletId || '—', 'SKU': item.sku,
      'Description': item.description || '—', 'Location': item.location || '—',
      'System Units': item.units || item.quantity || 0,
      'Physical Count': cycleCounts[item.id] || '',
      'Variance': cycleCounts[item.id] !== ''
        ? Number(cycleCounts[item.id]) - Number(item.units || item.quantity || 0) : ''
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cycle Count')
    XLSX.writeFile(wb, `CycleCount_${new Date().toLocaleDateString()}.xlsx`)
  }

  // Apply filters
  const f = appliedFilters
  const filtered = inventory.filter(item => {
    if (f.clientId && item.clientId !== f.clientId) return false
    if (f.sku && !item.sku?.toLowerCase().includes(f.sku.toLowerCase())) return false
    if (f.description && !item.description?.toLowerCase().includes(f.description.toLowerCase())) return false
    if (f.location && !item.location?.toLowerCase().includes(f.location.toLowerCase())) return false
    if (f.status && (item.status || 'available') !== f.status) return false
    if (f.condition && item.condition !== f.condition) return false
    if (f.receiptNumber && !item.poNumber?.toLowerCase().includes(f.receiptNumber.toLowerCase())) return false
    if (f.dateFrom && item.receivedDate && item.receivedDate < f.dateFrom) return false
    if (f.dateTo && item.receivedDate && item.receivedDate > f.dateTo) return false
    return true
  })

  const available = inventory.filter(i => (i.status || 'available') === 'available').length
  const onHold    = inventory.filter(i => i.status === 'on-hold').length
  const damaged   = inventory.filter(i => i.status === 'damaged').length
  const allocated = inventory.filter(i => i.status === 'allocated').length
  const totalUnits = filtered.reduce((s, i) => s + Number(i.units || i.quantity || 0), 0)

  const inputCls = "w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
  const labelCls = "text-gray-500 text-xs mb-1 block"

  const SectionHeader = ({ title, sectionKey }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="w-full flex items-center justify-between py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-200 transition-colors"
    >
      {title}
      {collapsedSections[sectionKey]
        ? <ChevronRight size={12} />
        : <ChevronDown size={12} />}
    </button>
  )

  return (
    <div className="flex h-full overflow-hidden">

      {/* ─── Left Search Sidebar ─── */}
      {sidebarOpen && (
        <div className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="text-white text-xs font-semibold">Search Filters</span>
            <button onClick={() => setSidebarOpen(false)} className="text-gray-500 hover:text-gray-300">
              <X size={13} />
            </button>
          </div>

          <div className="px-4 py-3 space-y-4 flex-1">
            <div>
              <SectionHeader title="Search by Transaction" sectionKey="transaction" />
              {!collapsedSections.transaction && (
                <div className="space-y-2 pb-2">
                  <div>
                    <label className={labelCls}>Customer</label>
                    <select value={filters.clientId} onChange={e => setFilters({ ...filters, clientId: e.target.value })} className={inputCls}>
                      <option value="">All clients</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Receipt / PO #</label>
                    <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                      <span className="text-gray-500 text-xs px-2">Contains</span>
                      <input value={filters.receiptNumber} onChange={e => setFilters({ ...filters, receiptNumber: e.target.value })}
                        className="flex-1 bg-transparent text-white text-xs px-2 py-1.5 focus:outline-none" placeholder="Search..." />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-800" />

            <div>
              <SectionHeader title="Search by Item Detail" sectionKey="item" />
              {!collapsedSections.item && (
                <div className="space-y-2 pb-2">
                  <div>
                    <label className={labelCls}>SKU / UPC</label>
                    <div className="flex items-center gap-1">
                      <div className="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                        <span className="text-gray-500 text-xs px-2">Contains</span>
                        <input value={filters.sku} onChange={e => setFilters({ ...filters, sku: e.target.value })}
                          className="flex-1 bg-transparent text-white text-xs px-2 py-1.5 focus:outline-none" placeholder="SKU..." />
                      </div>
                      <button onClick={() => setShowScanner(true)} className="text-blue-400 hover:text-blue-300 p-1.5 bg-gray-800 rounded-lg border border-gray-700" title="Scan barcode">
                        📷
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                      <span className="text-gray-500 text-xs px-2">Contains</span>
                      <input value={filters.description} onChange={e => setFilters({ ...filters, description: e.target.value })}
                        className="flex-1 bg-transparent text-white text-xs px-2 py-1.5 focus:outline-none" placeholder="Description..." />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Condition</label>
                    <select value={filters.condition} onChange={e => setFilters({ ...filters, condition: e.target.value })} className={inputCls}>
                      <option value="">All conditions</option>
                      <option value="A">Grade A</option>
                      <option value="B">Grade B</option>
                      <option value="C">Grade C</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-800" />

            <div>
              <SectionHeader title="Search by Location" sectionKey="location" />
              {!collapsedSections.location && (
                <div className="space-y-2 pb-2">
                  <div>
                    <label className={labelCls}>Location</label>
                    <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                      <span className="text-gray-500 text-xs px-2">Contains</span>
                      <input value={filters.location} onChange={e => setFilters({ ...filters, location: e.target.value })}
                        className="flex-1 bg-transparent text-white text-xs px-2 py-1.5 focus:outline-none" placeholder="e.g. A-01..." />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-800" />

            <div>
              <SectionHeader title="Search by Status" sectionKey="status" />
              {!collapsedSections.status && (
                <div className="space-y-2 pb-2">
                  <div>
                    <label className={labelCls}>Status</label>
                    <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className={inputCls}>
                      <option value="">All statuses</option>
                      <option value="available">Available</option>
                      <option value="allocated">Allocated</option>
                      <option value="on-hold">On Hold</option>
                      <option value="damaged">Damaged</option>
                      <option value="shipped">Shipped</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-800" />

            <div>
              <SectionHeader title="Search by Date Range" sectionKey="date" />
              {!collapsedSections.date && (
                <div className="space-y-2 pb-2">
                  <div>
                    <label className={labelCls}>Received From</label>
                    <input type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Received To</label>
                    <input type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-t border-gray-800 space-y-2">
            <button onClick={applyFilters} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2">
              <Search size={13} /> Apply Filters
            </button>
            <button onClick={clearFilters} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-2 rounded-lg transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ─── Main Content ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 pb-4 flex-shrink-0">

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)}
                  className="text-gray-400 hover:text-white p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
                  title="Show filters">
                  <SlidersHorizontal size={15} />
                </button>
              )}
              <div>
                <h2 className="text-xl font-semibold text-white">Inventory</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {filtered.length} pallets · {totalUnits} units shown
                  {lastRefreshed && (
                    <span className="ml-2 text-gray-600 text-xs">
                      · Updated {lastRefreshed.toLocaleTimeString()}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowScanner(true)}
                className="flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-2 rounded-lg transition-colors"
              >
                📷 Scan
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 hover:text-white px-3 py-2 rounded-lg transition-colors"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-gray-800">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <tab.icon size={15} />
                {tab.label}
                {tab.id === 'adjustments' && adjustments.length > 0 && (
                  <span className="bg-gray-700 text-gray-300 text-xs px-1.5 py-0.5 rounded-full">
                    {adjustments.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto px-6 pb-6">

          {/* ── INVENTORY TAB ── */}
          {activeTab === 'inventory' && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-5 gap-3 mb-4">
                {[
                  { label: 'Available',  value: available,         color: 'text-green-400',  status: 'available' },
                  { label: 'Allocated',  value: allocated,         color: 'text-blue-400',   status: 'allocated' },
                  { label: 'On Hold',    value: onHold,            color: 'text-yellow-400', status: 'on-hold'   },
                  { label: 'Damaged',    value: damaged,           color: 'text-red-400',    status: 'damaged'   },
                  { label: 'Total',      value: inventory.length,  color: 'text-white',      status: ''          },
                ].map(card => (
                  <div
                    key={card.label}
                    onClick={() => {
                      const newStatus = filters.status === card.status ? '' : card.status
                      setFilters(f => ({ ...f, status: newStatus }))
                      setAppliedFilters(f => ({ ...f, status: newStatus }))
                    }}
                    className={`bg-gray-900 border rounded-xl p-3 cursor-pointer transition-colors ${
                      appliedFilters.status === card.status && card.status
                        ? 'border-blue-500' : 'border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                    <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Pallet ID</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">SKU</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Description</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Client</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Units</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Cond.</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Location</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Status</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Adjust</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-12">
                          <Package size={32} className="text-gray-700 mx-auto mb-3" />
                          <p className="text-gray-500 text-sm">No pallets match your filters</p>
                          <button onClick={clearFilters} className="text-blue-400 text-xs mt-2 hover:underline">
                            Clear filters
                          </button>
                        </td>
                      </tr>
                    ) : filtered.map((item, i) => (
                      <tr key={item.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                        <td className="px-4 py-3 text-blue-400 font-mono text-xs font-medium">{item.palletId || '—'}</td>
                        <td className="px-4 py-3 text-white font-mono text-xs font-medium">{item.sku}</td>
                        <td className="px-4 py-3 text-gray-300 max-w-xs truncate text-xs">{item.description || '—'}</td>
                        <td className="px-4 py-3 text-gray-300 text-xs">{item.clientName}</td>
                        <td className="px-4 py-3 text-white font-medium">{item.units || item.quantity || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[item.condition]}`}>
                            {item.condition}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {editingLocation?.id === item.id ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus value={editingLocation.value}
                                onChange={e => setEditingLocation({ ...editingLocation, value: e.target.value })}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveLocation(item.id, editingLocation.value)
                                  if (e.key === 'Escape') setEditingLocation(null)
                                }}
                                className="bg-gray-800 border border-blue-500 text-white rounded px-2 py-1 text-xs w-24 focus:outline-none"
                              />
                              <button onClick={() => saveLocation(item.id, editingLocation.value)} className="text-green-400 hover:text-green-300">
                                <Check size={12} />
                              </button>
                              <button onClick={() => setEditingLocation(null)} className="text-gray-500 hover:text-gray-300">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingLocation({ id: item.id, value: item.location || '' })}
                              className="flex items-center gap-1 text-gray-300 hover:text-white group"
                            >
                              <MapPin size={11} className="text-gray-600 group-hover:text-gray-400" />
                              <span className="text-xs">{item.location || 'Set location'}</span>
                              <Pencil size={10} className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={item.status || 'available'}
                            onChange={e => updateStatus(item.id, e.target.value)}
                            className={`text-xs px-2 py-1 rounded-full border bg-transparent cursor-pointer focus:outline-none ${statusColors[item.status || 'available']}`}
                          >
                            <option value="available">Available</option>
                            <option value="allocated">Allocated</option>
                            <option value="on-hold">On Hold</option>
                            <option value="damaged">Damaged</option>
                            <option value="shipped">Shipped</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => openAdjModal(item)}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg transition-colors">
                            <Plus size={11} /><Minus size={11} />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{item.receivedDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── ADJUSTMENTS TAB ── */}
          {activeTab === 'adjustments' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Date</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Client</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">SKU</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Pallet ID</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Type</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Qty</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Before → After</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12">
                        <ClipboardList size={32} className="text-gray-700 mx-auto mb-3" />
                        <p className="text-gray-500 text-sm">No adjustments yet</p>
                      </td>
                    </tr>
                  ) : adjustments.map((adj, i) => (
                    <tr key={adj.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(adj.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{adj.clientName}</td>
                      <td className="px-4 py-3 text-white font-mono text-xs">{adj.sku}</td>
                      <td className="px-4 py-3 text-blue-400 font-mono text-xs">{adj.palletId || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          adj.type === 'add'
                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>
                          {adj.type === 'add' ? '+ Add' : '− Remove'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white font-medium">{adj.quantity}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{adj.previousUnits} → {adj.newUnits}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{adj.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── CYCLE COUNT TAB ── */}
          {activeTab === 'cycle' && (
            <div>
              {!cycleStarted ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
                  <h3 className="text-white font-semibold mb-2">Start a Cycle Count</h3>
                  <p className="text-gray-400 text-sm mb-6">Select a client to count their inventory and calculate variances.</p>
                  <div className="flex gap-4 items-end">
                    <div className="flex-1 max-w-xs">
                      <label className="text-gray-400 text-xs mb-1 block">Client</label>
                      <select value={cycleClient} onChange={e => setCycleClient(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500">
                        <option value="">All clients</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                      </select>
                    </div>
                    <button onClick={startCycleCount}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                      <ClipboardList size={16} /> Start Count ({cycleInventory.length} pallets)
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-white font-semibold">
                        Cycle Count — {cycleClient ? clients.find(c => c.id === cycleClient)?.companyName : 'All Clients'}
                      </h3>
                      <p className="text-gray-400 text-sm mt-0.5">Enter physical unit count for each pallet</p>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={exportCycleCount}
                        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg">
                        <Download size={14} /> Export Sheet
                      </button>
                      <button onClick={() => { setCycleStarted(false); setCycleCounts({}); setCycleVariances([]); setCycleSubmitted(false) }}
                        className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg">
                        Cancel
                      </button>
                      <button onClick={calculateVariances}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
                        Calculate Variances
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['Pallet ID', 'SKU', 'Client', 'Location', 'System Units', 'Physical Count', 'Variance'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium text-xs">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cycleInventory.map((item, i) => {
                          const systemUnits = Number(item.units || item.quantity || 0)
                          const counted = cycleCounts[item.id]
                          const variance = counted !== '' && counted !== undefined
                            ? Number(counted) - systemUnits : null
                          return (
                            <tr key={item.id} className={`border-b border-gray-800/50 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                              <td className="px-4 py-2 text-blue-400 font-mono text-xs">{item.palletId || '—'}</td>
                              <td className="px-4 py-2 text-white font-mono text-xs">{item.sku}</td>
                              <td className="px-4 py-2 text-gray-300 text-xs">{item.clientName}</td>
                              <td className="px-4 py-2 text-gray-300 text-xs">{item.location || '—'}</td>
                              <td className="px-4 py-2 text-white font-medium">{systemUnits}</td>
                              <td className="px-4 py-2">
                                <input type="number" value={cycleCounts[item.id] || ''}
                                  onChange={e => setCycleCounts({ ...cycleCounts, [item.id]: e.target.value })}
                                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500 w-24"
                                  placeholder="Count..." />
                              </td>
                              <td className="px-4 py-2">
                                {variance !== null && (
                                  <span className={`text-xs font-medium ${
                                    variance === 0 ? 'text-green-400' :
                                    variance > 0 ? 'text-blue-400' : 'text-red-400'
                                  }`}>
                                    {variance > 0 ? '+' : ''}{variance}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {cycleVariances.length > 0 && !cycleSubmitted && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                      <h4 className="text-white font-medium mb-3">
                        {cycleVariances.length} pallet{cycleVariances.length > 1 ? 's' : ''} with discrepancies
                      </h4>
                      <div className="space-y-2 mb-4">
                        {cycleVariances.map(item => (
                          <div key={item.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-3">
                              <span className="text-white font-mono text-xs">{item.sku}</span>
                              <span className="text-gray-500 text-xs">{item.palletId}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <span className="text-gray-400">System: {item.systemUnits}</span>
                              <span className="text-gray-400">Physical: {item.physicalUnits}</span>
                              <span className={`font-medium ${item.variance > 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                {item.variance > 0 ? '+' : ''}{item.variance}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={submitCycleCount} disabled={adjLoading}
                        className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                        {adjLoading ? 'Applying...' : 'Apply All Adjustments & Complete Count'}
                      </button>
                    </div>
                  )}

                  {cycleVariances.length === 0 && Object.values(cycleCounts).some(v => v !== '') && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                      <p className="text-green-400 font-medium">✓ No variances found — inventory matches physical count</p>
                    </div>
                  )}

                  {cycleSubmitted && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                      <p className="text-green-400 font-medium">✓ Cycle count complete — {cycleVariances.length} adjustments applied</p>
                      <button onClick={() => { setCycleStarted(false); setCycleCounts({}); setCycleVariances([]); setCycleSubmitted(false) }}
                        className="text-green-400 text-sm underline mt-2">
                        Start new count
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Adjustment Modal ── */}
      {showAdjModal && adjItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div>
                <h3 className="text-white font-semibold">Adjust Inventory</h3>
                <p className="text-gray-500 text-xs mt-0.5">
                  {adjItem.sku} · {adjItem.palletId} · Current: {adjItem.units || adjItem.quantity} units
                </p>
              </div>
              <button onClick={() => setShowAdjModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setAdjType('add')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    adjType === 'add'
                      ? 'bg-green-600/20 border border-green-600/30 text-green-400'
                      : 'bg-gray-800 border border-gray-700 text-gray-400'
                  }`}>
                  <Plus size={14} /> Add Units
                </button>
                <button onClick={() => setAdjType('subtract')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    adjType === 'subtract'
                      ? 'bg-red-600/20 border border-red-600/30 text-red-400'
                      : 'bg-gray-800 border border-gray-700 text-gray-400'
                  }`}>
                  <Minus size={14} /> Remove Units
                </button>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Quantity</label>
                <input type="number" value={adjQty} onChange={e => setAdjQty(e.target.value)} autoFocus
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Enter quantity..." />
                {adjQty && (
                  <p className="text-gray-500 text-xs mt-1">
                    New total: <span className="text-white font-medium">
                      {adjType === 'add'
                        ? Number(adjItem.units || adjItem.quantity || 0) + Number(adjQty)
                        : Math.max(0, Number(adjItem.units || adjItem.quantity || 0) - Number(adjQty))
                      } units
                    </span>
                  </p>
                )}
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Reason *</label>
                <select value={adjReason} onChange={e => setAdjReason(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500">
                  {ADJUSTMENT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Notes</label>
                <textarea value={adjNotes} onChange={e => setAdjNotes(e.target.value)} rows={2}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Optional details..." />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowAdjModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={submitAdjustment} disabled={adjLoading || !adjQty || Number(adjQty) <= 0}
                className={`px-4 py-2 text-sm disabled:opacity-50 text-white rounded-lg transition-colors ${
                  adjType === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}>
                {adjLoading ? 'Saving...' : `${adjType === 'add' ? 'Add' : 'Remove'} Units`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Barcode Scanner ── */}
      {showScanner && (
        <BarcodeScanner
          title="Scan to Find Pallet"
          onScan={handleInventoryScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}