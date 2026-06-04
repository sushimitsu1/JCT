import { useState, useMemo, useEffect } from 'react'
import { doc, updateDoc, writeBatch, arrayUnion } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import {
  Waves, ArrowLeft, RefreshCw, Search, ScanLine, CheckCircle,
  Package, MapPin, Layers, FileText, AlertTriangle, X, Truck, Zap
} from 'lucide-react'
import BarcodeScanner from '../components/BarcodeScanner'

const STATUS_COLORS = {
  pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Pending' },
  picking: { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: 'Picking' },
  staged:  { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'Staged'  },
  shipped: { bg: 'bg-green-500/15',  text: 'text-green-400',  label: 'Shipped' },
}

export default function MobileWaves({ waves, orders, inventory, clients, onRefresh, refreshing }) {
  const { user, userName } = useAuth()
  const [view, setView] = useState('list')   // 'list' | 'detail' | 'pick'
  const [selectedWaveId, setSelectedWaveId] = useState(null)
  const [filter, setFilter] = useState('mine')  // 'all' | 'mine' | 'active'
  const [search, setSearch] = useState('')
  const [waveViewMode, setWaveViewMode] = useState('aggregate')
  const [showScanner, setShowScanner] = useState(false)
  const [toast, setToast] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Look up the selected wave from the live array so it refreshes
  const selectedWave = useMemo(
    () => waves.find(w => w.id === selectedWaveId),
    [waves, selectedWaveId]
  )

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2200)
  }

  const clientName = (id) => clients.find(c => c.id === id)?.companyName || id || '—'

  // Filter & sort wave list
  const filteredWaves = useMemo(() => {
    return waves
      .filter(w => {
        if (filter === 'mine' && w.pickedBy !== user?.uid && w.pickedByName !== userName) return false
        if (filter === 'active' && (w.status === 'shipped' || w.status === 'cancelled')) return false
        if (search) {
          const s = search.toLowerCase()
          if (!(w.waveNumber || '').toLowerCase().includes(s) &&
              !(w.pickedByName || '').toLowerCase().includes(s)) return false
        }
        return true
      })
      .sort((a, b) => {
        // Active waves first, then by created date desc
        const aActive = a.status !== 'shipped' && a.status !== 'cancelled'
        const bActive = b.status !== 'shipped' && b.status !== 'cancelled'
        if (aActive !== bActive) return aActive ? -1 : 1
        return (b.createdAt || '').localeCompare(a.createdAt || '')
      })
  }, [waves, filter, search, user, userName])

  const waveOrders = useMemo(() => {
    if (!selectedWave) return []
    return (selectedWave.orderIds || []).map(id => orders.find(o => o.id === id)).filter(Boolean)
  }, [selectedWave, orders])

  // Build aggregate pick list with location data
  const aggregatePickList = useMemo(() => {
    const map = new Map()
    const palletInvMap = new Map()
    inventory.forEach(inv => { if (inv.palletId) palletInvMap.set(inv.palletId, inv) })
    waveOrders.forEach(o => {
      (o.inventoryAllocations || []).forEach(a => {
        const key = a.palletId || a.inventoryId
        if (!map.has(key)) {
          const inv = palletInvMap.get(a.palletId)
          map.set(key, {
            palletId: a.palletId,
            inventoryId: a.inventoryId,
            sku: a.sku,
            location: inv?.location || '',
            totalUnits: 0,
            orderRefs: [],
          })
        }
        const e = map.get(key)
        e.totalUnits += Number(a.unitsAllocated || 0)
        e.orderRefs.push({
          orderId: o.id,
          orderNumber: o.orderNumber || o.id.slice(-6),
          clientName: o.clientName || clientName(o.clientId),
          units: Number(a.unitsAllocated || 0),
        })
      })
    })
    return Array.from(map.values()).sort((a, b) => {
      const sku = (a.sku || '').localeCompare(b.sku || '')
      if (sku !== 0) return sku
      return (a.location || '').localeCompare(b.location || '')
    })
  }, [waveOrders, inventory, clients])

  const pickedSet = useMemo(() =>
    new Set((selectedWave?.pickedPalletIds || []).map(id => (id || '').toUpperCase())),
    [selectedWave]
  )

  const unpicked = useMemo(() =>
    aggregatePickList.filter(p => !pickedSet.has((p.palletId || '').toUpperCase())),
    [aggregatePickList, pickedSet]
  )
  const picked = useMemo(() =>
    aggregatePickList.filter(p => pickedSet.has((p.palletId || '').toUpperCase())),
    [aggregatePickList, pickedSet]
  )
  const progress = aggregatePickList.length === 0 ? 0
    : Math.round((picked.length / aggregatePickList.length) * 100)

  // ─── Actions ─────────────────────────────────────────────
  const startPicking = async () => {
    if (!selectedWave) return
    setActionLoading(true)
    try {
      // Auto-assign current user as picker if not already set
      const updates = {
        status: 'picking',
        pickingStartedAt: new Date().toISOString(),
      }
      if (!selectedWave.pickedBy) {
        updates.pickedBy = user?.uid || null
        updates.pickedByName = userName || null
      }
      await updateDoc(doc(db, 'waves', selectedWave.id), updates)
      // Cascade: pending member orders → picking
      const batch = writeBatch(db)
      for (const o of waveOrders) {
        if (o.status === 'pending') {
          batch.update(doc(db, 'orders', o.id), {
            status: 'picking',
            waveId: selectedWave.id,
            waveNumber: selectedWave.waveNumber,
          })
        }
      }
      await batch.commit()
      await onRefresh()
      setView('pick')
    } catch (e) {
      console.error(e)
      showToast('Failed to start picking', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const confirmPick = async (palletId) => {
    if (!selectedWave || !palletId) return
    const normalized = palletId.toUpperCase()
    const match = aggregatePickList.find(p => (p.palletId || '').toUpperCase() === normalized)
    if (!match) {
      showToast(`Pallet ${palletId} not in this wave`, 'error')
      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100])
      return false
    }
    if (pickedSet.has(normalized)) {
      showToast(`Pallet ${palletId} already picked`, 'warn')
      return false
    }
    try {
      await updateDoc(doc(db, 'waves', selectedWave.id), {
        pickedPalletIds: arrayUnion(match.palletId)
      })
      await onRefresh()
      showToast(`✓ ${match.palletId} · ${match.sku} (${match.totalUnits}u)`, 'success')
      if (navigator.vibrate) navigator.vibrate([80, 40, 80])
      return true
    } catch (e) {
      console.error(e)
      showToast('Failed to confirm pick', 'error')
      return false
    }
  }

  const undoPick = async (palletId) => {
    if (!selectedWave || !palletId) return
    if (!confirm(`Undo pick for ${palletId}?`)) return
    try {
      const newList = (selectedWave.pickedPalletIds || []).filter(id => id !== palletId)
      await updateDoc(doc(db, 'waves', selectedWave.id), { pickedPalletIds: newList })
      await onRefresh()
    } catch (e) {
      showToast('Failed to undo', 'error')
    }
  }

  const markStaged = async () => {
    if (!selectedWave) return
    setActionLoading(true)
    try {
      await updateDoc(doc(db, 'waves', selectedWave.id), {
        status: 'staged',
        stagedAt: new Date().toISOString(),
      })
      await onRefresh()
      setView('detail')
      showToast('Wave staged. Ready to ship.')
    } catch (e) {
      showToast('Failed to mark staged', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const shipWave = async () => {
    if (!selectedWave) return
    if (!confirm(`Ship wave ${selectedWave.waveNumber}? This will close all ${selectedWave.orderCount} member order(s).`)) return
    setActionLoading(true)
    try {
      const now = new Date().toISOString()
      const batch = writeBatch(db)
      for (const o of waveOrders) {
        batch.update(doc(db, 'orders', o.id), {
          status: 'shipped',
          shippedAt: now,
          shippedBy: user?.uid || null,
          shippedByName: userName || null,
          pickedAt: selectedWave.pickedAt || now,
          pickedBy: selectedWave.pickedBy || user?.uid || null,
          pickedByName: selectedWave.pickedByName || userName || null,
          waveId: selectedWave.id,
          waveNumber: selectedWave.waveNumber,
        })
      }
      batch.update(doc(db, 'waves', selectedWave.id), {
        status: 'shipped',
        shippedAt: now,
        shippedBy: user?.uid || null,
        shippedByName: userName || null,
      })
      await batch.commit()
      await onRefresh()
      setView('detail')
      showToast(`Wave ${selectedWave.waveNumber} shipped!`)
    } catch (e) {
      console.error(e)
      showToast('Ship failed: ' + e.message, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ════════════════ LIST VIEW ════════════════
  if (view === 'list') {
    const mineCount = waves.filter(w => (w.pickedBy === user?.uid || w.pickedByName === userName) && w.status !== 'shipped').length
    const activeCount = waves.filter(w => w.status !== 'shipped' && w.status !== 'cancelled').length
    return (
      <div className="h-full flex flex-col">
        <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-white text-xl font-bold flex items-center gap-2">
                <Waves size={20} className="text-blue-400" /> Waves
              </h1>
              <p className="text-gray-500 text-xs">{waves.length} total · {activeCount} active</p>
            </div>
            <button onClick={onRefresh} disabled={refreshing} className="p-2 rounded-xl bg-gray-800 text-gray-400">
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search wave # or picker..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm placeholder-gray-500"
            />
          </div>
          <div className="flex gap-1.5">
            {[
              { id: 'mine',   label: `Mine (${mineCount})` },
              { id: 'active', label: `Active (${activeCount})` },
              { id: 'all',    label: `All (${waves.length})` },
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`text-xs px-3 py-1.5 rounded-full ${
                  filter === f.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
                }`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {filteredWaves.length === 0 ? (
            <div className="text-center py-16">
              <Waves size={40} className="mx-auto mb-3 text-gray-700" />
              <p className="text-gray-500 text-sm">No waves match this filter</p>
            </div>
          ) : filteredWaves.map(w => {
            const sc = STATUS_COLORS[w.status] || STATUS_COLORS.pending
            const isMine = w.pickedBy === user?.uid || w.pickedByName === userName
            const pickedCount = (w.pickedPalletIds || []).length
            return (
              <button
                key={w.id}
                onClick={() => { setSelectedWaveId(w.id); setView('detail'); setWaveViewMode('aggregate') }}
                className="w-full text-left bg-gray-900 border border-gray-800 rounded-xl p-3 active:bg-gray-800"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-mono font-semibold">{w.waveNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    {isMine && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">MINE</span>}
                  </div>
                </div>
                <div className="text-xs text-gray-400 flex items-center gap-3 flex-wrap">
                  <span>{w.orderCount} orders</span>
                  <span>·</span>
                  <span>{w.totalUnits} units</span>
                  {w.pickedByName && <><span>·</span><span className="text-gray-300">{w.pickedByName}</span></>}
                </div>
                {w.status === 'picking' && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.round((pickedCount / Math.max(1, w.totalPallets || pickedCount)) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <Toast toast={toast} />
      </div>
    )
  }

  // ════════════════ DETAIL VIEW ════════════════
  if (view === 'detail' && selectedWave) {
    const sc = STATUS_COLORS[selectedWave.status] || STATUS_COLORS.pending
    const totalUnits = aggregatePickList.reduce((s, p) => s + p.totalUnits, 0)
    return (
      <div className="h-full flex flex-col">
        <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => { setView('list'); setSelectedWaveId(null) }} className="p-1.5 -ml-1.5 text-gray-400">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1">
              <div className="text-white font-mono font-semibold">{selectedWave.waveNumber}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                <span className="text-xs text-gray-500">{aggregatePickList.length} pallets · {totalUnits} units</span>
              </div>
            </div>
          </div>
          {selectedWave.pickedByName && (
            <div className="text-xs text-gray-400 mb-2">Picker: <span className="text-white">{selectedWave.pickedByName}</span></div>
          )}
          {/* View mode toggle */}
          <div className="flex gap-1.5">
            {[
              { id: 'aggregate', label: 'Aggregate', icon: Layers },
              { id: 'per-order', label: 'Per-Order', icon: FileText },
            ].map(t => {
              const Icon = t.icon
              const active = waveViewMode === t.id
              return (
                <button key={t.id} onClick={() => setWaveViewMode(t.id)}
                  className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full ${
                    active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
                  }`}>
                  <Icon size={11} /> {t.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
          {waveViewMode === 'aggregate' && (
            aggregatePickList.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">No allocations</div>
            ) : (
              <div className="space-y-2">
                {aggregatePickList.map((p, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-white text-sm">{p.palletId || '-'}</span>
                      <span className="text-white font-semibold">{p.totalUnits}u</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <span className="font-mono text-gray-300">{p.sku}</span>
                      {p.location && <><span>·</span><MapPin size={10} /> <span>{p.location}</span></>}
                    </div>
                    {p.orderRefs.map((r, j) => (
                      <div key={j} className="text-[11px] text-gray-500">
                        → {r.orderNumber} ({r.clientName}) · {r.units}u
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          )}
          {waveViewMode === 'per-order' && (
            waveOrders.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">No orders</div>
            ) : (
              <div className="space-y-3">
                {waveOrders.map(o => {
                  const allocs = o.inventoryAllocations || []
                  const oTotal = allocs.reduce((s, a) => s + Number(a.unitsAllocated || 0), 0)
                  return (
                    <div key={o.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-white text-sm">{o.orderNumber || o.id.slice(-6)}</span>
                        <span className="text-xs text-gray-400">{allocs.length}p · {oTotal}u</span>
                      </div>
                      <div className="text-xs text-gray-400 mb-2">{o.clientName || clientName(o.clientId)}</div>
                      {allocs.map((a, i) => (
                        <div key={i} className="text-[11px] text-gray-500 font-mono">
                          {a.palletId} · {a.sku} · {a.unitsAllocated}u
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>

        {/* Sticky action bar */}
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/95 backdrop-blur flex-shrink-0">
          {selectedWave.status === 'pending' && (
            <button onClick={startPicking} disabled={actionLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              <Zap size={16} /> Start Picking
            </button>
          )}
          {selectedWave.status === 'picking' && (
            <button onClick={() => setView('pick')}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              <ScanLine size={16} /> Continue Picking ({picked.length}/{aggregatePickList.length})
            </button>
          )}
          {selectedWave.status === 'staged' && (
            <button onClick={shipWave} disabled={actionLoading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              <Truck size={16} /> Ship Wave ({selectedWave.orderCount} orders)
            </button>
          )}
          {selectedWave.status === 'shipped' && (
            <div className="text-center text-gray-500 text-xs py-2">Wave shipped on {selectedWave.shippedAt ? new Date(selectedWave.shippedAt).toLocaleString() : '—'}</div>
          )}
        </div>
        <Toast toast={toast} />
      </div>
    )
  }

  // ════════════════ PICK MODE ════════════════
  if (view === 'pick' && selectedWave) {
    const allPicked = unpicked.length === 0 && aggregatePickList.length > 0
    return (
      <div className="h-full flex flex-col">
        <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setView('detail')} className="p-1.5 -ml-1.5 text-gray-400">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1">
              <div className="text-white font-mono font-semibold text-sm">{selectedWave.waveNumber}</div>
              <div className="text-xs text-gray-400">{picked.length} of {aggregatePickList.length} pallets picked</div>
            </div>
            <div className="text-white text-xl font-bold">{progress}%</div>
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 pb-32">
          {unpicked.length > 0 && (
            <>
              <div className="text-xs text-gray-400 uppercase font-medium mb-2 mt-1">To pick ({unpicked.length})</div>
              <div className="space-y-2 mb-4">
                {unpicked.map((p, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-white text-sm font-semibold">{p.palletId}</span>
                      <span className="text-white font-semibold">{p.totalUnits}u</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-1.5">
                      <span className="font-mono text-gray-300">{p.sku}</span>
                      {p.location && <><span>·</span><MapPin size={10} /> <span>{p.location}</span></>}
                    </div>
                    <button onClick={() => confirmPick(p.palletId)}
                      className="text-xs text-blue-400 hover:text-blue-300 mt-1">
                      Tap to confirm (no scan)
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {picked.length > 0 && (
            <>
              <div className="text-xs text-gray-400 uppercase font-medium mb-2">Picked ({picked.length})</div>
              <div className="space-y-1.5">
                {picked.map((p, i) => (
                  <div key={i} className="bg-green-950/30 border border-green-500/20 rounded-xl p-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="font-mono text-white text-xs">{p.palletId}</span>
                        <span className="text-gray-500 text-xs ml-2">{p.sku} · {p.totalUnits}u</span>
                      </div>
                    </div>
                    <button onClick={() => undoPick(p.palletId)} className="text-[10px] text-gray-500 hover:text-red-400 px-2">
                      Undo
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {allPicked && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mt-4 text-center">
              <CheckCircle size={28} className="mx-auto mb-2 text-green-400" />
              <p className="text-green-300 text-sm font-medium">All pallets picked!</p>
              <p className="text-green-400/70 text-xs mt-1">Ready to stage</p>
            </div>
          )}
        </div>

        {/* Sticky scan + stage buttons */}
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/95 backdrop-blur flex-shrink-0 space-y-2">
          {!allPicked && (
            <button onClick={() => setShowScanner(true)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              <ScanLine size={18} /> Scan Pallet
            </button>
          )}
          {allPicked && (
            <button onClick={markStaged} disabled={actionLoading}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              <Layers size={16} /> Mark Staged
            </button>
          )}
        </div>

        {showScanner && (
          <BarcodeScanner
            onScan={async (code) => {
              setShowScanner(false)
              await confirmPick(code)
            }}
            onClose={() => setShowScanner(false)}
          />
        )}
        <Toast toast={toast} />
      </div>
    )
  }

  return null
}

function Toast({ toast }) {
  if (!toast) return null
  const colors = {
    success: 'bg-green-500/90 text-white',
    error:   'bg-red-500/90 text-white',
    warn:    'bg-yellow-500/90 text-white',
  }
  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 flex justify-center pointer-events-none">
      <div className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${colors[toast.type] || colors.success}`}>
        {toast.msg}
      </div>
    </div>
  )
}
