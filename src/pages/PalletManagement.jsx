import { useState, useEffect, useCallback, useMemo } from 'react'
import { collection, getDocs, doc, updateDoc, addDoc, query, orderBy, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import {
  Package, MapPin, RefreshCw, Search, SlidersHorizontal,
  Combine, Split, Move, History, Check, X, ChevronDown, ChevronRight,
  AlertTriangle, ScanLine
} from 'lucide-react'
import BarcodeScanner from '../components/BarcodeScanner'

const statusColors = {
  available:  'bg-green-500/10 text-green-400 border-green-500/20',
  'on-hold':  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  damaged:    'bg-red-500/10 text-red-400 border-red-500/20',
  shipped:    'bg-gray-500/10 text-gray-400 border-gray-500/20',
  allocated:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

const conditionColors = {
  A: 'bg-green-500/10 text-green-400 border-green-500/20',
  B: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  C: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const TABS = [
  { id: 'pallets', label: 'Pallets',        icon: Package },
  { id: 'history', label: 'Pallet History', icon: History },
]

// ─── Pallet ID generation (reuses your existing pattern via counters) ───
async function reservePalletIds(count, db) {
  const { doc, runTransaction } = await import('firebase/firestore')
  const ref = doc(db, 'system', 'counters')
  const ids = []
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.exists() ? Number(snap.data().palletId || 0) : 0
    for (let i = 1; i <= count; i++) {
      const n = current + i
      ids.push(`P${String(n).padStart(7, '0')}`)
    }
    tx.set(ref, { palletId: current + count }, { merge: true })
  })
  return ids
}

export default function PalletManagement() {
  const [inventory, setInventory] = useState([])
  const [clients, setClients] = useState([])
  const [history, setHistory] = useState([])
  const [activeTab, setActiveTab] = useState('pallets')
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState(null)

  // Filters
  const [filtersExpanded, setFiltersExpanded] = useState(() => localStorage.getItem('jct-pallets-filters') !== 'collapsed')
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterSku, setFilterSku] = useState('')

  // Selection
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Modals
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [splitTarget, setSplitTarget] = useState(null) // single inventory doc
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moveLocation, setMoveLocation] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // Split form state
  const [splitParts, setSplitParts] = useState([]) // [{ units, location }]

  // Scanner
  const [showScanner, setShowScanner] = useState(false)

  useEffect(() => {
    localStorage.setItem('jct-pallets-filters', filtersExpanded ? 'expanded' : 'collapsed')
  }, [filtersExpanded])

  const fetchData = useCallback(async () => {
    setRefreshing(true)
    try {
      const [invSnap, clientsSnap, histSnap] = await Promise.all([
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'clients')),
        getDocs(query(collection(db, 'palletHistory'), orderBy('createdAt', 'desc'))).catch(() => ({ docs: [] }))
      ])
      setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setHistory((histSnap.docs || []).map(d => ({ id: d.id, ...d.data() })))
      setLastRefreshed(new Date())
    } catch (e) {
      console.error('Failed to load pallet data', e)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Audit log helper ───
  const logAction = async (action, details) => {
    try {
      await addDoc(collection(db, 'palletHistory'), {
        action, // 'merge' | 'split' | 'move'
        ...details,
        createdAt: serverTimestamp(),
      })
    } catch (e) {
      console.error('Failed to log pallet action', e)
    }
  }

  // ─── Filter logic ───
  const filtered = useMemo(() => {
    return inventory.filter(p => {
      if (filterClient && p.clientId !== filterClient) return false
      if (filterStatus && (p.status || 'available') !== filterStatus) return false
      if (filterLocation && !(p.location || '').toLowerCase().includes(filterLocation.toLowerCase())) return false
      if (filterSku && !(p.sku || '').toLowerCase().includes(filterSku.toLowerCase())) return false
      if (search) {
        const s = search.toLowerCase()
        const hay = [p.palletId, p.sku, p.location, p.receiptId, p.description].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [inventory, filterClient, filterStatus, filterLocation, filterSku, search])

  // Group by palletId for display (mixed-SKU pallets show as one row with multiple items)
  const grouped = useMemo(() => {
    const map = new Map()
    for (const p of filtered) {
      const key = p.palletId || p.id
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(p)
    }
    return Array.from(map.entries()).map(([palletId, items]) => ({ palletId, items }))
  }, [filtered])

  const activeFilterCount = [filterClient, filterStatus !== 'available' ? filterStatus : '', filterLocation, filterSku, search].filter(Boolean).length

  const clientName = (id) => clients.find(c => c.id === id)?.name || id || '—'

  // ─── Selection ───
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAllInGroup = (items) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = items.every(i => next.has(i.id))
      items.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id))
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const selectedDocs = useMemo(() => inventory.filter(i => selectedIds.has(i.id)), [inventory, selectedIds])

  // ─── Action validators ───
  const canMerge = useMemo(() => {
    if (selectedDocs.length < 2) return { ok: false, reason: 'Select at least 2 pallets' }
    const clients = new Set(selectedDocs.map(d => d.clientId))
    if (clients.size > 1) return { ok: false, reason: 'All pallets must belong to the same client' }
    const palletIds = new Set(selectedDocs.map(d => d.palletId))
    if (palletIds.size < 2) return { ok: false, reason: 'Selected items are already on the same pallet' }
    return { ok: true }
  }, [selectedDocs])

  const canMove = selectedDocs.length >= 1

  // ─── MERGE ───
  const handleMerge = async () => {
    if (!canMerge.ok) return
    setActionLoading(true)
    try {
      const [newPalletId] = await reservePalletIds(1, db)
      const batch = writeBatch(db)
      const fromPalletIds = [...new Set(selectedDocs.map(d => d.palletId))]
      for (const d of selectedDocs) {
        batch.update(doc(db, 'inventory', d.id), { palletId: newPalletId })
      }
      await batch.commit()
      await logAction('merge', {
        newPalletId,
        fromPalletIds,
        clientId: selectedDocs[0].clientId,
        itemCount: selectedDocs.length,
        skus: [...new Set(selectedDocs.map(d => d.sku))],
        totalUnits: selectedDocs.reduce((s, d) => s + Number(d.units || 0), 0),
      })
      setShowMergeModal(false)
      clearSelection()
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Merge failed: ' + e.message)
    } finally {
      setActionLoading(false)
    }
  }

  // ─── SPLIT ───
  const openSplit = (item) => {
    setSplitTarget(item)
    setSplitParts([
      { units: Math.floor(Number(item.units || 0) / 2), location: item.location || '' },
      { units: Math.ceil(Number(item.units || 0) / 2), location: item.location || '' },
    ])
    setShowSplitModal(true)
  }
  const updateSplitPart = (idx, field, val) => {
    setSplitParts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: field === 'units' ? Number(val) : val } : p))
  }
  const addSplitPart = () => setSplitParts(prev => [...prev, { units: 0, location: splitTarget?.location || '' }])
  const removeSplitPart = (idx) => setSplitParts(prev => prev.filter((_, i) => i !== idx))

  const splitSum = splitParts.reduce((s, p) => s + Number(p.units || 0), 0)
  const splitValid = splitTarget && splitSum === Number(splitTarget.units || 0) && splitParts.every(p => p.units > 0) && splitParts.length >= 2

  const handleSplit = async () => {
    if (!splitValid) return
    setActionLoading(true)
    try {
      // First part keeps original doc with new pallet ID, units updated
      // Additional parts become new inventory docs with new pallet IDs each
      const newIds = await reservePalletIds(splitParts.length, db)
      const batch = writeBatch(db)
      const originalPalletId = splitTarget.palletId
      // Update original doc
      batch.update(doc(db, 'inventory', splitTarget.id), {
        palletId: newIds[0],
        units: splitParts[0].units,
        location: splitParts[0].location,
      })
      // Create new docs for additional parts
      const { addDoc: addD } = await import('firebase/firestore')
      const newDocsData = []
      for (let i = 1; i < splitParts.length; i++) {
        const data = {
          palletId: newIds[i],
          sku: splitTarget.sku,
          description: splitTarget.description || '',
          units: splitParts[i].units,
          location: splitParts[i].location,
          clientId: splitTarget.clientId,
          receiptId: splitTarget.receiptId || null,
          status: splitTarget.status || 'available',
          condition: splitTarget.condition || 'A',
          createdAt: serverTimestamp(),
          splitFromPalletId: originalPalletId,
        }
        newDocsData.push(data)
      }
      await batch.commit()
      // Add new docs (can't batch addDoc with auto IDs cleanly; use parallel adds)
      await Promise.all(newDocsData.map(d => addD(collection(db, 'inventory'), d)))

      await logAction('split', {
        fromPalletId: originalPalletId,
        newPalletIds: newIds,
        clientId: splitTarget.clientId,
        sku: splitTarget.sku,
        originalUnits: Number(splitTarget.units || 0),
        parts: splitParts.map((p, i) => ({ palletId: newIds[i], units: p.units, location: p.location })),
      })
      setShowSplitModal(false)
      setSplitTarget(null)
      setSplitParts([])
      clearSelection()
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Split failed: ' + e.message)
    } finally {
      setActionLoading(false)
    }
  }

  // ─── MOVE ───
  const handleMove = async () => {
    if (!canMove || !moveLocation.trim()) return
    setActionLoading(true)
    try {
      const batch = writeBatch(db)
      const moves = []
      for (const d of selectedDocs) {
        moves.push({ palletId: d.palletId, sku: d.sku, fromLocation: d.location || '', toLocation: moveLocation.trim() })
        batch.update(doc(db, 'inventory', d.id), { location: moveLocation.trim() })
      }
      await batch.commit()
      await logAction('move', {
        toLocation: moveLocation.trim(),
        moves,
        itemCount: selectedDocs.length,
      })
      setShowMoveModal(false)
      setMoveLocation('')
      clearSelection()
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Move failed: ' + e.message)
    } finally {
      setActionLoading(false)
    }
  }

  // ─── Scanner result ───
  const handleScan = (code) => {
    setShowScanner(false)
    if (!code) return
    // Find inventory doc(s) with this palletId
    const matches = inventory.filter(i => (i.palletId || '').toLowerCase() === code.toLowerCase())
    if (matches.length === 0) {
      alert(`No pallet found with ID: ${code}`)
      return
    }
    setSelectedIds(prev => {
      const next = new Set(prev)
      matches.forEach(m => next.add(m.id))
      return next
    })
    setSearch(code)
  }

  const clearFilters = () => {
    setSearch(''); setFilterClient(''); setFilterLocation(''); setFilterSku(''); setFilterStatus('available')
  }

  // ────────────────────────── RENDER ──────────────────────────
  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Package className="text-blue-400" size={26} />
            Pallet Management
          </h1>
          <p className="text-gray-400 text-sm mt-1">Merge, split, and move pallets across locations</p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshed && (
            <span className="text-xs text-gray-500">Updated {lastRefreshed.toLocaleTimeString()}</span>
          )}
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border border-gray-700"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 mb-4">
        {TABS.map(t => {
          const Icon = t.icon
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px transition-colors ${
                active ? 'border-red-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'pallets' && (
        <>
          {/* Top filter bar */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg mb-4">
            <button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-200">Filters & Search</span>
                {activeFilterCount > 0 && (
                  <span className="bg-blue-600/30 text-blue-400 text-xs px-2 py-0.5 rounded-full border border-blue-500/20">
                    {activeFilterCount} active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeFilterCount > 0 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); clearFilters() }}
                    className="text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded cursor-pointer"
                  >
                    Clear all
                  </span>
                )}
                {filtersExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              </div>
            </button>

            {filtersExpanded && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-6 gap-2">
                <div className="md:col-span-2 relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search pallet ID, SKU, location..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500"
                  />
                </div>
                <button
                  onClick={() => setShowScanner(true)}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5"
                >
                  <ScanLine size={14} /> Scan
                </button>
                <select
                  value={filterClient}
                  onChange={(e) => setFilterClient(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2"
                >
                  <option value="">All clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2"
                >
                  <option value="">All statuses</option>
                  <option value="available">Available</option>
                  <option value="on-hold">On hold</option>
                  <option value="damaged">Damaged</option>
                  <option value="allocated">Allocated</option>
                  <option value="shipped">Shipped</option>
                </select>
                <input
                  type="text"
                  placeholder="Location"
                  value={filterLocation}
                  onChange={(e) => setFilterLocation(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2"
                />
                <input
                  type="text"
                  placeholder="SKU"
                  value={filterSku}
                  onChange={(e) => setFilterSku(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2"
                />
              </div>
            )}
          </div>

          {/* Action toolbar */}
          {selectedIds.size > 0 && (
            <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg px-4 py-2.5 mb-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-blue-300 font-medium">{selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-400">
                  {selectedDocs.reduce((s, d) => s + Number(d.units || 0), 0)} units
                </span>
                <button onClick={clearSelection} className="text-gray-400 hover:text-white text-xs underline ml-2">Clear</button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMergeModal(true)}
                  disabled={!canMerge.ok}
                  title={canMerge.ok ? 'Merge selected pallets' : canMerge.reason}
                  className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5"
                >
                  <Combine size={14} /> Merge
                </button>
                <button
                  onClick={() => setShowMoveModal(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5"
                >
                  <Move size={14} /> Move
                </button>
              </div>
            </div>
          )}

          {/* Pallet table */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 text-sm text-gray-400">
              {grouped.length} pallet{grouped.length !== 1 ? 's' : ''} · {filtered.length} line item{filtered.length !== 1 ? 's' : ''}
            </div>
            {grouped.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <Package size={40} className="mx-auto mb-3 text-gray-700" />
                <p>No pallets match your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left w-8"></th>
                      <th className="px-3 py-2 text-left">Pallet ID</th>
                      <th className="px-3 py-2 text-left">Client</th>
                      <th className="px-3 py-2 text-left">SKU(s)</th>
                      <th className="px-3 py-2 text-right">Units</th>
                      <th className="px-3 py-2 text-left">Location</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(({ palletId, items }) => {
                      const mixed = items.length > 1
                      const totalUnits = items.reduce((s, i) => s + Number(i.units || 0), 0)
                      const allSelected = items.every(i => selectedIds.has(i.id))
                      const someSelected = items.some(i => selectedIds.has(i.id))
                      return (
                        <tr key={palletId} className={`border-t border-gray-800 hover:bg-gray-800/40 ${someSelected ? 'bg-blue-950/20' : ''}`}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                              onChange={() => selectAllInGroup(items)}
                              className="accent-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-white text-xs">
                            {palletId}
                            {mixed && (
                              <span className="ml-2 bg-purple-500/10 text-purple-400 text-[10px] px-1.5 py-0.5 rounded border border-purple-500/20">
                                MIXED · {items.length} SKUs
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-300">{items[0].clientName || items[0].clientId || '-'}</td>
                          <td className="px-3 py-2 text-gray-300">
                            {mixed ? (
                              <div className="space-y-0.5">
                                {items.map(i => (
                                  <div key={i.id} className="flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(i.id)}
                                      onChange={() => toggleSelect(i.id)}
                                      className="accent-blue-500"
                                    />
                                    <span className="font-mono">{i.sku}</span>
                                    <span className="text-gray-500">· {Number(i.units || 0)} units</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="font-mono text-xs">{items[0].sku}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-white font-medium">{totalUnits}</td>
                          <td className="px-3 py-2 text-gray-300 flex items-center gap-1">
                            <MapPin size={11} className="text-gray-500" />
                            {items[0].location || <span className="text-gray-600 italic">unassigned</span>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[items[0].status || 'available']}`}>
                              {items[0].status || 'available'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!mixed && (
                              <button
                                onClick={() => openSplit(items[0])}
                                disabled={Number(items[0].units || 0) < 2}
                                title={Number(items[0].units || 0) < 2 ? 'Need at least 2 units to split' : 'Split this pallet'}
                                className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 border border-gray-700 text-white px-2 py-1 rounded text-xs flex items-center gap-1 ml-auto"
                              >
                                <Split size={11} /> Split
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'history' && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 text-sm text-gray-400">
            {history.length} action{history.length !== 1 ? 's' : ''} logged
          </div>
          {history.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <History size={40} className="mx-auto mb-3 text-gray-700" />
              <p>No pallet actions logged yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                      <td className="px-3 py-2 text-gray-400 text-xs">
                        {h.createdAt?.toDate ? h.createdAt.toDate().toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          h.action === 'merge' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                          h.action === 'split' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                          'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        }`}>
                          {h.action.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-300 text-xs">{h.clientName || h.clientId || '-'}</td>
                      <td className="px-3 py-2 text-gray-300 text-xs font-mono">
                        {h.action === 'merge' && `${h.fromPalletIds?.join(', ')} → ${h.newPalletId} (${h.itemCount} items, ${h.totalUnits} units)`}
                        {h.action === 'split' && `${h.fromPalletId} → ${h.newPalletIds?.join(', ')} (${h.originalUnits} units)`}
                        {h.action === 'move' && `${h.itemCount} pallet(s) → ${h.toLocation}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── MERGE MODAL ─── */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Combine size={16} className="text-purple-400" /> Merge Pallets</h3>
              <button onClick={() => setShowMergeModal(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-400">
                {selectedDocs.length} items from {new Set(selectedDocs.map(d => d.palletId)).size} pallets will be combined onto a single new pallet ID.
              </p>
              {new Set(selectedDocs.map(d => d.sku)).size > 1 && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-sm text-yellow-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5" />
                  <span>This will create a <strong>mixed-SKU pallet</strong> with {new Set(selectedDocs.map(d => d.sku)).size} different SKUs. Make sure this matches the physical pallet.</span>
                </div>
              )}
              <div className="bg-gray-800/50 rounded-lg p-3 space-y-1 text-xs font-mono">
                {selectedDocs.map(d => (
                  <div key={d.id} className="flex justify-between text-gray-300">
                    <span>{d.palletId} · {d.sku}</span>
                    <span>{d.units} units · {d.location || 'no loc'}</span>
                  </div>
                ))}
                <div className="border-t border-gray-700 mt-2 pt-2 flex justify-between text-white font-semibold">
                  <span>Total</span>
                  <span>{selectedDocs.reduce((s, d) => s + Number(d.units || 0), 0)} units</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowMergeModal(false)} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
              <button
                onClick={handleMerge}
                disabled={actionLoading}
                className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
              >
                <Check size={14} /> {actionLoading ? 'Merging...' : 'Confirm Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SPLIT MODAL ─── */}
      {showSplitModal && splitTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Split size={16} className="text-orange-400" /> Split Pallet {splitTarget.palletId}</h3>
              <button onClick={() => { setShowSplitModal(false); setSplitTarget(null) }} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-gray-400">
                SKU <span className="font-mono text-white">{splitTarget.sku}</span> · {Number(splitTarget.units || 0)} units · {splitTarget.location || 'no location'}
              </div>
              <div className="space-y-2">
                {splitParts.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">Part {i + 1}</span>
                    <input
                      type="number"
                      min="1"
                      value={p.units}
                      onChange={(e) => updateSplitPart(i, 'units', e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5 w-24"
                      placeholder="Units"
                    />
                    <input
                      type="text"
                      value={p.location}
                      onChange={(e) => updateSplitPart(i, 'location', e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5 flex-1"
                      placeholder="Location"
                    />
                    {splitParts.length > 2 && (
                      <button onClick={() => removeSplitPart(i)} className="text-gray-500 hover:text-red-400"><X size={14} /></button>
                    )}
                  </div>
                ))}
                <button onClick={addSplitPart} className="text-xs text-blue-400 hover:text-blue-300">+ Add another part</button>
              </div>
              <div className={`text-sm flex justify-between px-3 py-2 rounded-lg border ${
                splitValid ? 'bg-green-500/10 border-green-500/20 text-green-300' : 'bg-red-500/10 border-red-500/20 text-red-300'
              }`}>
                <span>Sum of parts: {splitSum}</span>
                <span>Required: {Number(splitTarget.units || 0)}</span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => { setShowSplitModal(false); setSplitTarget(null) }} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
              <button
                onClick={handleSplit}
                disabled={!splitValid || actionLoading}
                className="bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
              >
                <Check size={14} /> {actionLoading ? 'Splitting...' : 'Confirm Split'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MOVE MODAL ─── */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Move size={16} className="text-blue-400" /> Move Pallets</h3>
              <button onClick={() => setShowMoveModal(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-400">Move {selectedDocs.length} item(s) to a new location.</p>
              <input
                type="text"
                value={moveLocation}
                onChange={(e) => setMoveLocation(e.target.value)}
                placeholder="e.g. A-12-03"
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2"
              />
              <div className="bg-gray-800/50 rounded-lg p-3 space-y-1 text-xs font-mono max-h-48 overflow-y-auto">
                {selectedDocs.map(d => (
                  <div key={d.id} className="flex justify-between text-gray-300">
                    <span>{d.palletId} · {d.sku}</span>
                    <span>{d.location || 'no loc'} → <span className="text-blue-400">{moveLocation || '?'}</span></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowMoveModal(false)} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
              <button
                onClick={handleMove}
                disabled={!moveLocation.trim() || actionLoading}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
              >
                <Check size={14} /> {actionLoading ? 'Moving...' : 'Confirm Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Scanner ─── */}
      {showScanner && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}
