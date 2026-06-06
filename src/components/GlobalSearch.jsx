import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  Search, X, Package, Receipt, ShoppingCart, FileText, Users,
  ChevronDown, ChevronRight, MapPin, RefreshCw, FileDown, Download
} from 'lucide-react'
import { exportTxnPDF, exportTxnExcel } from '../lib/txnExports'

const TYPE_META = {
  pallet:  { label: 'Pallets',  icon: Package,      color: 'text-cyan-400'   },
  receipt: { label: 'Receipts', icon: Receipt,      color: 'text-purple-400' },
  order:   { label: 'Orders',   icon: ShoppingCart, color: 'text-blue-400'   },
  invoice: { label: 'Invoices', icon: FileText,     color: 'text-green-400'  },
  client:  { label: 'Clients',  icon: Users,        color: 'text-pink-400'   },
}

const fmtDate = (d) => {
  if (!d) return '-'
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString()
}

// Convert a receipt/order/invoice doc into the txn shape expected by txnExports
const toReceiptTxn = (r, clients) => ({
  type: 'receipt',
  typeLabel: 'Receipt',
  refNumber: r.transactionId || r.referenceId || r.id.slice(-6).toUpperCase(),
  sourceId: r.id,
  source: r,
  clientName: r.clientName || clients.find(c => c.id === r.clientId)?.companyName || '',
  date: r.receivedDate || r.arrivalDate || r.createdAt,
  pallets: Number(r.totalPallets || 0),
  units: Number(r.totalUnits || 0),
  status: r.status || '',
})
const toOrderTxn = (o, clients) => ({
  type: 'order',
  typeLabel: 'Order',
  refNumber: o.orderNumber || o.transactionId || o.id.slice(-6).toUpperCase(),
  sourceId: o.id,
  source: o,
  clientName: o.clientName || clients.find(c => c.id === o.clientId)?.companyName || '',
  date: o.shippedDate || o.shippedAt || o.orderDate || o.createdAt,
  pallets: (o.inventoryAllocations || []).length,
  units: (o.inventoryAllocations || []).reduce((s, a) => s + Number(a.unitsAllocated || 0), 0),
  amount: Number(o.totalCharges || 0),
  picker: o.pickedByName || o.shippedByName || '',
  status: o.status || '',
})
const toInvoiceTxn = (i, clients) => ({
  type: 'invoice',
  typeLabel: 'Invoice',
  refNumber: i.invoiceNumber || i.id.slice(-6).toUpperCase(),
  sourceId: i.id,
  source: i,
  clientName: i.clientName || clients.find(c => c.id === i.clientId)?.companyName || '',
  date: i.invoiceDate || i.createdAt,
  amount: Number(i.total || 0),
  status: i.status || 'pending',
})

