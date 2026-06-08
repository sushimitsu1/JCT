import { useState, useMemo } from 'react'
import {
  Tag, Package, ShoppingCart, PackagePlus, X, Search,
  ArrowDown, ArrowUp, ArrowLeftRight, Download
} from 'lucide-react'
import * as XLSX from 'xlsx'

// ─── Helpers ───────────────────────────────────────────────
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
const fmtDate = (d) => d ? d.toLocaleDateString() : '-'
const fmtDateTime = (d) => d ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-'
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }

// ─── Main ───────────────────────────────────────────────────
export default function ReportItems({ inventory, receipts, orders, items, palletHistory, clients }) {
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [selectedSku, setSelectedSku] = useState(null)

  // Build per-SKU summary
  const skuRows = useMemo(() => {
    const map = new Map()

    // Seed from catalog
    items.forEach(it => {
      const key = `${it.clientId || ''}__${it.sku || ''}`
      map.set(key, {
        key,
        clientId: it.clientId,
        clientName: clients.find(c => c.id === it.clientId)?.companyName || '',
        sku: it.sku,
        description: it.description || '',
        unitsPerPallet: Number(it.unitsPerPallet || 0),
        currentStock: 0,
        currentPallets: 0,
        lastReceived: null,
        lastShipped: null,
        units30d: 0,
        orders30d: new Set(),
        receipts30d: 0,
      })
    })

    // Current inventory
    inventory.forEach(inv => {
      const key = `${inv.clientId || ''}__${inv.sku || ''}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          clientId: inv.clientId,
          clientName: inv.clientName || clients.find(c => c.id === inv.clientId)?.companyName || '',
          sku: inv.sku,
          description: inv.description || '',
          unitsPerPallet: 0,
          currentStock: 0,
          currentPallets: 0,
          lastReceived: null,
          lastShipped: null,
          units30d: 0,
          orders30d: new Set(),
          receipts30d: 0,
        })
      }
      const e = map.get(key)
      e.currentStock += Number(inv.units || inv.quantity || 0)
      e.currentPallets += 1
    })

    // Receipts
    const last30 = daysAgo(30)
    receipts.forEach(r => {
      const rDate = toDate(r.receivedDate) || toDate(r.confirmedAt) || toDate(r.createdAt)
      ;(r.lineItems || []).forEach(li => {
        if (!li.sku) return
        const key = `${r.clientId || ''}__${li.sku || ''}`
        if (!map.has(key)) {
          map.set(key, {
            key,
            clientId: r.clientId,
            clientName: r.clientName || clients.find(c => c.id === r.clientId)?.companyName || '',
            sku: li.sku,
            description: li.description || '',
            unitsPerPallet: 0,
            currentStock: 0, currentPallets: 0,
            lastReceived: null, lastShipped: null,
            units30d: 0, orders30d: new Set(), receipts30d: 0,
          })
        }
        const e = map.get(key)
        if (rDate && (!e.lastReceived || rDate > e.lastReceived)) e.lastReceived = rDate
        if (rDate && rDate >= last30 && (r.status === 'confirmed' || r.status === 'complete')) {
          e.receipts30d += 1
        }
      })
    })

    // Orders
    orders.forEach(o => {
      if (o.status !== 'shipped') return
      const oDate = toDate(o.shippedAt) || toDate(o.createdAt)
      ;(o.inventoryAllocations || []).forEach(a => {
        if (!a.sku) return
        const key = `${o.clientId || ''}__${a.sku}`
        if (!map.has(key)) return  // skip if no SKU record exists
        const e = map.get(key)
        if (oDate && (!e.lastShipped || oDate > e.lastShipped)) e.lastShipped = oDate
        if (oDate && oDate >= last30) {
          e.units30d += Number(a.unitsAllocated || 0)
          e.orders30d.add(o.id)
        }
      })
    })

    return Array.from(map.values())
      .map(r => ({ ...r, orders30d: r.orders30d.size }))
      .filter(r => r.sku)  // skip rows with no SKU
      .sort((a, b) => b.units30d - a.units30d || b.currentStock - a.currentStock)
  }, [inventory, receipts, orders, items, clients])

  // Filter
  const filteredRows = useMemo(() => skuRows.filter(r => {
    if (clientFilter && r.clientId !== clientFilter) return false
    if (search) {
      const s = search.toLowerCase()
      const hay = [r.sku, r.description, r.clientName].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  }), [skuRows, clientFilter, search])

  // Excel export
  const exportRows = () => {
    const rows = [['Client', 'SKU', 'Description', 'Current stock', 'Current pallets', 'Last received', 'Last shipped', 'Orders (30d)', 'Units shipped (30d)']]
    filteredRows.forEach(r => rows.push([
      r.clientName, r.sku, r.description, r.currentStock, r.currentPallets,
      fmtDate(r.lastReceived), fmtDate(r.lastShipped), r.orders30d, r.units30d,
    ]))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Items')
    XLSX.writeFile(wb, `JCT-Items-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Items / SKUs</h3>
            <p className="text-xs text-gray-500 mt-0.5">Activity summary — click an item to see movement history</p>
          </div>
          <button onClick={exportRows}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 hover:bg-gray-800 rounded">
            <Download size={11} /> Export
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <input
            type="text"
            placeholder="Search SKU, description, client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5 flex-1 min-w-[200px]"
          />
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5">
            <option value="">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
          <span className="text-xs text-gray-500">{filteredRows.length} of {skuRows.length}</span>
        </div>

        {/* Table */}
        {filteredRows.length === 0 ? (
          <div className="py-10 text-center text-gray-500 text-sm">No items match your filters</div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400 uppercase sticky top-0 bg-gray-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">Client</th>
                  <th className="px-2 py-1.5 text-left">SKU</th>
                  <th className="px-2 py-1.5 text-left">Description</th>
                  <th className="px-2 py-1.5 text-right">Stock</th>
                  <th className="px-2 py-1.5 text-right">Pallets</th>
                  <th className="px-2 py-1.5 text-left">Last received</th>
                  <th className="px-2 py-1.5 text-left">Last shipped</th>
                  <th className="px-2 py-1.5 text-right">Orders (30d)</th>
                  <th className="px-2 py-1.5 text-right">Units (30d)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(0, 500).map(r => (
                  <tr key={r.key} onClick={() => setSelectedSku(r)}
                    className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer">
                    <td className="px-2 py-1.5 text-gray-300 truncate max-w-[140px]">{r.clientName}</td>
                    <td className="px-2 py-1.5 font-mono text-white">{r.sku}</td>
                    <td className="px-2 py-1.5 text-gray-400 truncate max-w-[200px]">{r.description}</td>
                    <td className="px-2 py-1.5 text-right text-white font-medium">{r.currentStock.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right text-gray-300">{r.currentPallets}</td>
                    <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{fmtDate(r.lastReceived)}</td>
                    <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{fmtDate(r.lastShipped)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-300">{r.orders30d}</td>
                    <td className="px-2 py-1.5 text-right text-blue-400 font-medium">{r.units30d.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRows.length > 500 && (
              <p className="text-xs text-gray-500 mt-2 px-2">+{filteredRows.length - 500} more — use Export</p>
            )}
          </div>
        )}
      </div>

      {selectedSku && (
        <ItemMovementModal
          item={selectedSku}
          inventory={inventory}
          receipts={receipts}
          orders={orders}
          palletHistory={palletHistory}
          onClose={() => setSelectedSku(null)}
        />
      )}
    </div>
  )
}

// ─── Movement history modal ─────────────────────────────────
function ItemMovementModal({ item, inventory, receipts, orders, palletHistory, onClose }) {
  const [actionFilter, setActionFilter] = useState('')
  const [search, setSearch] = useState('')

  // Build flat per-pallet event log (Extensiv-style)
  const allEvents = useMemo(() => {
    const out = []

    // Receipts → one row per pallet
    receipts.forEach(r => {
      if (r.clientId !== item.clientId) return
      if (r.status !== 'confirmed' && r.status !== 'complete') return
      const rDate = toDate(r.confirmedAt) || toDate(r.receivedDate) || toDate(r.createdAt)
      const user = r.confirmedByName || r.createdByName || r.userName || ''
      const ref = r.transactionId || r.id.slice(-6).toUpperCase()
      ;(r.lineItems || []).filter(li => li.sku === item.sku).forEach(li => {
        ;(li.pallets || []).forEach(p => {
          out.push({
            id: `rec-${r.id}-${p.palletId || Math.random()}`,
            type: 'receipt',
            action: 'Receive',
            date: rDate,
            palletId: p.palletId || '-',
            fromLocation: '',
            toLocation: p.location || '',
            user,
            qty: Number(p.units || 0),
            ref,
          })
        })
      })
    })

    // Orders → one row per allocation
    orders.forEach(o => {
      if (o.clientId !== item.clientId) return
      if (o.status !== 'shipped') return
      const oDate = toDate(o.shippedAt) || toDate(o.createdAt)
      const user = o.shippedByName || o.pickedByName || ''
      const ref = o.orderNumber || o.transactionId || o.id.slice(-6).toUpperCase()
      ;(o.inventoryAllocations || []).filter(a => a.sku === item.sku).forEach(a => {
        out.push({
          id: `ord-${o.id}-${a.palletId || Math.random()}`,
          type: 'order',
          action: 'OrderConfirm',
          date: oDate,
          palletId: a.palletId || '-',
          fromLocation: a.location || '',
          toLocation: '',
          user,
          qty: -Number(a.unitsAllocated || 0),
          ref,
        })
      })
    })

    // Pallet history → one row per move/merge/split
    ;(palletHistory || []).forEach(h => {
      const matches = h.sku === item.sku || (h.pallets || []).some(p => p.sku === item.sku)
      if (!matches) return
      const hDate = toDate(h.timestamp) || toDate(h.createdAt) || toDate(h.movedAt)
      const action = (h.action || 'Move').charAt(0).toUpperCase() + (h.action || 'Move').slice(1)
      out.push({
        id: `hist-${h.id}`,
        type: 'history',
        action,
        date: hDate,
        palletId: h.palletId || h.newPalletId || '-',
        fromLocation: h.fromLocation || '',
        toLocation: h.toLocation || '',
        user: h.userName || h.user || '',
        qty: Number(h.unitsChange || h.units || 0),
        ref: h.notes || '',
      })
    })

    return out.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
  }, [item, receipts, orders, palletHistory])

  const actionCounts = useMemo(() => {
    const m = { Receive: 0, OrderConfirm: 0, Move: 0, Merge: 0, Split: 0 }
    allEvents.forEach(e => { m[e.action] = (m[e.action] || 0) + 1 })
    return m
  }, [allEvents])

  const filteredEvents = useMemo(() => allEvents.filter(e => {
    if (actionFilter && e.action !== actionFilter) return false
    if (search) {
      const s = search.toLowerCase()
      const hay = [e.palletId, e.fromLocation, e.toLocation, e.user, e.ref].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  }), [allEvents, actionFilter, search])

  const totalReceived = allEvents.filter(e => e.type === 'receipt').reduce((s, e) => s + e.qty, 0)
  const totalShipped = allEvents.filter(e => e.type === 'order').reduce((s, e) => s + Math.abs(e.qty), 0)

  const exportEvents = () => {
    const rows = [['When', 'Action', 'Pallet ID', 'From Location', 'To Location', 'User', 'Qty', 'Reference']]
    filteredEvents.forEach(e => rows.push([
      fmtDateTime(e.date), e.action, e.palletId, e.fromLocation || '-', e.toLocation || '-', e.user || '-', e.qty, e.ref
    ]))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Movements')
    XLSX.writeFile(wb, `Item-${item.sku}-Movements.xlsx`)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-blue-400" />
              <span className="text-white font-mono font-semibold">{item.sku}</span>
            </div>
            <p className="text-xs text-gray-400 truncate">{item.description} · {item.clientName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Stats strip */}
        <div className="px-5 py-3 border-b border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Current stock" value={item.currentStock.toLocaleString()} color="text-cyan-400" />
          <Stat label="Pallets in WH" value={item.currentPallets} color="text-blue-400" />
          <Stat label="Total received" value={totalReceived.toLocaleString()} color="text-purple-400" />
          <Stat label="Total shipped" value={totalShipped.toLocaleString()} color="text-green-400" />
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {[
              { id: '',             label: `All (${allEvents.length})` },
              { id: 'Receive',      label: `Receive (${actionCounts.Receive || 0})` },
              { id: 'OrderConfirm', label: `Ship (${actionCounts.OrderConfirm || 0})` },
              { id: 'Move',         label: `Move (${actionCounts.Move || 0})` },
              { id: 'Merge',        label: `Merge (${actionCounts.Merge || 0})` },
              { id: 'Split',        label: `Split (${actionCounts.Split || 0})` },
            ].filter(f => f.id === '' || actionCounts[f.id] > 0).map(f => (
              <button key={f.id} onClick={() => setActionFilter(f.id)}
                className={`text-[11px] px-2 py-1 rounded-full border ${
                  actionFilter === f.id
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                }`}>{f.label}</button>
            ))}
          </div>
          <input type="text" placeholder="Search pallet, location, user..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-1.5 flex-1 min-w-[180px]" />
          <span className="text-xs text-gray-500">{filteredEvents.length} of {allEvents.length}</span>
        </div>

        {/* Movement table */}
        <div className="flex-1 overflow-y-auto p-5 pt-3">
          {filteredEvents.length === 0 ? (
            <div className="py-10 text-center text-gray-500 text-sm">No movement records match</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-400 uppercase sticky top-0 bg-gray-900 z-10">
                  <tr>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">When</th>
                    <th className="px-2 py-1.5 text-left">Action</th>
                    <th className="px-2 py-1.5 text-left">Pallet ID</th>
                    <th className="px-2 py-1.5 text-left">From</th>
                    <th className="px-2 py-1.5 text-left">To</th>
                    <th className="px-2 py-1.5 text-left">User</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5 text-left">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.slice(0, 1000).map(e => <MovementRow key={e.id} event={e} />)}
                </tbody>
              </table>
              {filteredEvents.length > 1000 && (
                <p className="text-xs text-gray-500 mt-2 px-2">+{filteredEvents.length - 1000} more — use Export</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex justify-between items-center">
          <button onClick={exportEvents}
            disabled={filteredEvents.length === 0}
            className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Download size={14} /> Export Excel
          </button>
          <button onClick={onClose} className="text-sm text-gray-300 hover:text-white px-3 py-1.5">Close</button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500 mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

const ACTION_META = {
  Receive:      { Icon: ArrowDown,      color: 'text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/30' },
  OrderConfirm: { Icon: ArrowUp,        color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/30'  },
  Move:         { Icon: ArrowLeftRight, color: 'text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/30'   },
  Merge:        { Icon: ArrowLeftRight, color: 'text-cyan-400',   bg: 'bg-cyan-500/15',   border: 'border-cyan-500/30'   },
  Split:        { Icon: ArrowLeftRight, color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30' },
}

function MovementRow({ event }) {
  const meta = ACTION_META[event.action] || ACTION_META.Move
  const Icon = meta.Icon
  return (
    <tr className="border-t border-gray-800/50 hover:bg-gray-800/40">
      <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{fmtDateTime(event.date)}</td>
      <td className="px-2 py-1.5">
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${meta.bg} ${meta.color} ${meta.border}`}>
          <Icon size={10} /> {event.action === 'OrderConfirm' ? 'Ship' : event.action}
        </span>
      </td>
      <td className="px-2 py-1.5 font-mono text-white">{event.palletId}</td>
      <td className="px-2 py-1.5 font-mono text-gray-400">{event.fromLocation || '-'}</td>
      <td className="px-2 py-1.5 font-mono text-gray-400">{event.toLocation || '-'}</td>
      <td className="px-2 py-1.5 text-gray-300">{event.user || '-'}</td>
      <td className={`px-2 py-1.5 text-right font-medium ${event.qty < 0 ? 'text-red-400' : event.qty > 0 ? 'text-green-400' : 'text-gray-500'}`}>
        {event.qty > 0 ? '+' : ''}{event.qty.toLocaleString()}
      </td>
      <td className="px-2 py-1.5 text-gray-500 truncate max-w-[140px]">{event.ref}</td>
    </tr>
  )
}
