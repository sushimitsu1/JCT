import { useState, useEffect } from 'react'
import {
  collection, addDoc, getDocs, doc, updateDoc,
  query, orderBy
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  Plus, X, Package, ChevronDown, Search,
  ArrowLeft, Truck, DollarSign, FileText,
  CheckCircle, Clock, Pencil, Trash2, Save
} from 'lucide-react'
import BarcodeScanner from '../components/BarcodeScanner'
import TransactionCharges from '../components/TransactionCharges'
import BulkUpload from '../components/BulkUpload'

const generatePalletId = () => {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
  return `${date}-${Math.floor(Math.random()*9000)+1000}`
}

const genTransactionId = () => {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
  return `REC-${date}-${Math.floor(Math.random()*9000)+1000}`
}

const statusConfig = {
  open:      { label: 'Open',      color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       icon: CheckCircle },
  complete:  { label: 'Complete',  color: 'bg-green-500/10 text-green-400 border-green-500/20',    icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/10 text-red-400 border-red-500/20',          icon: X },
}

const emptyLineItem = {
  sku: '', description: '', quantity: '', primaryUnits: 'Pallet',
  location: '', condition: 'A', weight: '', volume: '', notes: ''
}

const inputCls = "w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
const labelCls = "text-gray-400 text-xs mb-1 block"

export default function Receiving() {
  const [receipts, setReceipts] = useState([])
  const [clients, setClients] = useState([])
  const [catalogItems, setCatalogItems] = useState([])

  const [view, setView] = useState('list')
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState(null)
  const [activeTab, setActiveTab] = useState('items')

  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState({})

  const [form, setForm] = useState({
    clientId: '', clientName: '', referenceId: '', poNumber: '',
    arrivalDate: new Date().toISOString().slice(0,16),
    expectedDate: '', notes: '',
    carrier: '', trackingNumber: '', bolNumber: '',
    truckNumber: '', sealNumber: '', driverName: '',
    warehouseInstructions: '',
    lineItems: [{ ...emptyLineItem }],
    charges: []
  })
  const [loading, setLoading] = useState(false)

  const [editingItem, setEditingItem] = useState(null)
  const [editItemForm, setEditItemForm] = useState({ ...emptyLineItem })
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemForm, setNewItemForm] = useState({ ...emptyLineItem })
  const [skuDropdown, setSkuDropdown] = useState(null)
  const [skuSearch, setSkuSearch] = useState('')

  const [showScanner, setShowScanner] = useState(false)
  const [scanTarget, setScanTarget] = useState(null)

  const fetchData = async () => {
    const [receiptsSnap, clientsSnap, catalogSnap] = await Promise.all([
      getDocs(query(collection(db, 'receipts'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'items'))
    ])
    setReceipts(receiptsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setCatalogItems(catalogSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const clientSkus = (clientId) => catalogItems.filter(i => i.clientId === clientId)

  const filteredSkus = (clientId) => {
    const all = clientSkus(clientId)
    if (!skuSearch) return all
    return all.filter(i =>
      i.sku?.toLowerCase().includes(skuSearch.toLowerCase()) ||
      i.description?.toLowerCase().includes(skuSearch.toLowerCase())
    )
  }

  const toggleSection = (key) =>
    setSidebarCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const SectionHeader = ({ title, sectionKey }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="w-full flex items-center justify-between py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-200"
    >
      {title}
      <ChevronDown size={12} className={sidebarCollapsed[sectionKey] ? 'rotate-[-90deg]' : ''} />
    </button>
  )

  const handleScan = (barcode) => {
    setShowScanner(false)
    if (!scanTarget) return
    if (scanTarget.type === 'form') {
      const allSkus = clientSkus(form.clientId)
      const match = allSkus.find(s => s.sku === barcode || s.sku === barcode.toUpperCase())
      if (match) { selectSkuForForm(scanTarget.index, match) }
      else { updateFormLineItem(scanTarget.index, 'sku', barcode.toUpperCase()) }
    } else if (scanTarget.type === 'detail') {
      const allSkus = clientSkus(selectedReceipt?.clientId)
      const match = allSkus.find(s => s.sku === barcode || s.sku === barcode.toUpperCase())
      setNewItemForm(prev => ({
        ...prev,
        sku: match ? match.sku : barcode.toUpperCase(),
        description: match?.description || ''
      }))
      setShowAddItem(true)
    }
    setScanTarget(null)
  }

  const handleCreate = async () => {
    if (!form.clientId || !form.arrivalDate) return
    setLoading(true)
    try {
      const validItems = form.lineItems.filter(i => i.sku)
      const totalPallets = validItems.reduce((s, i) => s + Number(i.quantity || 0), 0)
      const totalWeight = validItems.reduce((s, i) => s + Number(i.weight || 0), 0)
      const confirmedCharges = (form.charges || []).filter(c => c.status === 'confirmed' || c.status === 'adjusted')
      const totalCharges = confirmedCharges.reduce((s, c) => s + Number(c.total || 0), 0)

      const receiptData = {
        transactionId: genTransactionId(),
        clientId: form.clientId,
        clientName: form.clientName,
        referenceId: form.referenceId,
        poNumber: form.poNumber,
        arrivalDate: form.arrivalDate,
        expectedDate: form.expectedDate,
        notes: form.notes,
        carrier: form.carrier,
        trackingNumber: form.trackingNumber,
        bolNumber: form.bolNumber,
        truckNumber: form.truckNumber,
        sealNumber: form.sealNumber,
        driverName: form.driverName,
        warehouseInstructions: form.warehouseInstructions,
        lineItems: validItems,
        charges: form.charges || [],
        totalPallets,
        totalUnits: totalPallets,
        totalWeight,
        totalCharges,
        status: 'open',
        createdAt: new Date().toISOString()
      }

      const receiptDoc = await addDoc(collection(db, 'receipts'), receiptData)

      for (const item of validItems) {
        const pallets = Number(item.quantity || 1)
        for (let p = 0; p < pallets; p++) {
          await addDoc(collection(db, 'inventory'), {
            palletId: generatePalletId(),
            clientId: form.clientId,
            clientName: form.clientName,
            sku: item.sku.toUpperCase(),
            description: item.description,
            units: 1,
            condition: item.condition || 'A',
            location: item.location || '',
            status: 'available',
            receivedDate: form.arrivalDate.split('T')[0],
            poNumber: form.poNumber,
            receiptId: receiptDoc.id,
            weight: item.weight || '',
            createdAt: new Date().toISOString()
          })
        }
      }

      setView('list')
      resetForm()
      fetchData()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const resetForm = () => setForm({
    clientId: '', clientName: '', referenceId: '', poNumber: '',
    arrivalDate: new Date().toISOString().slice(0,16),
    expectedDate: '', notes: '', carrier: '', trackingNumber: '',
    bolNumber: '', truckNumber: '', sealNumber: '', driverName: '',
    warehouseInstructions: '', lineItems: [{ ...emptyLineItem }], charges: []
  })

  const addFormLineItem = () =>
    setForm({ ...form, lineItems: [...form.lineItems, { ...emptyLineItem }] })

  const removeFormLineItem = (i) =>
    setForm({ ...form, lineItems: form.lineItems.filter((_, idx) => idx !== i) })

  const updateFormLineItem = (i, field, value) => {
    const items = [...form.lineItems]
    items[i] = { ...items[i], [field]: value }
    setForm({ ...form, lineItems: items })
  }

  const selectSkuForForm = (i, catalogItem) => {
    const items = [...form.lineItems]
    items[i] = { ...items[i], sku: catalogItem.sku, description: catalogItem.description || '', weight: catalogItem.weight || '' }
    setForm({ ...form, lineItems: items })
    setSkuDropdown(null)
    setSkuSearch('')
  }

  const chargesTotal = (charges) =>
    (charges || []).reduce((s, c) => s + Number(c.total || 0), 0)

  const saveReceiptField = async (id, field, value) => {
    await updateDoc(doc(db, 'receipts', id), { [field]: value })
    fetchData()
  }

  const confirmReceipt = async () => {
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { status: 'confirmed' })
    setSelectedReceipt({ ...selectedReceipt, status: 'confirmed' })
    fetchData()
  }

  const completeReceipt = async () => {
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), {
      status: 'complete',
      completedAt: new Date().toISOString()
    })
    setSelectedReceipt({ ...selectedReceipt, status: 'complete' })
    fetchData()
  }

  const addLineItemToReceipt = async () => {
    if (!newItemForm.sku) return
    const updated = [...(selectedReceipt.lineItems || []), { ...newItemForm, sku: newItemForm.sku.toUpperCase() }]
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })
    const pallets = Number(newItemForm.quantity || 1)
    for (let p = 0; p < pallets; p++) {
      await addDoc(collection(db, 'inventory'), {
        palletId: generatePalletId(),
        clientId: selectedReceipt.clientId,
        clientName: selectedReceipt.clientName,
        sku: newItemForm.sku.toUpperCase(),
        description: newItemForm.description,
        units: 1,
        condition: newItemForm.condition || 'A',
        location: newItemForm.location || '',
        status: 'available',
        receivedDate: selectedReceipt.arrivalDate?.split('T')[0] || new Date().toISOString().split('T')[0],
        poNumber: selectedReceipt.poNumber || '',
        receiptId: selectedReceipt.id,
        createdAt: new Date().toISOString()
      })
    }
    setSelectedReceipt({ ...selectedReceipt, lineItems: updated })
    setNewItemForm({ ...emptyLineItem })
    setShowAddItem(false)
    fetchData()
  }

  const saveEditItem = async (i) => {
    const updated = [...(selectedReceipt.lineItems || [])]
    updated[i] = { ...editItemForm, sku: editItemForm.sku.toUpperCase() }
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })
    setSelectedReceipt({ ...selectedReceipt, lineItems: updated })
    setEditingItem(null)
    fetchData()
  }

  const deleteLineItem = async (i) => {
    if (!window.confirm('Remove this line item?')) return
    const updated = (selectedReceipt.lineItems || []).filter((_, idx) => idx !== i)
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })
    setSelectedReceipt({ ...selectedReceipt, lineItems: updated })
    fetchData()
  }

  const filtered = receipts.filter(r => {
    if (filterClient && r.clientId !== filterClient) return false
    if (filterStatus && r.status !== filterStatus) return false
    if (filterSearch &&
      !r.referenceId?.toLowerCase().includes(filterSearch.toLowerCase()) &&
      !r.clientName?.toLowerCase().includes(filterSearch.toLowerCase()) &&
      !r.poNumber?.toLowerCase().includes(filterSearch.toLowerCase())) return false
    if (filterDateFrom && r.arrivalDate && r.arrivalDate < filterDateFrom) return false
    if (filterDateTo && r.arrivalDate && r.arrivalDate > filterDateTo) return false
    return true
  })

  // ═══════════════════════════════════════════════════════════════════
  // NEW RECEIPT VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'new') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('list'); resetForm() }}
              className="text-gray-400 hover:text-white flex items-center gap-1 text-sm">
              <ArrowLeft size={16} /> Receipts
            </button>
            <span className="text-gray-600">/</span>
            <h2 className="text-xl font-semibold text-white">New Receipt</h2>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setScanTarget({ type: 'form', index: 0 }); setShowScanner(true) }}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
              📷 Scan SKU
            </button>
            <button onClick={() => { setView('list'); resetForm() }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={loading || !form.clientId || !form.arrivalDate}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
              {loading ? 'Saving...' : 'Create Receipt'}
            </button>
          </div>
        </div>

        <div className="flex gap-2 border-b border-gray-800 mb-4">
          {[
            { id: 'transport', label: 'Transport Information', icon: Truck },
            { id: 'items',     label: 'Receipt Line Items',    icon: Package },
            { id: 'charges',   label: 'Receipt Charges',       icon: DollarSign },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              <tab.icon size={14} />{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'transport' && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Order Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Customer *</label>
                  <select value={form.clientId} onChange={e => {
                    const c = clients.find(x => x.id === e.target.value)
                    setForm({ ...form, clientId: e.target.value, clientName: c?.companyName || '' })
                  }} className={inputCls}>
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Reference ID</label>
                  <input value={form.referenceId} onChange={e => setForm({ ...form, referenceId: e.target.value })} className={inputCls} placeholder="GAOU6317185" />
                </div>
                <div>
                  <label className={labelCls}>Purchase Order</label>
                  <input value={form.poNumber} onChange={e => setForm({ ...form, poNumber: e.target.value })} className={inputCls} placeholder="PO-001" />
                </div>
                <div>
                  <label className={labelCls}>Arrival Date *</label>
                  <input type="datetime-local" value={form.arrivalDate} onChange={e => setForm({ ...form, arrivalDate: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expected Date</label>
                  <input type="datetime-local" value={form.expectedDate} onChange={e => setForm({ ...form, expectedDate: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Warehouse Instructions</label>
                  <input value={form.warehouseInstructions} onChange={e => setForm({ ...form, warehouseInstructions: e.target.value })} className={inputCls} placeholder="Special instructions..." />
                </div>
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Transport Details</h3>
              <div className="grid grid-cols-3 gap-4">
                <div><label className={labelCls}>Carrier</label><input value={form.carrier} onChange={e => setForm({ ...form, carrier: e.target.value })} className={inputCls} placeholder="UPS, FedEx..." /></div>
                <div><label className={labelCls}>Tracking Number</label><input value={form.trackingNumber} onChange={e => setForm({ ...form, trackingNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>BOL Number</label><input value={form.bolNumber} onChange={e => setForm({ ...form, bolNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Truck Number</label><input value={form.truckNumber} onChange={e => setForm({ ...form, truckNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Seal Number</label><input value={form.sealNumber} onChange={e => setForm({ ...form, sealNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Driver Name</label><input value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })} className={inputCls} /></div>
              </div>
              <div className="mt-4">
                <label className={labelCls}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2} className={inputCls + ' resize-none'} placeholder="Any additional notes..." />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'items' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-medium">Receipt Line Items</h3>
              <div className="flex gap-2">
                <button onClick={() => { setScanTarget({ type: 'form', index: form.lineItems.length - 1 }); setShowScanner(true) }}
                  className="flex items-center gap-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">
                  📷 Scan
                </button>
                <button onClick={addFormLineItem}
                  className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">
                  <Plus size={13} /> Add Line Item
                </button>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 mb-2 px-2 text-gray-500 text-xs border-b border-gray-800 pb-2">
              <div className="col-span-2">SKU</div>
              <div className="col-span-3">Description</div>
              <div className="col-span-1">Qty</div>
              <div className="col-span-1">Unit</div>
              <div className="col-span-1">Cond.</div>
              <div className="col-span-2">Location</div>
              <div className="col-span-1">Weight</div>
              <div className="col-span-1"></div>
            </div>
            {form.lineItems.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2">
                <div className="col-span-2 relative">
                  <div className="flex items-center gap-1">
                    <div className="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden focus-within:border-blue-500">
                      <Search size={11} className="text-gray-500 ml-2 flex-shrink-0" />
                      <input
                        value={item.sku}
                        onChange={e => { updateFormLineItem(i, 'sku', e.target.value.toUpperCase()); setSkuSearch(e.target.value); setSkuDropdown(i) }}
                        onFocus={() => { setSkuSearch(''); setSkuDropdown(i) }}
                        onBlur={() => setTimeout(() => setSkuDropdown(null), 150)}
                        className="flex-1 bg-transparent text-white px-2 py-2 text-xs focus:outline-none uppercase"
                        placeholder="SKU..."
                      />
                    </div>
                    <button onClick={() => { setScanTarget({ type: 'form', index: i }); setShowScanner(true) }}
                      className="text-blue-400 hover:text-blue-300 p-1 flex-shrink-0" title="Scan barcode">
                      📷
                    </button>
                  </div>
                  {skuDropdown === i && filteredSkus(form.clientId).length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                      {filteredSkus(form.clientId)
                        .filter(s => !skuSearch || s.sku.toLowerCase().includes(skuSearch.toLowerCase()) || s.description?.toLowerCase().includes(skuSearch.toLowerCase()))
                        .map(s => (
                          <button key={s.id} onMouseDown={() => selectSkuForForm(i, s)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-700 border-b border-gray-700/50 last:border-0">
                            <span className="text-white text-xs font-mono">{s.sku}</span>
                            <p className="text-gray-400 text-xs truncate">{s.description}</p>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <input value={item.description} onChange={e => updateFormLineItem(i, 'description', e.target.value)}
                  className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="Description" />
                <input type="number" value={item.quantity} onChange={e => updateFormLineItem(i, 'quantity', e.target.value)}
                  className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="0" />
                <select value={item.primaryUnits} onChange={e => updateFormLineItem(i, 'primaryUnits', e.target.value)}
                  className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none">
                  <option>Pallet</option><option>Each</option><option>Case</option><option>Box</option>
                </select>
                <select value={item.condition} onChange={e => updateFormLineItem(i, 'condition', e.target.value)}
                  className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none">
                  <option value="A">A</option><option value="B">B</option><option value="C">C</option>
                </select>
                <input value={item.location} onChange={e => updateFormLineItem(i, 'location', e.target.value)}
                  className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="Location" />
                <input type="number" value={item.weight} onChange={e => updateFormLineItem(i, 'weight', e.target.value)}
                  className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="lbs" />
                <button onClick={() => removeFormLineItem(i)} disabled={form.lineItems.length === 1}
                  className="col-span-1 text-gray-600 hover:text-red-400 disabled:opacity-20 flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
            ))}
            <div className="border-t border-gray-800 mt-4 pt-3 flex justify-end gap-8 text-sm">
              <span className="text-gray-400">Total Pallets: <span className="text-white font-medium">{form.lineItems.reduce((s, i) => s + Number(i.quantity || 0), 0)}</span></span>
              <span className="text-gray-400">Total Weight: <span className="text-white font-medium">{form.lineItems.reduce((s, i) => s + Number(i.weight || 0), 0)} lbs</span></span>
            </div>
          </div>
        )}

        {activeTab === 'charges' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Receipt Charges</h3>
            <TransactionCharges
              charges={(form.charges || []).map((c, i) => ({ ...c, id: c.id || i, status: c.status || 'confirmed' }))}
              onChargesChange={newCharges => setForm({ ...form, charges: newCharges })}
              rateCard={clients.find(c => c.id === form.clientId)?.rateCard || []}
              trigger="on_receive"
              quantities={{
                pallets: form.lineItems.reduce((s, i) => s + Number(i.quantity || 0), 0),
                units: form.lineItems.reduce((s, i) => s + Number(i.quantity || 0), 0),
                cartons: 0,
                orders: 1,
              }}
              clientName={form.clientName}
            />
          </div>
        )}

        {showScanner && (
          <BarcodeScanner title="Scan SKU Barcode" onScan={handleScan}
            onClose={() => { setShowScanner(false); setScanTarget(null) }} />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedReceipt) {
    const r = receipts.find(x => x.id === selectedReceipt.id) || selectedReceipt
    const sc = statusConfig[r.status] || statusConfig.open
    const StatusIcon = sc.icon

    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('list'); setSelectedReceipt(null) }}
              className="text-gray-400 hover:text-white flex items-center gap-1 text-sm">
              <ArrowLeft size={16} /> Receipts
            </button>
            <span className="text-gray-600">/</span>
            <h2 className="text-white font-semibold">{r.referenceId || `Receipt ${r.id.slice(-6)}`}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${sc.color}`}>
              <StatusIcon size={10} /> {sc.label}
            </span>
          </div>
          <div className="flex gap-2">
            {(!r.status || r.status === 'open') && (
              <button onClick={async () => {
                if (!window.confirm('Delete this receipt? This cannot be undone.')) return
                const { deleteDoc, doc: fsDoc } = await import('firebase/firestore')
                await deleteDoc(fsDoc(db, 'receipts', r.id))
                setView('list'); setSelectedReceipt(null); fetchData()
              }} className="flex items-center gap-1.5 text-sm bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg">
                <X size={14}/> Delete Receipt
              </button>
            )}
            {r.status === 'open' && (
              <button onClick={confirmReceipt}
                className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg">
                <CheckCircle size={14} /> Confirm Receipt
              </button>
            )}
            {r.status === 'confirmed' && (
              <button onClick={completeReceipt}
                className="flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg">
                <CheckCircle size={14} /> Mark as Complete
              </button>
            )}
            {(r.status === 'complete' || r.status === 'cancelled') && (
              <button onClick={() => saveReceiptField(r.id, 'status', 'open')}
                className="flex items-center gap-1.5 text-sm bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 border border-yellow-600/20 px-3 py-2 rounded-lg">
                Reopen
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-6 gap-3 mb-4">
          {[
            { label: 'Customer',     value: r.clientName },
            { label: 'Reference #',  value: r.referenceId || '�' },
            { label: 'Transaction',  value: r.transactionId || r.id.slice(-6).toUpperCase() },
            { label: 'Arrival Date', value: r.arrivalDate ? new Date(r.arrivalDate).toLocaleDateString() : '�' },
            { label: 'Total Pallets',value: String(r.totalPallets || r.lineItems?.length || 0) },
            { label: 'Total Charges',value: `$${Number(r.totalCharges || 0).toFixed(2)}` },
          ].map(f => (
            <div key={f.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 mb-0.5">{f.label}</p>
              <p className="text-white text-sm font-medium truncate">{f.value}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-b border-gray-800 mb-4">
          {[
            { id: 'transport', label: 'Transport Information', icon: Truck },
            { id: 'items',     label: 'Receipt Line Items',    icon: Package },
            { id: 'charges',   label: 'Receipt Charges',       icon: DollarSign },
            { id: 'custom',    label: 'Custom Receipt Info',   icon: FileText },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              <tab.icon size={14} />{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'transport' && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Order Information</h3>
              <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                {[
                  ['Customer', r.clientName || '�'],
                  ['Reference ID', r.referenceId || '�'],
                  ['Purchase Order', r.poNumber || '�'],
                  ['Arrival Date', r.arrivalDate ? new Date(r.arrivalDate).toLocaleString() : '�'],
                  ['Expected Date', r.expectedDate ? new Date(r.expectedDate).toLocaleString() : '�'],
                  ['Warehouse Instructions', r.warehouseInstructions || '�'],
                ].map(([label, value]) => (
                  <div key={label}><span className="text-gray-500 text-xs">{label}</span><p className="text-white">{value}</p></div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Transport Details</h3>
              <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                {[
                  ['Carrier', r.carrier || '�'],
                  ['Tracking #', r.trackingNumber || '�'],
                  ['BOL #', r.bolNumber || '�'],
                  ['Truck #', r.truckNumber || '�'],
                  ['Seal #', r.sealNumber || '�'],
                  ['Driver', r.driverName || '�'],
                ].map(([label, value]) => (
                  <div key={label}><span className="text-gray-500 text-xs">{label}</span><p className="text-white">{value}</p></div>
                ))}
              </div>
              {r.notes && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <span className="text-gray-500 text-xs">Notes</span>
                  <p className="text-white text-sm mt-1">{r.notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'items' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h3 className="text-white font-medium">Receipt Line Items</h3>
              <div className="flex gap-2 items-center">
                <span className="text-gray-500 text-xs">{(r.lineItems || []).length} results</span>
                {r.status !== 'complete' && (
                  <>
                    <button onClick={() => { setScanTarget({ type: 'detail' }); setShowScanner(true) }}
                      className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">
                      📷 Scan
                    </button>
                    <button onClick={() => { setShowAddItem(!showAddItem); setNewItemForm({ ...emptyLineItem }) }}
                      className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">
                      <Plus size={13} /> Add Line Item
                    </button>
                  </>
                )}
              </div>
            </div>

            {showAddItem && (
              <div className="px-5 py-4 border-b border-gray-800 bg-gray-800/30">
                <p className="text-white text-sm font-medium mb-3">New Line Item</p>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-2">
                    <label className={labelCls}>SKU *</label>
                    <div className="relative">
                      <input value={newItemForm.sku}
                        onChange={e => { setNewItemForm({ ...newItemForm, sku: e.target.value.toUpperCase() }); setSkuSearch(e.target.value); setSkuDropdown('new') }}
                        onFocus={() => { setSkuSearch(''); setSkuDropdown('new') }}
                        onBlur={() => setTimeout(() => setSkuDropdown(null), 150)}
                        className={inputCls} placeholder="SKU..." />
                      {skuDropdown === 'new' && filteredSkus(r.clientId).length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto">
                          {filteredSkus(r.clientId).map(s => (
                            <button key={s.id}
                              onMouseDown={() => { setNewItemForm({ ...newItemForm, sku: s.sku, description: s.description || '' }); setSkuDropdown(null) }}
                              className="w-full text-left px-3 py-2 hover:bg-gray-700 text-xs border-b border-gray-700/50 last:border-0">
                              <span className="text-white font-mono">{s.sku}</span>
                              <p className="text-gray-400 truncate">{s.description}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="col-span-3"><label className={labelCls}>Description</label><input value={newItemForm.description} onChange={e => setNewItemForm({ ...newItemForm, description: e.target.value })} className={inputCls} placeholder="Description" /></div>
                  <div className="col-span-1"><label className={labelCls}>Qty</label><input type="number" value={newItemForm.quantity} onChange={e => setNewItemForm({ ...newItemForm, quantity: e.target.value })} className={inputCls} placeholder="0" /></div>
                  <div className="col-span-1"><label className={labelCls}>Unit</label><select value={newItemForm.primaryUnits} onChange={e => setNewItemForm({ ...newItemForm, primaryUnits: e.target.value })} className={inputCls}><option>Pallet</option><option>Each</option><option>Case</option></select></div>
                  <div className="col-span-1"><label className={labelCls}>Cond.</label><select value={newItemForm.condition} onChange={e => setNewItemForm({ ...newItemForm, condition: e.target.value })} className={inputCls}><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></div>
                  <div className="col-span-2"><label className={labelCls}>Location</label><input value={newItemForm.location} onChange={e => setNewItemForm({ ...newItemForm, location: e.target.value })} className={inputCls} placeholder="Bin" /></div>
                  <div className="col-span-1"><label className={labelCls}>Weight</label><input type="number" value={newItemForm.weight} onChange={e => setNewItemForm({ ...newItemForm, weight: e.target.value })} className={inputCls} placeholder="lbs" /></div>
                  <div className="col-span-1 flex gap-2 items-end">
                    <button onClick={addLineItemToReceipt} disabled={!newItemForm.sku}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg py-2.5 text-xs">Add</button>
                    <button onClick={() => setShowAddItem(false)} className="text-gray-500 hover:text-white pb-1"><X size={16} /></button>
                  </div>
                </div>
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/50">
                  {['SKU', 'Description', 'Qty', 'Primary Unit', 'Cond.', 'Location', 'Weight', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(r.lineItems || []).length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-500 text-sm">No line items</td></tr>
                ) : (r.lineItems || []).map((item, i) => (
                  <tr key={i} className={`border-b border-gray-800/50 ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                    {editingItem === i ? (
                      <>
                        <td className="px-4 py-2"><input value={editItemForm.sku} onChange={e => setEditItemForm({ ...editItemForm, sku: e.target.value.toUpperCase() })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs w-28 focus:outline-none" /></td>
                        <td className="px-4 py-2"><input value={editItemForm.description} onChange={e => setEditItemForm({ ...editItemForm, description: e.target.value })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs w-full focus:outline-none" /></td>
                        <td className="px-4 py-2"><input type="number" value={editItemForm.quantity} onChange={e => setEditItemForm({ ...editItemForm, quantity: e.target.value })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs w-16 focus:outline-none" /></td>
                        <td className="px-4 py-2"><select value={editItemForm.primaryUnits} onChange={e => setEditItemForm({ ...editItemForm, primaryUnits: e.target.value })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none"><option>Pallet</option><option>Each</option><option>Case</option></select></td>
                        <td className="px-4 py-2"><select value={editItemForm.condition} onChange={e => setEditItemForm({ ...editItemForm, condition: e.target.value })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none"><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></td>
                        <td className="px-4 py-2"><input value={editItemForm.location} onChange={e => setEditItemForm({ ...editItemForm, location: e.target.value })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs w-24 focus:outline-none" /></td>
                        <td className="px-4 py-2"><input type="number" value={editItemForm.weight} onChange={e => setEditItemForm({ ...editItemForm, weight: e.target.value })} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs w-16 focus:outline-none" /></td>
                        <td className="px-4 py-2">
                          <div className="flex gap-2">
                            <button onClick={() => saveEditItem(i)} className="text-green-400 hover:text-green-300"><Save size={14} /></button>
                            <button onClick={() => setEditingItem(null)} className="text-gray-500 hover:text-white"><X size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-white font-mono text-xs font-medium">{item.sku}</td>
                        <td className="px-4 py-3 text-gray-300 text-xs max-w-xs truncate">{item.description || '�'}</td>
                        <td className="px-4 py-3 text-white font-medium">{item.quantity || '�'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{item.primaryUnits || 'Pallet'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${item.condition === 'A' ? 'bg-green-500/10 text-green-400' : item.condition === 'B' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
                            Grade {item.condition || 'A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-xs">{item.location || '�'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{item.weight ? `${item.weight} lbs` : '�'}</td>
                        <td className="px-4 py-3">
                          {r.status !== 'complete' && (
                            <div className="flex gap-2">
                              <button onClick={() => { setEditingItem(i); setEditItemForm({ ...item }) }} className="text-gray-400 hover:text-white"><Pencil size={13} /></button>
                              <button onClick={() => deleteLineItem(i)} className="text-gray-400 hover:text-red-400"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/30">
                  <td colSpan={2} className="px-4 py-3 text-xs text-gray-400 font-medium">Totals</td>
                  <td className="px-4 py-3 text-white font-semibold">{(r.lineItems || []).reduce((s, i) => s + Number(i.quantity || 0), 0)}</td>
                  <td colSpan={3}></td>
                  <td className="px-4 py-3 text-white font-semibold">{(r.lineItems || []).reduce((s, i) => s + Number(i.weight || 0), 0)} lbs</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {activeTab === 'charges' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Receipt Charges</h3>
            <TransactionCharges
              charges={(r.charges || []).map((c, i) => ({ ...c, id: c.id || i, status: c.status || 'confirmed' }))}
              onChargesChange={newCharges => {
                const updated = { ...selectedReceipt, charges: newCharges }
                setSelectedReceipt(updated)
                saveReceiptField(selectedReceipt.id, 'charges', newCharges)
              }}
              rateCard={clients.find(c => c.id === r.clientId)?.rateCard || []}
              trigger="on_receive"
              quantities={{
                pallets: (r.lineItems || []).reduce((s, i) => s + Number(i.quantity || 0), 0),
                units: (r.lineItems || []).reduce((s, i) => s + Number(i.quantity || 0), 0),
                cartons: 0,
                orders: 1,
              }}
              clientName={r.clientName}
              readOnly={r.status === 'complete'}
            />
          </div>
        )}

        {activeTab === 'custom' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Custom Receipt Info</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ['Receipt ID', r.id],
                ['Status', sc.label],
                ['Created', r.createdAt ? new Date(r.createdAt).toLocaleString() : '�'],
                ['Completed', r.completedAt ? new Date(r.completedAt).toLocaleString() : '�'],
                ['Total Pallets', String(r.totalPallets || 0)],
                ['Total Weight', r.totalWeight ? `${r.totalWeight} lbs` : '�'],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="text-gray-500 text-xs">{label}</span>
                  <p className="text-white font-mono text-xs mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {showScanner && (
          <BarcodeScanner title="Scan SKU Barcode" onScan={handleScan}
            onClose={() => { setShowScanner(false); setScanTarget(null) }} />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-800">
          <span className="text-white text-xs font-semibold">Search Filters</span>
        </div>
        <div className="px-4 py-3 space-y-4 flex-1">
          <div>
            <SectionHeader title="Search by Customer" sectionKey="customer" />
            {!sidebarCollapsed.customer && (
              <div className="space-y-2 pb-2">
                <div>
                  <label className={labelCls}>Customer</label>
                  <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none">
                    <option value="">All clients</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-gray-800" />
          <div>
            <SectionHeader title="Search by Date Range" sectionKey="date" />
            {!sidebarCollapsed.date && (
              <div className="space-y-2 pb-2">
                <div><label className={labelCls}>Arrival From</label><input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" /></div>
                <div><label className={labelCls}>Arrival To</label><input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" /></div>
              </div>
            )}
          </div>
          <div className="border-t border-gray-800" />
          <div>
            <SectionHeader title="Receipt Details" sectionKey="details" />
            {!sidebarCollapsed.details && (
              <div className="space-y-2 pb-2">
                <div>
                  <label className={labelCls}>Receipt Status</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none">
                    <option value="">All statuses</option>
                    <option value="open">Open</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="complete">Complete</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Reference ID</label>
                  <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                    <span className="text-gray-500 text-xs px-2">Contains</span>
                    <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
                      className="flex-1 bg-transparent text-white text-xs px-2 py-1.5 focus:outline-none" placeholder="Search..." />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-800">
          <button onClick={() => { setFilterClient(''); setFilterStatus(''); setFilterSearch(''); setFilterDateFrom(''); setFilterDateTo('') }}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-2 rounded-lg transition-colors">
            Clear Filters
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Receipts</h2>
              <p className="text-sm text-gray-500 mt-0.5">{filtered.length} results</p>
            </div>
            <div className="flex gap-2">
            <button onClick={() => setShowBulkUpload(true)}
              className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              Bulk Upload
            </button>
            <button onClick={() => { setView('new'); setActiveTab('transport') }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              <Plus size={16} /> New Receipt
            </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-6 pb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/50">
                  {['Transaction ID', 'Reference Number', 'Creation Date', 'Customer', 'SKUs', 'Arrival Date', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12"><Package size={32} className="text-gray-700 mx-auto mb-3" /><p className="text-gray-500 text-sm">No receipts found</p></td></tr>
                ) : filtered.map((r, i) => {
                  const sc = statusConfig[r.status] || statusConfig.open
                  const StatusIcon = sc.icon
                  const skuList = (r.lineItems || r.pallets || []).map(p => p.sku).filter(Boolean).join(', ')
                  return (
                    <tr key={r.id} onClick={() => { setSelectedReceipt(r); setActiveTab('items'); setView('detail') }}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                      <td className="px-4 py-3 text-blue-400 font-mono text-xs font-medium">{r.transactionId || r.id.slice(-6).toUpperCase()}</td>
                      <td className="px-4 py-3 text-white text-xs font-medium">{r.referenceId || r.poNumber || '�'}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '�'}</td>
                      <td className="px-4 py-3 text-white text-sm font-medium">{r.clientName}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{skuList || '�'}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{r.arrivalDate ? new Date(r.arrivalDate).toLocaleDateString() : '�'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit ${sc.color}`}>
                          <StatusIcon size={10} /> {sc.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      {showBulkUpload && (
        <BulkUpload type="receipts" onClose={() => setShowBulkUpload(false)} onSuccess={fetchData} />
      )}
      </div>
    </div>
  )
}
