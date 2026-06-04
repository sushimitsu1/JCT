import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, orderBy,
  runTransaction, serverTimestamp, writeBatch
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import jsPDF from 'jspdf'
import {
  Waves, Plus, X, ChevronDown, ChevronRight, Package, Truck, Printer,
  CheckCircle, AlertTriangle, Search, RefreshCw, FileText, Trash2,
  Zap, Eye, EyeOff, Users, MapPin, Layers
} from 'lucide-react'

const STATUSES = [
  { id: 'pending',  label: 'Pending',  color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  { id: 'picking',  label: 'Picking',  color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  { id: 'staged',   label: 'Staged',   color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  { id: 'shipped',  label: 'Shipped',  color: 'bg-green-500/10 text-green-400 border-green-500/20' },
]

// Reserve a wave number from system/counters (similar to palletId pattern)
async function reserveWaveNumber() {
  const ref = doc(db, 'system', 'counters')
  let newNumber = 0
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.exists() ? Number(snap.data().waveNumber || 0) : 0
    newNumber = current + 1
    tx.set(ref, { waveNumber: newNumber }, { merge: true })
  })
  return `W-${String(newNumber).padStart(6, '0')}`
}

export default function WaveManagement() {
  const { user, userName } = useAuth()
  const [waves, setWaves] = useState([])
  const [orders, setOrders] = useState([])
  const [clients, setClients] = useState([])
  const [pickers, setPickers] = useState([])
  const [inventory, setInventory] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)

  // View state
  const [view, setView] = useState('list')  // 'list' | 'create' | 'detail'
  const [selectedWave, setSelectedWave] = useState(null)
  const [waveViewMode, setWaveViewMode] = useState('aggregate') // 'aggregate' | 'per-order'

  // Filters
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')

  // Create wave state
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set())
  const [creating, setCreating] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setRefreshing(true)
    try {
      const [wavesSnap, ordersSnap, clientsSnap, pickersSnap, invSnap] = await Promise.all([
        getDocs(query(collection(db, 'waves'), orderBy('createdAt', 'desc'))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'pickers')).catch(() => ({ docs: [] })),
        getDocs(collection(db, 'inventory')),
      ])
      const wavesData = (wavesSnap.docs || []).map(d => ({ id: d.id, ...d.data() }))
      const ordersData = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setWaves(wavesData)
      setOrders(ordersData)
      setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setPickers((pickersSnap.docs || []).map(d => ({ id: d.id, ...d.data() })))
      setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      // Refresh selectedWave from new data
      if (selectedWave) {
        const refreshed = wavesData.find(w => w.id === selectedWave.id)
        if (refreshed) setSelectedWave(refreshed)
      }
    } catch (e) {
      console.error('Failed to load wave data', e)
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [selectedWave?.id])

  useEffect(() => { fetchData() }, [])

  const clientName = (id) => clients.find(c => c.id === id)?.companyName || id || '—'

  // Orders eligible to be added to a wave (pending or picking, not already in a wave)
  const wavedOrderIds = useMemo(() => {
    const ids = new Set()
    waves.filter(w => w.status !== 'shipped').forEach(w => (w.orderIds || []).forEach(id => ids.add(id)))
    return ids
  }, [waves])

  const eligibleOrders = useMemo(() => {
    return orders.filter(o =>
      (o.status === 'pending' || o.status === 'picking') &&
      !wavedOrderIds.has(o.id)
    )
  }, [orders, wavedOrderIds])

  const filteredWaves = useMemo(() => {
    return waves.filter(w => {
      if (filterStatus && w.status !== filterStatus) return false
      if (search) {
        const s = search.toLowerCase()
        const orderRefs = (w.orderIds || []).map(id => {
          const o = orders.find(or => or.id === id)
          return o ? (o.orderNumber || o.id) : id
        }).join(' ')
        const hay = [w.waveNumber, w.pickedByName, orderRefs].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [waves, filterStatus, search, orders])

  // ─── Auto-suggest waves ───
  // Groups eligible orders by client + earliest ship date
  const suggestedWaves = useMemo(() => {
    const groups = new Map()
    eligibleOrders.forEach(o => {
      const key = `${o.clientId}__${o.earliestShipDate || o.orderDate || 'any'}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          clientId: o.clientId,
          clientName: o.clientName || clientName(o.clientId),
          shipDate: o.earliestShipDate || o.orderDate || '',
          orderIds: [],
          totalUnits: 0,
        })
      }
      const g = groups.get(key)
      g.orderIds.push(o.id)
      g.totalUnits += (o.inventoryAllocations || []).reduce((s, a) => s + Number(a.unitsAllocated || 0), 0)
    })
    return Array.from(groups.values()).filter(g => g.orderIds.length >= 2)
  }, [eligibleOrders, clients])

  // ─── Wave detail computations ───
  const waveOrders = useMemo(() => {
    if (!selectedWave) return []
    return (selectedWave.orderIds || []).map(id => orders.find(o => o.id === id)).filter(Boolean)
  }, [selectedWave, orders])

  const aggregatePickList = useMemo(() => {
    // Combine inventoryAllocations across all wave orders, grouped by pallet
    const map = new Map()
    waveOrders.forEach(o => {
      (o.inventoryAllocations || []).forEach(a => {
        const key = a.palletId || a.inventoryId
        if (!map.has(key)) {
          map.set(key, {
            palletId: a.palletId,
            inventoryId: a.inventoryId,
            sku: a.sku,
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
    return Array.from(map.values()).sort((a, b) => (a.sku || '').localeCompare(b.sku || ''))
  }, [waveOrders, clients])

  const totalWaveUnits = aggregatePickList.reduce((s, p) => s + p.totalUnits, 0)
  const totalWavePallets = aggregatePickList.length

  // ─── Actions ───────────────────────────────────────────────
  const toggleOrderSelect = (id) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const createWave = async () => {
    if (selectedOrderIds.size === 0) return
    setCreating(true)
    try {
      const waveNumber = await reserveWaveNumber()
      const ids = Array.from(selectedOrderIds)
      const waveOrders = orders.filter(o => ids.includes(o.id))
      const totalUnits = waveOrders.reduce((s, o) =>
        s + (o.inventoryAllocations || []).reduce((ss, a) => ss + Number(a.unitsAllocated || 0), 0), 0)
      await addDoc(collection(db, 'waves'), {
        waveNumber,
        status: 'pending',
        orderIds: ids,
        orderCount: ids.length,
        totalUnits,
        pickedBy: null,
        pickedByName: null,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid || null,
        createdByName: userName || null,
      })
      setSelectedOrderIds(new Set())
      setView('list')
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Failed to create wave: ' + e.message)
    } finally {
      setCreating(false)
    }
  }

  const createSuggestedWave = async (suggestion) => {
    setCreating(true)
    try {
      const waveNumber = await reserveWaveNumber()
      const waveOrders = orders.filter(o => suggestion.orderIds.includes(o.id))
      const totalUnits = waveOrders.reduce((s, o) =>
        s + (o.inventoryAllocations || []).reduce((ss, a) => ss + Number(a.unitsAllocated || 0), 0), 0)
      await addDoc(collection(db, 'waves'), {
        waveNumber,
        status: 'pending',
        orderIds: suggestion.orderIds,
        orderCount: suggestion.orderIds.length,
        totalUnits,
        pickedBy: null,
        pickedByName: null,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid || null,
        createdByName: userName || null,
        autoSuggested: true,
      })
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Failed to create wave: ' + e.message)
    } finally {
      setCreating(false)
    }
  }

  const updateWaveStatus = async (wave, newStatus) => {
    setActionLoading(true)
    try {
      const fields = { status: newStatus }
      if (newStatus === 'picking') fields.pickingStartedAt = new Date().toISOString()
      if (newStatus === 'staged')  fields.stagedAt = new Date().toISOString()
      if (newStatus === 'shipped') {
        fields.shippedAt = new Date().toISOString()
        fields.shippedBy = user?.uid || null
        fields.shippedByName = userName || null
        if (!wave.pickedAt) fields.pickedAt = new Date().toISOString()
        // Also ship every order in the wave
        const batch = writeBatch(db)
        for (const orderId of (wave.orderIds || [])) {
          batch.update(doc(db, 'orders', orderId), {
            status: 'shipped',
            shippedAt: new Date().toISOString(),
            shippedBy: user?.uid || null,
            shippedByName: userName || null,
            pickedAt: wave.pickedAt || new Date().toISOString(),
            pickedBy: wave.pickedBy || null,
            pickedByName: wave.pickedByName || null,
            waveId: wave.id,
            waveNumber: wave.waveNumber,
          })
        }
        await batch.commit()
      } else if (newStatus === 'picking') {
        // Mark member orders as 'picking' too
        const batch = writeBatch(db)
        for (const orderId of (wave.orderIds || [])) {
          const order = orders.find(o => o.id === orderId)
          if (order && order.status === 'pending') {
            batch.update(doc(db, 'orders', orderId), {
              status: 'picking',
              waveId: wave.id,
              waveNumber: wave.waveNumber,
            })
          }
        }
        await batch.commit()
      }
      await updateDoc(doc(db, 'waves', wave.id), fields)
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Status update failed: ' + e.message)
    } finally {
      setActionLoading(false)
    }
  }

  const assignPicker = async (wave, pickerId) => {
    const picker = pickers.find(p => p.id === pickerId)
    await updateDoc(doc(db, 'waves', wave.id), {
      pickedBy: pickerId || null,
      pickedByName: picker?.name || null,
    })
    await fetchData()
  }

  const removeOrderFromWave = async (wave, orderId) => {
    if (wave.status === 'shipped') return
    if (!confirm('Remove this order from the wave?')) return
    const newOrderIds = (wave.orderIds || []).filter(id => id !== orderId)
    if (newOrderIds.length === 0) {
      if (!confirm('This would empty the wave. Delete the wave instead?')) return
      await deleteDoc(doc(db, 'waves', wave.id))
      setSelectedWave(null)
      setView('list')
    } else {
      await updateDoc(doc(db, 'waves', wave.id), { orderIds: newOrderIds, orderCount: newOrderIds.length })
    }
    // Also clear the order's waveId
    await updateDoc(doc(db, 'orders', orderId), { waveId: null, waveNumber: null })
    await fetchData()
  }

  const deleteWave = async (wave) => {
    if (wave.status === 'shipped') {
      alert('Cannot delete a shipped wave (preserves history).')
      return
    }
    if (!confirm(`Delete wave ${wave.waveNumber}? Member orders will return to standalone status.`)) return
    setActionLoading(true)
    try {
      const batch = writeBatch(db)
      for (const orderId of (wave.orderIds || [])) {
        batch.update(doc(db, 'orders', orderId), { waveId: null, waveNumber: null })
      }
      await batch.commit()
      await deleteDoc(doc(db, 'waves', wave.id))
      setSelectedWave(null)
      setView('list')
      await fetchData()
    } catch (e) {
      console.error(e)
      alert('Delete failed: ' + e.message)
    } finally {
      setActionLoading(false)
    }
  }

  // ─── Render helpers ───
  const StatusBadge = ({ status }) => {
    const s = STATUSES.find(x => x.id === status) || STATUSES[0]
    return <span className={`text-xs px-2 py-0.5 rounded-full border ${s.color}`}>{s.label}</span>
  }


  const generateWavePickTicketPDF = () => {
    if (!selectedWave) return
    const w = selectedWave
    const pdf = new jsPDF()
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    let y = 0

    // Header banner
    pdf.setFillColor(200, 16, 46); pdf.rect(0, 0, pw, 18, 'F')
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.setFont('helvetica', 'bold')
    pdf.text('Wave Pick Ticket', pw / 2, 12, { align: 'center' })

    // Wave info block
    pdf.setTextColor(200, 16, 46); pdf.setFontSize(14)
    pdf.text(w.waveNumber, 14, 28)
    pdf.setFontSize(9); pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal')
    pdf.text('Warehouse: JCT LOGISTICS INC.', 14, 35)
    pdf.text(`Picker: ${w.pickedByName || '________________'}`, 14, 41)
    pdf.text(`Date: ${new Date().toLocaleDateString()}`, 14, 47)

    pdf.setTextColor(27, 42, 74); pdf.setFontSize(9)
    pdf.text(`Total Orders: ${w.orderCount}`, pw - 14, 28, { align: 'right' })
    pdf.text(`Total Pallets: ${totalWavePallets}`, pw - 14, 34, { align: 'right' })
    pdf.text(`Total Units: ${totalWaveUnits}`, pw - 14, 40, { align: 'right' })
    pdf.text(`Status: ${w.status.toUpperCase()}`, pw - 14, 46, { align: 'right' })

    // Orders summary line
    y = 56
    pdf.setDrawColor(220, 220, 220); pdf.line(14, y - 2, pw - 14, y - 2)
    pdf.setFontSize(8); pdf.setTextColor(100, 100, 100)
    const orderNums = waveOrders.map(o => o.orderNumber || o.id.slice(-6)).join(', ')
    const ordersLine = `Orders: ${orderNums}`
    const wrapped = pdf.splitTextToSize(ordersLine, pw - 28)
    pdf.text(wrapped, 14, y)
    y += wrapped.length * 4 + 4

    // Build grouped pick list: by SKU, then by location
    const palletInvMap = new Map()
    inventory.forEach(inv => { if (inv.palletId) palletInvMap.set(inv.palletId, inv) })
    const enriched = aggregatePickList.map(p => {
      const inv = palletInvMap.get(p.palletId)
      return { ...p, location: inv?.location || '' }
    })
    const bySku = new Map()
    enriched.forEach(p => {
      if (!bySku.has(p.sku)) bySku.set(p.sku, [])
      bySku.get(p.sku).push(p)
    })
    // Sort each SKU group by location
    bySku.forEach(arr => arr.sort((a, b) => (a.location || '').localeCompare(b.location || '')))
    const sortedSkus = Array.from(bySku.keys()).sort((a, b) => a.localeCompare(b))

    // Table header
    pdf.setFillColor(27, 42, 74); pdf.rect(14, y, pw - 28, 7, 'F')
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
    pdf.text('?', 17, y + 5)
    pdf.text('PALLET', 26, y + 5)
    pdf.text('LOCATION', 60, y + 5)
    pdf.text('UNITS', 95, y + 5)
    pdf.text('DISTRIBUTE TO (ORDER / UNITS)', 115, y + 5)
    y += 11

    pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)

    sortedSkus.forEach(sku => {
      // SKU group header
      if (y > ph - 25) { pdf.addPage(); y = 20 }
      pdf.setFillColor(240, 240, 240); pdf.rect(14, y - 4, pw - 28, 6, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
      pdf.text(`SKU: ${sku}`, 17, y)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
      y += 5

      bySku.get(sku).forEach(p => {
        const dist = p.orderRefs.map(r => `${r.orderNumber} (${r.units}u)`).join(', ')
        const distLines = pdf.splitTextToSize(dist, 80)
        const rowH = Math.max(6, distLines.length * 3.5 + 2)

        if (y + rowH > ph - 15) { pdf.addPage(); y = 20 }

        // Checkbox
        pdf.setDrawColor(27, 42, 74)
        pdf.rect(17, y - 3, 3, 3)
        // Pallet ID
        pdf.text(p.palletId || '-', 26, y)
        // Location
        pdf.text(p.location || '-', 60, y)
        // Units (bold)
        pdf.setFont('helvetica', 'bold')
        pdf.text(String(p.totalUnits), 95, y)
        pdf.setFont('helvetica', 'normal')
        // Distribution
        pdf.text(distLines, 115, y)

        // Light row separator
        pdf.setDrawColor(230, 230, 230)
        pdf.line(14, y + rowH - 4, pw - 14, y + rowH - 4)
        y += rowH
      })
      y += 2
    })

    // Footer signature lines
    if (y > ph - 30) { pdf.addPage(); y = 20 }
    y = ph - 25
    pdf.setDrawColor(27, 42, 74)
    pdf.line(14, y, 80, y); pdf.text('Picked by', 14, y + 4)
    pdf.line(90, y, 156, y); pdf.text('Checked by', 90, y + 4)
    pdf.line(166, y, pw - 14, y); pdf.text('Date', 166, y + 4)

    pdf.save(`Wave-${w.waveNumber}-PickTicket.pdf`)
  }

  if (loading) return <div className="p-6 text-gray-500 text-sm">Loading waves...</div>

  // ════════════════════════ DETAIL VIEW ════════════════════════
  if (view === 'detail' && selectedWave) {
    const w = selectedWave
    return (
      <div className="space-y-4">
        {/* Detail header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('list'); setSelectedWave(null) }} className="text-gray-400 hover:text-white text-sm">← Back to waves</button>
            <span className="text-white font-semibold text-lg font-mono">{w.waveNumber}</span>
            <StatusBadge status={w.status} />
            <span className="text-xs text-gray-500">{w.orderCount} orders | {totalWavePallets} pallets | {totalWaveUnits} units</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={generateWavePickTicketPDF}
              className="flex items-center gap-1.5 text-sm bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-600/20 px-3 py-1.5 rounded-lg transition-colors">
              <Printer size={12} /> Pick Ticket
            </button>
            {w.status === 'pending' && (
              <button onClick={() => updateWaveStatus(w, 'picking')} disabled={actionLoading}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1">
                <Zap size={12} /> Start Picking
              </button>
            )}
            {w.status === 'picking' && (
              <button onClick={() => updateWaveStatus(w, 'staged')} disabled={actionLoading}
                className="bg-purple-600 hover:bg-purple-500 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1">
                <Layers size={12} /> Mark Staged
              </button>
            )}
            {w.status === 'staged' && (
              <button onClick={() => updateWaveStatus(w, 'shipped')} disabled={actionLoading}
                className="bg-green-600 hover:bg-green-500 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1">
                <CheckCircle size={12} /> Ship Wave (ships {w.orderCount} order{w.orderCount !== 1 ? 's' : ''})
              </button>
            )}
            {w.status !== 'shipped' && (
              <button onClick={() => deleteWave(w)} disabled={actionLoading}
                className="bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 text-xs px-2 py-1.5 rounded-lg flex items-center gap-1">
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
        </div>

        {/* Picker assignment */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400">Picker:</span>
          <select
            value={w.pickedBy || ''}
            disabled={w.status === 'shipped'}
            onChange={(e) => assignPicker(w, e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-2 py-1 flex-1 max-w-xs disabled:opacity-60"
          >
            <option value="">-- Unassigned --</option>
            {pickers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {w.pickedAt && <span className="text-xs text-gray-500">Picked: {new Date(w.pickedAt).toLocaleString()}</span>}
          {w.stagedAt && <span className="text-xs text-gray-500">Staged: {new Date(w.stagedAt).toLocaleString()}</span>}
          {w.shippedByName && <span className="text-xs text-gray-500">Shipped by: {w.shippedByName}</span>}
        </div>

        {/* View mode toggle */}
        <div className="flex gap-1 border-b border-gray-800">
          {[
            { id: 'aggregate', label: 'Aggregate Pick List', icon: Layers },
            { id: 'per-order', label: 'Per-Order View', icon: FileText },
          ].map(t => {
            const Icon = t.icon
            const active = waveViewMode === t.id
            return (
              <button key={t.id} onClick={() => setWaveViewMode(t.id)}
                className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px ${
                  active ? 'border-red-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                }`}>
                <Icon size={14} /> {t.label}
              </button>
            )
          })}
        </div>

        {/* AGGREGATE PICK LIST */}
        {waveViewMode === 'aggregate' && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 text-sm text-gray-400 flex items-center justify-between">
              <span>{aggregatePickList.length} pallets to pick | {totalWaveUnits} total units across {waveOrders.length} order{waveOrders.length !== 1 ? 's' : ''}</span>
              <span className="text-xs text-gray-500">Sorted by SKU</span>
            </div>
            {aggregatePickList.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Package size={28} className="mx-auto mb-2 text-gray-700" />
                <p className="text-sm">No allocations in member orders</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Pallet</th>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-right">Units to Pick</th>
                      <th className="px-3 py-2 text-left">Distribute to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatePickList.map((p, i) => (
                      <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/40">
                        <td className="px-3 py-2 font-mono text-white text-xs">{p.palletId || '—'}</td>
                        <td className="px-3 py-2 font-mono text-white">{p.sku}</td>
                        <td className="px-3 py-2 text-right text-white font-semibold">{p.totalUnits}</td>
                        <td className="px-3 py-2 text-xs space-y-0.5">
                          {p.orderRefs.map((r, j) => (
                            <div key={j} className="text-gray-400">
                              <span className="font-mono text-gray-300">{r.orderNumber}</span>
                              <span className="text-gray-500"> | {r.clientName} | </span>
                                <span className="text-white">{r.units}u</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* PER-ORDER VIEW */}
        {waveViewMode === 'per-order' && (
          <div className="space-y-3">
            {waveOrders.length === 0 ? (
              <div className="p-8 text-center text-gray-500 bg-gray-900/50 border border-gray-800 rounded-lg">No orders</div>
            ) : waveOrders.map(o => {
              const allocs = o.inventoryAllocations || []
              const totalU = allocs.reduce((s, a) => s + Number(a.unitsAllocated || 0), 0)
              return (
                <div key={o.id} className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-mono">{o.orderNumber || o.id.slice(-6)}</span>
                      <StatusBadge status={o.status} />
                      <span className="text-xs text-gray-400">{o.clientName || clientName(o.clientId)}</span>
                      {o.earliestShipDate && <span className="text-xs text-gray-500">Ship: {o.earliestShipDate}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{allocs.length} pallets | {totalU} units</span>
                      {w.status !== 'shipped' && (
                        <button onClick={() => removeOrderFromWave(w, o.id)}
                          className="text-xs text-red-400 hover:text-red-300 px-1.5 py-0.5"
                          title="Remove from wave"
                        ><X size={12} /></button>
                      )}
                    </div>
                  </div>
                  {allocs.length > 0 && (
                    <table className="w-full text-xs">
                      <thead className="text-gray-400 uppercase">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Pallet</th>
                          <th className="px-3 py-1.5 text-left">SKU</th>
                          <th className="px-3 py-1.5 text-right">Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocs.map((a, i) => (
                          <tr key={i} className="border-t border-gray-800/60">
                            <td className="px-3 py-1.5 font-mono text-gray-300">{a.palletId}</td>
                            <td className="px-3 py-1.5 font-mono text-white">{a.sku}</td>
                            <td className="px-3 py-1.5 text-right text-white">{a.unitsAllocated}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ════════════════════════ CREATE VIEW ════════════════════════
  if (view === 'create') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('list'); setSelectedOrderIds(new Set()) }} className="text-gray-400 hover:text-white text-sm">← Back to waves</button>
            <span className="text-white font-semibold">Create new wave</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{selectedOrderIds.size} order{selectedOrderIds.size !== 1 ? 's' : ''} selected</span>
            <button onClick={createWave} disabled={selectedOrderIds.size === 0 || creating}
              className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
              <CheckCircle size={14} /> {creating ? 'Creating...' : 'Create Wave'}
            </button>
          </div>
        </div>

        {/* Suggested waves */}
        {suggestedWaves.length > 0 && (
          <div className="bg-blue-950/20 border border-blue-500/20 rounded-lg p-3">
            <div className="text-xs text-blue-400 font-medium mb-2 flex items-center gap-1.5">
              <Zap size={12} /> Suggested waves (grouped by client + ship date)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {suggestedWaves.map(s => (
                <div key={s.key} className="bg-gray-900/50 border border-gray-800 rounded-lg p-2.5">
                  <div className="text-sm text-white font-medium truncate">{s.clientName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {s.orderIds.length} orders | {s.totalUnits} units {s.shipDate && `| Ship ${s.shipDate}`}
                  </div>
                  <button onClick={() => createSuggestedWave(s)} disabled={creating}
                    className="mt-2 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded w-full">
                    Create wave
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Eligible orders */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 text-sm text-gray-400">
            {eligibleOrders.length} eligible order{eligibleOrders.length !== 1 ? 's' : ''} (pending or picking, not already in a wave)
          </div>
          {eligibleOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Package size={28} className="mx-auto mb-2 text-gray-700" />
              <p className="text-sm">No eligible orders</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left">Order</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Ship Date</th>
                    <th className="px-3 py-2 text-right">Pallets</th>
                    <th className="px-3 py-2 text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleOrders.map(o => {
                    const allocs = o.inventoryAllocations || []
                    const totalU = allocs.reduce((s, a) => s + Number(a.unitsAllocated || 0), 0)
                    const sel = selectedOrderIds.has(o.id)
                    return (
                      <tr key={o.id} onClick={() => toggleOrderSelect(o.id)}
                        className={`border-t border-gray-800 cursor-pointer ${sel ? 'bg-blue-950/30' : 'hover:bg-gray-800/40'}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={sel} onChange={() => toggleOrderSelect(o.id)} className="accent-blue-500" />
                        </td>
                        <td className="px-3 py-2 font-mono text-white">{o.orderNumber || o.id.slice(-6)}</td>
                        <td className="px-3 py-2 text-gray-300">{o.clientName || clientName(o.clientId)}</td>
                        <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{o.earliestShipDate || '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-300">{allocs.length}</td>
                        <td className="px-3 py-2 text-right text-white font-medium">{totalU}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ════════════════════════ LIST VIEW ════════════════════════
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {STATUSES.map(s => {
            const count = waves.filter(w => w.status === s.id).length
            const active = filterStatus === s.id
            return (
              <button key={s.id}
                onClick={() => setFilterStatus(active ? '' : s.id)}
                className={`text-xs px-2 py-1 rounded-full border ${active ? s.color : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>
                {s.label} ({count})
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} disabled={refreshing}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => { setSelectedOrderIds(new Set()); setView('create') }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5">
            <Plus size={14} /> New Wave
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input type="text" placeholder="Search wave # or picker..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500" />
      </div>

      {/* Waves table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 text-sm text-gray-400">
          {filteredWaves.length} wave{filteredWaves.length !== 1 ? 's' : ''}
        </div>
        {filteredWaves.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Waves size={40} className="mx-auto mb-3 text-gray-700" />
            <p>{waves.length === 0 ? 'No waves yet — create one to batch-pick multiple orders' : 'No waves match your filters'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Wave #</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-left">Picker</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWaves.map(w => (
                  <tr key={w.id} className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer"
                    onClick={() => { setSelectedWave(w); setView('detail'); setWaveViewMode('aggregate') }}>
                    <td className="px-3 py-2 font-mono text-white">
                      {w.waveNumber}
                      {w.autoSuggested && <span className="ml-2 text-[10px] text-blue-400">AUTO</span>}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={w.status} /></td>
                    <td className="px-3 py-2 text-right text-gray-300">{w.orderCount}</td>
                    <td className="px-3 py-2 text-right text-white font-medium">{w.totalUnits}</td>
                    <td className="px-3 py-2 text-gray-300">{w.pickedByName || <span className="text-gray-600">—</span>}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedWave(w); setView('detail'); setWaveViewMode('aggregate') }}
                        className="text-xs text-blue-400 hover:text-blue-300">Open →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