const MAX_RESULTS_PER_TYPE = 8

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expandedKey, setExpandedKey] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState({ inventory: [], receipts: [], orders: [], invoices: [], clients: [] })

  const inputRef = useRef(null)
  const containerRef = useRef(null)

  const fetchAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const [inv, rec, ord, inv2, cli] = await Promise.all([
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'receipts')),
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'clients')),
      ])
      setData({
        inventory: inv.docs.map(d => ({ id: d.id, ...d.data() })),
        receipts:  rec.docs.map(d => ({ id: d.id, ...d.data() })),
        orders:    ord.docs.map(d => ({ id: d.id, ...d.data() })),
        invoices:  inv2.docs.map(d => ({ id: d.id, ...d.data() })),
        clients:   cli.docs.map(d => ({ id: d.id, ...d.data() })),
      })
      setLoaded(true)
    } catch (e) {
      console.error('GlobalSearch fetch failed', e)
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Lazy load on first open
  useEffect(() => {
    if (open && !loaded) fetchAll()
  }, [open, loaded, fetchAll])

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
        setExpandedKey(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Click outside to close
  useEffect(() => {
    const onClick = (e) => {
      if (open && containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setExpandedKey(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // ─── Filter results ─────────────────────────────────────────
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null

    const matches = (s) => (s || '').toString().toLowerCase().includes(q)

    const pallets = data.inventory.filter(p =>
      matches(p.palletId) || matches(p.sku) || matches(p.description) ||
      matches(p.location) || matches(p.clientName)
    ).slice(0, MAX_RESULTS_PER_TYPE)

    const receipts = data.receipts.filter(r =>
      matches(r.transactionId) || matches(r.referenceId) || matches(r.poNumber) ||
      matches(r.clientName) || matches(r.notes) ||
      (r.lineItems || []).some(li => matches(li.sku) || matches(li.description))
    ).slice(0, MAX_RESULTS_PER_TYPE)

    const orders = data.orders.filter(o =>
      matches(o.orderNumber) || matches(o.transactionId) ||
      matches(o.clientName) || matches(o.pickedByName) || matches(o.shippedByName) ||
      matches(o.carrier?.trackingNumber) || matches(o.notes) ||
      (o.inventoryAllocations || []).some(a => matches(a.palletId) || matches(a.sku))
    ).slice(0, MAX_RESULTS_PER_TYPE)

    const invoices = data.invoices.filter(i =>
      matches(i.invoiceNumber) || matches(i.clientName) || matches(i.period) ||
      (i.lineItems || []).some(li => matches(li.description) || matches(li.label))
    ).slice(0, MAX_RESULTS_PER_TYPE)

    const clients = data.clients.filter(c =>
      matches(c.companyName) || matches(c.contactName) || matches(c.email) || matches(c.phone) || matches(c.notes)
    ).slice(0, MAX_RESULTS_PER_TYPE)

    return { pallets, receipts, orders, invoices, clients }
  }, [query, data])

  const totalResults = results
    ? results.pallets.length + results.receipts.length + results.orders.length + results.invoices.length + results.clients.length
    : 0

  const toggleExpand = (key) => setExpandedKey(prev => prev === key ? null : key)

  // ─── Render ─────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
        className="bg-gray-800/70 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors"
      >
        <Search size={14} />
        <span className="hidden sm:inline">Search anything...</span>
        <kbd className="hidden sm:inline-block bg-gray-900 border border-gray-700 text-[10px] px-1.5 py-0.5 rounded text-gray-500 ml-2">Ctrl K</kbd>
      </button>
    )
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Search input */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pallets, receipts, orders, invoices, clients..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setExpandedKey(null) }}
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 outline-none"
            autoFocus
          />
          <button onClick={fetchAll} disabled={refreshing}
            title="Refresh data"
            className="text-gray-400 hover:text-white p-1">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setOpen(false); setQuery(''); setExpandedKey(null) }}
            className="text-gray-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {!loaded && refreshing && (
            <div className="p-8 text-center text-gray-500 text-sm">Loading data…</div>
          )}
          {loaded && !query.trim() && (
            <div className="p-8 text-center text-gray-500 text-sm">
              <Search size={28} className="mx-auto mb-2 text-gray-700" />
              <p>Type to search across pallets, receipts, orders, invoices, and clients.</p>
              <p className="text-xs text-gray-600 mt-2">Searches IDs, descriptions, names, locations, and notes.</p>
            </div>
          )}
          {loaded && query.trim() && totalResults === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No matches found.</div>
          )}
          {loaded && results && totalResults > 0 && (
            <div className="py-2">
              <ResultGroup
                type="pallet" results={results.pallets} render={(p) => ({
                  key: `pallet-${p.id}`,
                  title: p.palletId || p.id.slice(-6),
                  subtitle: `${p.sku || ''} · ${Number(p.units || 0)} units · ${p.location || 'no loc'} · ${p.clientName || ''}`,
                })}
                renderDetail={(p) => <PalletDetail pallet={p} />}
                expandedKey={expandedKey} onToggle={toggleExpand}
              />
              <ResultGroup
                type="receipt" results={results.receipts} render={(r) => ({
                  key: `receipt-${r.id}`,
                  title: r.transactionId || r.referenceId || r.id.slice(-6),
                  subtitle: `${r.clientName || ''} · ${fmtDate(r.receivedDate || r.arrivalDate || r.createdAt)} · ${r.status || 'pending'}`,
                })}
                renderDetail={(r) => <TxnDetail txn={toReceiptTxn(r, data.clients)} inventory={data.inventory} />}
                expandedKey={expandedKey} onToggle={toggleExpand}
              />
              <ResultGroup
                type="order" results={results.orders} render={(o) => ({
                  key: `order-${o.id}`,
                  title: o.orderNumber || o.transactionId || o.id.slice(-6),
                  subtitle: `${o.clientName || ''} · ${fmtDate(o.shippedAt || o.orderDate || o.createdAt)} · ${o.status || ''}`,
                })}
                renderDetail={(o) => <TxnDetail txn={toOrderTxn(o, data.clients)} inventory={data.inventory} />}
                expandedKey={expandedKey} onToggle={toggleExpand}
              />
              <ResultGroup
                type="invoice" results={results.invoices} render={(i) => ({
                  key: `invoice-${i.id}`,
                  title: i.invoiceNumber || i.id.slice(-6),
                  subtitle: `${i.clientName || ''} · ${i.period || fmtDate(i.createdAt)} · $${Number(i.total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                })}
                renderDetail={(i) => <TxnDetail txn={toInvoiceTxn(i, data.clients)} inventory={data.inventory} />}
                expandedKey={expandedKey} onToggle={toggleExpand}
              />
              <ResultGroup
                type="client" results={results.clients} render={(c) => ({
                  key: `client-${c.id}`,
                  title: c.companyName || c.id,
                  subtitle: [c.contactName, c.email, c.phone].filter(Boolean).join(' · '),
                })}
                renderDetail={(c) => <ClientDetail client={c} data={data} />}
                expandedKey={expandedKey} onToggle={toggleExpand}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-800 text-[11px] text-gray-500 flex items-center justify-between">
          <span>
            {loaded ? `${totalResults} result${totalResults !== 1 ? 's' : ''}` : '...'}
          </span>
          <span>Press <kbd className="bg-gray-800 border border-gray-700 px-1 py-0.5 rounded text-gray-400">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────
function ResultGroup({ type, results, render, renderDetail, expandedKey, onToggle }) {
  if (!results || results.length === 0) return null
  const meta = TYPE_META[type]
  const Icon = meta.icon
  return (
    <div className="mb-1">
      <div className="px-4 py-1.5 text-[10px] uppercase font-medium text-gray-500 flex items-center gap-1.5">
        <Icon size={10} /> {meta.label} <span className="text-gray-600">({results.length})</span>
      </div>
      <div>
        {results.map((item) => {
          const r = render(item)
          const isExpanded = expandedKey === r.key
          return (
            <div key={r.key} className="border-t border-gray-800/50">
              <button
                onClick={() => onToggle(r.key)}
                className="w-full px-4 py-2 text-left hover:bg-gray-800/50 flex items-center gap-3"
              >
                <Icon size={14} className={`${meta.color} flex-shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white font-mono truncate">{r.title}</div>
                  <div className="text-xs text-gray-400 truncate">{r.subtitle}</div>
                </div>
                {isExpanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 bg-gray-950/40 border-t border-gray-800/30">
                  {renderDetail(item)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PalletDetail({ pallet }) {
  return (
    <div className="py-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
      <DetailRow label="Pallet ID" value={pallet.palletId || '-'} mono />
      <DetailRow label="SKU" value={pallet.sku || '-'} mono />
      <DetailRow label="Units" value={Number(pallet.units || 0).toLocaleString()} />
      <DetailRow label="Location" value={pallet.location || '-'} mono />
      <DetailRow label="Status" value={pallet.status || 'available'} />
      <DetailRow label="Condition" value={pallet.condition || 'A'} />
      <DetailRow label="Client" value={pallet.clientName || '-'} />
      <DetailRow label="Received" value={fmtDate(pallet.receivedDate || pallet.createdAt)} />
      {pallet.description && <DetailRow label="Description" value={pallet.description} />}
    </div>
  )
}

function ClientDetail({ client, data }) {
  const id = client.id
  const recCount = data.receipts.filter(r => r.clientId === id).length
  const ordCount = data.orders.filter(o => o.clientId === id).length
  const invCount = data.invoices.filter(i => i.clientId === id).length
  const palletCount = data.inventory.filter(p => p.clientId === id).length
  return (
    <div className="py-2 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <DetailRow label="Contact" value={client.contactName || '-'} />
        <DetailRow label="Email" value={client.email || '-'} />
        <DetailRow label="Phone" value={client.phone || '-'} />
        {client.startDate && <DetailRow label="Start date" value={client.startDate} />}
        {client.notes && <DetailRow label="Notes" value={client.notes} />}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-1 rounded">
          {palletCount} pallets
        </span>
        <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-1 rounded">
          {recCount} receipts
        </span>
        <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded">
          {ordCount} orders
        </span>
        <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded">
          {invCount} invoices
        </span>
      </div>
    </div>
  )
}

function TxnDetail({ txn, inventory }) {
  const src = txn.source || {}
  return (
    <div className="py-2 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <DetailRow label="Type" value={txn.typeLabel} />
        <DetailRow label="Reference" value={txn.refNumber} mono />
        <DetailRow label="Date" value={fmtDate(txn.date)} />
        <DetailRow label="Client" value={txn.clientName} />
        <DetailRow label="Status" value={txn.status || '-'} />
        {txn.type === 'receipt' && <>
          <DetailRow label="Total pallets" value={txn.pallets} />
          <DetailRow label="Total units" value={txn.units} />
          {src.referenceId && <DetailRow label="PO / Ref" value={src.referenceId} />}
          {src.arrivalDate && <DetailRow label="Arrival" value={fmtDate(src.arrivalDate)} />}
        </>}
        {txn.type === 'order' && <>
          <DetailRow label="Pallets shipped" value={txn.pallets} />
          <DetailRow label="Units shipped" value={txn.units} />
          {txn.picker && <DetailRow label="Picker" value={txn.picker} />}
          {src.carrier?.trackingNumber && <DetailRow label="Tracking" value={src.carrier.trackingNumber} mono />}
          {txn.amount > 0 && <DetailRow label="Charges" value={`$${Number(txn.amount).toFixed(2)}`} />}
        </>}
        {txn.type === 'invoice' && <>
          {src.period && <DetailRow label="Period" value={src.period} />}
          <DetailRow label="Amount" value={`$${Number(src.total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        </>}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => exportTxnPDF(txn, inventory)}
          className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5"
        >
          <FileDown size={12} /> Export PDF
        </button>
        <button
          onClick={() => exportTxnExcel(txn, inventory)}
          className="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5"
        >
          <Download size={12} /> Export Excel
        </button>
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500 mb-0.5">{label}</div>
      <div className={`text-white truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}
