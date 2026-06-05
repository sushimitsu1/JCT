import { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, query, orderBy } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import {
  Package, PackagePlus, ShoppingCart, MoreHorizontal,
  Search, X, ChevronDown, ChevronRight, Plus, Check,
  LogOut, Users, DollarSign, BarChart3, RefreshCw,
  MapPin, Filter, AlertCircle, CheckCircle, Clock,
  Layers, ArrowLeft, Tag
} from 'lucide-react'

const statusColors = {
  available: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  allocated: { bg: 'bg-blue-500/15',  text: 'text-blue-400',  border: 'border-blue-500/30',  dot: 'bg-blue-400'  },
  'on-hold': { bg: 'bg-yellow-500/15',text: 'text-yellow-400',border: 'border-yellow-500/30',dot: 'bg-yellow-400'},
  damaged:   { bg: 'bg-red-500/15',   text: 'text-red-400',   border: 'border-red-500/30',   dot: 'bg-red-400'   },
  shipped:   { bg: 'bg-gray-500/15',  text: 'text-gray-400',  border: 'border-gray-500/30',  dot: 'bg-gray-400'  },
}

const orderStatusColors = {
  pending:   { bg: 'bg-yellow-500/15', text: 'text-yellow-400', icon: Clock },
  picking:   { bg: 'bg-blue-500/15',   text: 'text-blue-400',   icon: ShoppingCart },
  shipped:   { bg: 'bg-green-500/15',  text: 'text-green-400',  icon: CheckCircle },
  cancelled: { bg: 'bg-red-500/15',    text: 'text-red-400',    icon: X },
}

export default function MobileApp() {
  const { userName } = useAuth()
  const [activeNav, setActiveNav] = useState('inventory')
  const [inventory, setInventory] = useState([])
  const [orders, setOrders] = useState([])
  const [clients, setClients] = useState([])
  const [catalogItems, setCatalogItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const [invSnap, ordersSnap, clientsSnap, catalogSnap] = await Promise.all([
      getDocs(collection(db, 'inventory')),
      getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'items'))
    ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setOrders(ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setCatalogItems(catalogSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    if (!silent) setLoading(false)
    else setRefreshing(false)
  }

  useEffect(() => { fetchAll() }, [])

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center" style={{ background: '#0f1117' }}>
      <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
        <span className="text-white text-xl font-bold">J</span>
      </div>
      <p className="text-gray-400 text-sm">Loading JCT WMS...</p>
    </div>
  )

  return (
    <div className="h-screen flex flex-col" style={{ background: '#0f1117' }}>
      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeNav === 'inventory' && (
          <InventoryScreen
            inventory={inventory}
            clients={clients}
            onRefresh={() => fetchAll(true)}
            refreshing={refreshing}
          />
        )}
        {activeNav === 'receiving' && (
          <ReceivingScreen
            clients={clients}
            catalogItems={catalogItems}
            onSuccess={() => { fetchAll(true); setActiveNav('inventory') }}
          />
        )}
        {activeNav === 'orders' && (
          <OrdersScreen
            orders={orders}
            clients={clients}
            catalogItems={catalogItems}
            inventory={inventory}
            onRefresh={() => fetchAll(true)}
            refreshing={refreshing}
            onStatusChange={() => fetchAll(true)}
          />
        )}
        {activeNav === 'waves' && (
          <MobileWaves
            waves={waves}
            orders={orders}
            inventory={inventory}
            clients={clients}
            onRefresh={() => fetchAll(true)}
            refreshing={refreshing}
          />
        )}
        {activeNav === 'more' && (
          <MoreScreen onSignOut={() => signOut(auth)} userName={userName} />
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ background: '#1a1f2e', borderTop: '1px solid #2a3040' }}
        className="flex-shrink-0 pb-safe">
        <div className="flex">
          {[
            { id: 'inventory', icon: Package,       label: 'Inventory' },
            { id: 'receiving', icon: PackagePlus,   label: 'Receive'   },
            { id: 'orders',    icon: ShoppingCart,  label: 'Orders'    },
            { id: 'more',      icon: MoreHorizontal,label: 'More'      },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className="flex-1 flex flex-col items-center py-3 gap-1 transition-colors"
              style={{ color: activeNav === item.id ? '#3B82F6' : '#6B7280' }}
            >
              <item.icon size={22} strokeWidth={activeNav === item.id ? 2 : 1.5} />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── INVENTORY SCREEN ─────────────────────────────────────────────────────────
function InventoryScreen({ inventory, clients, onRefresh, refreshing }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [filterClient, setFilterClient] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const filtered = inventory.filter(item => {
    const matchStatus = filterStatus ? (item.status || 'available') === filterStatus : true
    const matchClient = filterClient ? item.clientId === filterClient : true
    const matchSearch = search
      ? item.sku?.toLowerCase().includes(search.toLowerCase()) ||
        item.palletId?.toLowerCase().includes(search.toLowerCase()) ||
        item.description?.toLowerCase().includes(search.toLowerCase()) ||
        item.location?.toLowerCase().includes(search.toLowerCase())
      : true
    return matchStatus && matchClient && matchSearch
  })

  const counts = {
    available: inventory.filter(i => (i.status || 'available') === 'available').length,
    allocated: inventory.filter(i => i.status === 'allocated').length,
    'on-hold': inventory.filter(i => i.status === 'on-hold').length,
    damaged:   inventory.filter(i => i.status === 'damaged').length,
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-white text-xl font-bold">Inventory</h1>
            <p className="text-gray-500 text-xs mt-0.5">{filtered.length} pallets shown</p>
          </div>
          <button onClick={onRefresh} disabled={refreshing}
            className="p-2 rounded-xl bg-gray-800 text-gray-400 active:opacity-70">
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center bg-gray-800 rounded-xl px-3 py-2.5 gap-2 mb-3">
          <Search size={16} className="text-gray-500 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU, pallet ID, location..."
            className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-gray-600"
          />
          {search && <button onClick={() => setSearch('')}><X size={14} className="text-gray-500" /></button>}
        </div>

        {/* Status filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {[
            { id: 'available', label: `Available ${counts.available}` },
            { id: 'allocated', label: `Allocated ${counts.allocated}` },
            { id: 'on-hold',   label: `On Hold ${counts['on-hold']}` },
            { id: 'damaged',   label: `Damaged ${counts.damaged}` },
            { id: '',          label: 'All' },
          ].map(chip => (
            <button
              key={chip.id}
              onClick={() => setFilterStatus(chip.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterStatus === chip.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Client filter */}
        {clients.length > 0 && (
          <div className="mt-2">
            <select
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
              className="w-full bg-gray-800 text-gray-300 text-sm rounded-xl px-3 py-2 focus:outline-none"
            >
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Pallet cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Package size={40} className="text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No pallets found</p>
            <button onClick={() => { setSearch(''); setFilterStatus('available'); setFilterClient('') }}
              className="text-blue-400 text-xs mt-2">Clear filters</button>
          </div>
        ) : filtered.map(item => {
          const sc = statusColors[item.status || 'available'] || statusColors.available
          const isExpanded = expandedId === item.id
          return (
            <div key={item.id}
              style={{ background: '#1a1f2e', border: '1px solid #2a3040' }}
              className="rounded-2xl overflow-hidden">
              <button
                className="w-full text-left px-4 py-3.5 active:opacity-80 transition-opacity"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
                      <span className="text-white font-mono text-sm font-semibold truncate">{item.sku}</span>
                    </div>
                    <p className="text-gray-400 text-xs truncate mb-1">{item.description || 'No description'}</p>
                    <p className="text-gray-600 text-xs font-mono">{item.palletId || '—'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                      {item.status || 'available'}
                    </span>
                    <span className="text-white text-sm font-semibold">{item.units || item.quantity || 0} units</span>
                  </div>
                </div>

                {/* Quick info row */}
                <div className="flex items-center gap-3 mt-2">
                  {item.location && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <MapPin size={11} /> {item.location}
                    </span>
                  )}
                  <span className="text-xs text-gray-600">{item.clientName}</span>
                  {item.condition && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      item.condition === 'A' ? 'bg-green-500/10 text-green-400' :
                      item.condition === 'B' ? 'bg-yellow-500/10 text-yellow-400' :
                      'bg-red-500/10 text-red-400'
                    }`}>Grade {item.condition}</span>
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #2a3040' }} className="px-4 py-3 space-y-2">
                  {[
                    ['Pallet ID',     item.palletId || '—'],
                    ['Client',        item.clientName || '—'],
                    ['Location',      item.location || 'Not set'],
                    ['Units',         String(item.units || item.quantity || 0)],
                    ['Condition',     item.condition ? `Grade ${item.condition}` : '—'],
                    ['Status',        item.status || 'available'],
                    ['Received',      item.receivedDate || '—'],
                    ['PO Number',     item.poNumber || '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-gray-500 text-xs">{label}</span>
                      <span className="text-gray-200 text-xs font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {/* Bottom padding for nav */}
        <div className="h-4" />
      </div>
    </div>
  )
}

// ─── RECEIVING SCREEN ─────────────────────────────────────────────────────────
function ReceivingScreen({ clients, catalogItems, onSuccess }) {
  const [step, setStep] = useState(1) // 1=header, 2=pallets, 3=review
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0])
  const [pallets, setPallets] = useState([{ sku: '', description: '', units: '', condition: 'A', location: '' }])
  const [loading, setLoading] = useState(false)
  const [skuSearch, setSkuSearch] = useState('')
  const [skuDropdownFor, setSkuDropdownFor] = useState(null)

  const clientSkus = catalogItems.filter(i => i.clientId === clientId)
  const filteredSkus = skuSearch
    ? clientSkus.filter(i => i.sku.toLowerCase().includes(skuSearch.toLowerCase()) || i.description?.toLowerCase().includes(skuSearch.toLowerCase()))
    : clientSkus

  const updatePallet = (i, field, value) => {
    const p = [...pallets]
    p[i] = { ...p[i], [field]: value }
    setPallets(p)
  }

  const selectSku = (idx, item) => {
    updatePallet(idx, 'sku', item.sku)
    updatePallet(idx, 'description', item.description || '')
    setSkuDropdownFor(null)
    setSkuSearch('')
  }

  const addPallet = () => setPallets([...pallets, { sku: '', description: '', units: '', condition: 'A', location: '' }])
  const removePallet = (i) => setPallets(pallets.filter((_, idx) => idx !== i))

  const generatePalletId = () => {
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
    return `${date}-${Math.floor(Math.random()*9000)+1000}`
  }

  const handleSubmit = async () => {
    const valid = pallets.filter(p => p.sku && p.units)
    if (!clientId || !receivedDate || valid.length === 0) return
    setLoading(true)
    try {
      const totalUnits = valid.reduce((s, p) => s + Number(p.units), 0)
      const receiptDoc = await addDoc(collection(db, 'receipts'), {
        clientId, clientName, poNumber, receivedDate,
        totalPallets: valid.length, totalUnits,
        pallets: valid.map(p => ({ ...p, palletId: generatePalletId(), sku: p.sku.toUpperCase() })),
        createdAt: new Date().toISOString()
      })
      for (const pallet of valid) {
        await addDoc(collection(db, 'inventory'), {
          palletId: generatePalletId(),
          clientId, clientName,
          sku: pallet.sku.toUpperCase(),
          description: pallet.description,
          units: Number(pallet.units),
          condition: pallet.condition,
          location: pallet.location,
          status: 'available',
          receivedDate, poNumber,
          receiptId: receiptDoc.id,
          createdAt: new Date().toISOString()
        })
      }
      // Reset form
      setStep(1); setClientId(''); setClientName(''); setPoNumber('')
      setReceivedDate(new Date().toISOString().split('T')[0])
      setPallets([{ sku: '', description: '', units: '', condition: 'A', location: '' }])
      onSuccess()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-4 flex-shrink-0">
        <h1 className="text-white text-xl font-bold mb-1">New Receipt</h1>
        <div className="flex gap-2">
          {['Header', 'Pallets', 'Review'].map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step > i + 1 ? 'bg-green-600 text-white' :
                step === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-500'
              }`}>
                {step > i + 1 ? <Check size={12} /> : i + 1}
              </div>
              <span className={`text-xs ${step === i + 1 ? 'text-white' : 'text-gray-600'}`}>{s}</span>
              {i < 2 && <ChevronRight size={12} className="text-gray-700" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Step 1: Header */}
        {step === 1 && (
          <>
            <div>
              <label className="text-gray-400 text-xs mb-2 block font-medium">Client *</label>
              <select
                value={clientId}
                onChange={e => {
                  const c = clients.find(x => x.id === e.target.value)
                  setClientId(e.target.value)
                  setClientName(c?.companyName || '')
                }}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3.5 text-sm focus:outline-none"
                style={{ border: '1px solid #2a3040' }}
              >
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-2 block font-medium">PO Number</label>
              <input
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                placeholder="PO-001 (optional)"
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3.5 text-sm focus:outline-none"
                style={{ border: '1px solid #2a3040' }}
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-2 block font-medium">Received Date *</label>
              <input
                type="date"
                value={receivedDate}
                onChange={e => setReceivedDate(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3.5 text-sm focus:outline-none"
                style={{ border: '1px solid #2a3040' }}
              />
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!clientId || !receivedDate}
              className="w-full bg-blue-600 disabled:opacity-40 text-white font-semibold rounded-xl py-4 text-sm transition-opacity"
            >
              Next — Add Pallets
            </button>
          </>
        )}

        {/* Step 2: Pallets */}
        {step === 2 && (
          <>
            <div className="flex items-center justify-between">
              <button onClick={() => setStep(1)} className="text-blue-400 text-sm flex items-center gap-1">
                <ArrowLeft size={14} /> Back
              </button>
              <p className="text-gray-400 text-xs">{clientName} · {receivedDate}</p>
            </div>

            {pallets.map((pallet, i) => (
              <div key={i} style={{ background: '#1a1f2e', border: '1px solid #2a3040' }} className="rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-sm font-medium">Pallet {i + 1}</span>
                  {pallets.length > 1 && (
                    <button onClick={() => removePallet(i)} className="text-gray-600 hover:text-red-400">
                      <X size={16} />
                    </button>
                  )}
                </div>

                {/* SKU search */}
                <div>
                  <label className="text-gray-500 text-xs mb-1 block">SKU *</label>
                  <div className="relative">
                    <div className="flex items-center bg-gray-800 rounded-xl px-3 py-3 gap-2" style={{ border: '1px solid #374151' }}>
                      <Search size={14} className="text-gray-600 flex-shrink-0" />
                      <input
                        value={skuDropdownFor === i ? skuSearch : pallet.sku}
                        onChange={e => {
                          if (skuDropdownFor !== i) setSkuDropdownFor(i)
                          setSkuSearch(e.target.value)
                          updatePallet(i, 'sku', e.target.value.toUpperCase())
                        }}
                        onFocus={() => { setSkuDropdownFor(i); setSkuSearch('') }}
                        placeholder="Search or type SKU..."
                        className="flex-1 bg-transparent text-white text-sm focus:outline-none uppercase"
                      />
                    </div>
                    {skuDropdownFor === i && filteredSkus.length > 0 && (
                      <div style={{ background: '#111827', border: '1px solid #374151' }} className="absolute top-full left-0 right-0 mt-1 rounded-xl z-50 max-h-48 overflow-y-auto shadow-xl">
                        {filteredSkus.map(s => (
                          <button key={s.id} onMouseDown={() => selectSku(i, s)}
                            className="w-full text-left px-4 py-3 border-b border-gray-800 last:border-0 active:bg-gray-800">
                            <div className="text-white text-sm font-mono font-medium">{s.sku}</div>
                            <div className="text-gray-500 text-xs truncate">{s.description}</div>
                            {s.unitsPerPallet && <div className="text-gray-600 text-xs">{s.unitsPerPallet} units/pallet</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-gray-500 text-xs mb-1 block">Description</label>
                  <input
                    value={pallet.description}
                    onChange={e => updatePallet(i, 'description', e.target.value)}
                    placeholder="Item description"
                    className="w-full bg-gray-800 text-white rounded-xl px-3 py-3 text-sm focus:outline-none"
                    style={{ border: '1px solid #374151' }}
                  />
                </div>

                {/* Units + Condition row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Units *</label>
                    <input
                      type="number"
                      value={pallet.units}
                      onChange={e => updatePallet(i, 'units', e.target.value)}
                      placeholder="0"
                      className="w-full bg-gray-800 text-white rounded-xl px-3 py-3 text-sm focus:outline-none"
                      style={{ border: '1px solid #374151' }}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Condition</label>
                    <select
                      value={pallet.condition}
                      onChange={e => updatePallet(i, 'condition', e.target.value)}
                      className="w-full bg-gray-800 text-white rounded-xl px-3 py-3 text-sm focus:outline-none"
                      style={{ border: '1px solid #374151' }}
                    >
                      <option value="A">Grade A</option>
                      <option value="B">Grade B</option>
                      <option value="C">Grade C</option>
                    </select>
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label className="text-gray-500 text-xs mb-1 block">Location / Bin</label>
                  <input
                    value={pallet.location}
                    onChange={e => updatePallet(i, 'location', e.target.value)}
                    placeholder="e.g. A-01-03"
                    className="w-full bg-gray-800 text-white rounded-xl px-3 py-3 text-sm focus:outline-none"
                    style={{ border: '1px solid #374151' }}
                  />
                </div>
              </div>
            ))}

            <button onClick={addPallet} className="w-full py-3.5 rounded-xl text-sm text-blue-400 font-medium flex items-center justify-center gap-2"
              style={{ border: '1px dashed #2563EB' }}>
              <Plus size={16} /> Add Another Pallet
            </button>

            <button onClick={() => setStep(3)} disabled={pallets.every(p => !p.sku || !p.units)}
              className="w-full bg-blue-600 disabled:opacity-40 text-white font-semibold rounded-xl py-4 text-sm">
              Next — Review
            </button>
          </>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setStep(2)} className="text-blue-400 text-sm flex items-center gap-1">
                <ArrowLeft size={14} /> Back
              </button>
            </div>

            <div style={{ background: '#1a1f2e', border: '1px solid #2a3040' }} className="rounded-2xl p-4 space-y-2 mb-4">
              <p className="text-white font-medium text-sm mb-3">Receipt Summary</p>
              {[
                ['Client', clientName],
                ['Date', receivedDate],
                ['PO #', poNumber || '—'],
                ['Pallets', String(pallets.filter(p => p.sku && p.units).length)],
                ['Total Units', String(pallets.filter(p => p.sku && p.units).reduce((s, p) => s + Number(p.units || 0), 0))],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-gray-500 text-xs">{label}</span>
                  <span className="text-white text-xs font-medium">{value}</span>
                </div>
              ))}
            </div>

            {/* Pallet list */}
            {pallets.filter(p => p.sku && p.units).map((p, i) => (
              <div key={i} style={{ background: '#1a1f2e', border: '1px solid #2a3040' }} className="rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-mono font-medium">{p.sku}</p>
                  <p className="text-gray-500 text-xs">{p.description || 'No description'}</p>
                  {p.location && <p className="text-gray-600 text-xs">{p.location}</p>}
                </div>
                <div className="text-right">
                  <p className="text-white text-sm font-semibold">{p.units} units</p>
                  <p className="text-gray-500 text-xs">Grade {p.condition}</p>
                </div>
              </div>
            ))}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-green-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-sm mt-2 flex items-center justify-center gap-2"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
              {loading ? 'Saving...' : 'Confirm & Save Receipt'}
            </button>
          </>
        )}

        <div className="h-4" />
      </div>
    </div>
  )
}

// ─── ORDERS SCREEN ────────────────────────────────────────────────────────────
function OrdersScreen({ orders, clients, catalogItems, inventory, onRefresh, refreshing, onStatusChange }) {
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [updatingId, setUpdatingId] = useState(null)

  const filtered = orders.filter(o => {
    const ms = filterStatus ? o.status === filterStatus : true
    const mq = search ? o.clientName?.toLowerCase().includes(search.toLowerCase()) || o.orderNumber?.toLowerCase().includes(search.toLowerCase()) : true
    return ms && mq
  })

  const counts = {
    pending: orders.filter(o => o.status === 'pending').length,
    picking: orders.filter(o => o.status === 'picking').length,
    shipped: orders.filter(o => o.status === 'shipped').length,
  }

  const changeStatus = async (order, newStatus) => {
    setUpdatingId(order.id)
    await updateDoc(doc(db, 'orders', order.id), { status: newStatus })
    await onStatusChange()
    setUpdatingId(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-white text-xl font-bold">Orders</h1>
            <p className="text-gray-500 text-xs">{orders.length} total</p>
          </div>
          <button onClick={onRefresh} disabled={refreshing} className="p-2 rounded-xl bg-gray-800 text-gray-400">
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center bg-gray-800 rounded-xl px-3 py-2.5 gap-2 mb-3" style={{ border: '1px solid #2a3040' }}>
          <Search size={16} className="text-gray-500 flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search client or order #..."
            className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-gray-600" />
          {search && <button onClick={() => setSearch('')}><X size={14} className="text-gray-500" /></button>}
        </div>

        {/* Status chips */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {[
            { id: '',          label: `All ${orders.length}` },
            { id: 'pending',   label: `Pending ${counts.pending}` },
            { id: 'picking',   label: `Picking ${counts.picking}` },
            { id: 'shipped',   label: `Shipped ${counts.shipped}` },
          ].map(chip => (
            <button key={chip.id} onClick={() => setFilterStatus(chip.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterStatus === chip.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
              }`}>
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Order cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48">
            <ShoppingCart size={40} className="text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No orders found</p>
          </div>
        ) : filtered.map(order => {
          const sc = orderStatusColors[order.status] || orderStatusColors.pending
          const StatusIcon = sc.icon
          const isExpanded = expandedId === order.id
          const isUpdating = updatingId === order.id

          return (
            <div key={order.id} style={{ background: '#1a1f2e', border: '1px solid #2a3040' }} className="rounded-2xl overflow-hidden">
              <button className="w-full text-left px-4 py-3.5 active:opacity-80"
                onClick={() => setExpandedId(isExpanded ? null : order.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{order.clientName}</p>
                    <p className="text-gray-500 text-xs font-mono mt-0.5 truncate">{order.orderNumber || '—'}</p>
                    <p className="text-gray-600 text-xs mt-0.5">{order.orderDate}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                      <StatusIcon size={10} /> {order.status}
                    </span>
                    <span className="text-gray-400 text-xs">{order.totalUnits || 0} units</span>
                    {Number(order.totalCharges || 0) > 0 && (
                      <span className="text-gray-400 text-xs">${Number(order.totalCharges).toFixed(2)}</span>
                    )}
                  </div>
                </div>

                {/* Ship to */}
                {order.shipTo?.company && (
                  <p className="text-gray-600 text-xs mt-1.5 truncate">→ {order.shipTo.company}</p>
                )}
              </button>

              {/* Expanded */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #2a3040' }} className="px-4 py-3 space-y-3">

                  {/* Line items */}
                  {(order.items || []).length > 0 && (
                    <div>
                      <p className="text-gray-500 text-xs mb-2 font-medium">Line Items</p>
                      {(order.items || []).map((item, i) => {
                        const cat = catalogItems.find(c => c.clientId === order.clientId && c.sku === item.sku)
                        const ppc = Number(cat?.piecesPerCarton || 1)
                        const cartons = Math.ceil(Number(item.pieces || item.quantity || 0) / ppc)
                        return (
                          <div key={i} className="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
                            <div>
                              <span className="text-white text-xs font-mono">{item.sku}</span>
                              <p className="text-gray-600 text-xs truncate">{item.description}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-white text-xs">{item.pieces || item.quantity} pcs</p>
                              <p className="text-gray-500 text-xs">{cartons} ctns</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Carrier info */}
                  {order.carrier?.carrier && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">Carrier</span>
                      <span className="text-gray-300 text-xs">{order.carrier.carrier}</span>
                    </div>
                  )}
                  {order.carrier?.trackingNumber && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">Tracking</span>
                      <span className="text-gray-300 text-xs font-mono">{order.carrier.trackingNumber}</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => changeStatus(order, 'picking')}
                        disabled={isUpdating}
                        className="flex-1 bg-blue-600/20 text-blue-400 rounded-xl py-2.5 text-xs font-medium disabled:opacity-50"
                        style={{ border: '1px solid rgba(37,99,235,0.3)' }}
                      >
                        {isUpdating ? 'Updating...' : 'Start Picking'}
                      </button>
                    )}
                    {order.status === 'picking' && (
                      <button
                        onClick={() => changeStatus(order, 'shipped')}
                        disabled={isUpdating}
                        className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {isUpdating ? 'Updating...' : '✓ Mark Shipped'}
                      </button>
                    )}
                    {(order.status === 'shipped' || order.status === 'cancelled') && (
                      <button
                        onClick={() => changeStatus(order, 'pending')}
                        disabled={isUpdating}
                        className="flex-1 bg-yellow-600/20 text-yellow-400 rounded-xl py-2.5 text-xs font-medium disabled:opacity-50"
                        style={{ border: '1px solid rgba(202,138,4,0.3)' }}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div className="h-4" />
      </div>
    </div>
  )
}

// ─── MORE SCREEN ──────────────────────────────────────────────────────────────
function MoreScreen({ onSignOut, userName }) {
  return (
    <div className="h-full flex flex-col">
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3040' }} className="px-4 pt-12 pb-4 flex-shrink-0">
        <h1 className="text-white text-xl font-bold">More</h1>
        <p className="text-gray-500 text-sm mt-0.5">{userName || 'Admin'}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* Info cards */}
        <div style={{ background: '#1a1f2e', border: '1px solid #2a3040' }} className="rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">J</span>
            </div>
            <div>
              <p className="text-white font-semibold">JCT WMS</p>
              <p className="text-gray-500 text-xs">Warehouse Management System</p>
            </div>
          </div>
          <p className="text-gray-600 text-xs">Mobile view — use desktop for full features including billing, reports, and order creation.</p>
        </div>

        {/* Quick links */}
        <div style={{ background: '#1a1f2e', border: '1px solid #2a3040' }} className="rounded-2xl overflow-hidden">
          {[
            { icon: Tag,        label: 'Items / SKUs',   sub: 'Manage SKU catalog' },
            { icon: Users,      label: 'Clients',        sub: 'Client management' },
            { icon: DollarSign, label: 'Billing',        sub: 'Invoices & charges' },
            { icon: BarChart3,  label: 'Reports',        sub: 'Analytics' },
          ].map((item, i) => (
            <div key={item.label} style={{ borderBottom: i < 3 ? '1px solid #2a3040' : 'none' }}
              className="flex items-center px-4 py-3.5 gap-3">
              <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center flex-shrink-0">
                <item.icon size={18} className="text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">{item.label}</p>
                <p className="text-gray-600 text-xs">{item.sub}</p>
              </div>
              <div className="text-xs text-gray-600 bg-gray-800 px-2 py-1 rounded-lg">Desktop only</div>
            </div>
          ))}
        </div>

        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl text-red-400 active:opacity-70"
          style={{ background: '#1a1f2e', border: '1px solid #2a3040' }}
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Sign out</span>
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}