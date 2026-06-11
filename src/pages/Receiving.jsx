import { useState, useEffect } from 'react'
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, runTransaction, setDoc
} from 'firebase/firestore'
import { db } from '../firebase'
import jsPDF from 'jspdf'
import {
  Plus, X, Package, ChevronDown, ChevronRight, Search,
  ArrowLeft, Truck, DollarSign, FileText,
  CheckCircle, Clock, Pencil, Trash2, Save, Filter, X as XIcon, Layers, AlertTriangle, Hash
 } from 'lucide-react'
import BarcodeScanner from '../components/BarcodeScanner'
import TransactionCharges from '../components/TransactionCharges'
import BulkUpload from '../components/BulkUpload'

// ──────────────────────────────────────────────────────────────────────
// PALLET ID GENERATION (5-digit zero-padded, atomic via Firestore txn)
// ──────────────────────────────────────────────────────────────────────
const generateSequentialPalletId = async () => {
  const counterRef = doc(db, 'system', 'counters')
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const current = snap.exists() ? (snap.data().palletId || 0) : 0
    const incremented = current + 1
    tx.set(counterRef, { palletId: incremented }, { merge: true })
    return incremented
  })
  return String(next).padStart(5, '0')
}

const reservePalletIds = async (count) => {
  if (count <= 0) return []
  const counterRef = doc(db, 'system', 'counters')
  const startEnd = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const current = snap.exists() ? (snap.data().palletId || 0) : 0
    const newValue = current + count
    tx.set(counterRef, { palletId: newValue }, { merge: true })
    return { start: current + 1, end: newValue }
  })
  const ids = []
  for (let i = startEnd.start; i <= startEnd.end; i++) {
    ids.push(String(i).padStart(5, '0'))
  }
  return ids
}

const isLegacyPalletId = (id) => typeof id === 'string' && /^\d{8}-\d{4}$/.test(id)
const generatePalletId = generateSequentialPalletId

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

const RECEIPT_TYPES = [
  { value: 'fcl_loose',       label: 'FCL — Loose' },
  { value: 'fcl_palletized',  label: 'FCL — Palletized' },
  { value: 'lcl',             label: 'LCL — Palletized' },
  { value: 'parcel',          label: 'Parcel (Loose Cartons)' },
]
const CONTAINER_SIZES = ['20\'GP', '40\'GP', '40\'HQ', '45\'HQ']
const PARCEL_WEIGHT_CLASSES = ['< 1 lb', '1–5 lbs', '5–20 lbs', '20–70 lbs', '70+ lbs']

const emptyLineItem = {
  sku: '', description: '', quantity: '', primaryUnits: 'Pallet',
  location: '', condition: 'A', weight: '', volume: '', notes: '',
  pallets: []
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

  // List filters
  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const activeFilterCount = [filterClient, filterStatus, filterSearch, filterDateFrom, filterDateTo].filter(v => v).length
  const [filtersExpanded, setFiltersExpanded] = useState(() => localStorage.getItem('jct-receiving-filters') !== 'collapsed')
  const toggleFilters = () => { const v = !filtersExpanded; setFiltersExpanded(v); localStorage.setItem('jct-receiving-filters', v ? 'expanded' : 'collapsed') }
  const clearFilters = () => { setFilterClient(''); setFilterStatus(''); setFilterSearch(''); setFilterDateFrom(''); setFilterDateTo('') }
  const [sidebarCollapsed, setSidebarCollapsed] = useState({})

  // Pallet generator modal (works for both new-form and detail edit)
  // mode 'form' = updates form.lineItems[i].pallets[]
  // mode 'detail-open' = updates selectedReceipt.lineItems[i].pallets[] (receipt is 'open')
  // mode 'detail-live' = creates inventory docs immediately (receipt is confirmed/complete)
  const [palletGenModal, setPalletGenModal] = useState(null)
  const [palletGenConfig, setPalletGenConfig] = useState({ remainderMode: 'partial' })
  const [generatingPallets, setGeneratingPallets] = useState(false)

  // Palletize Cartons modal — separate workflow for carton-unit lines.
  // Allows manual allocation of N cartons across M pallets.
  // { mode, lineIndex, sku, description, totalCartons, cartonsPerPallet, pallets: [{tmpId, cartons, location}] }
  const [palletizeModal, setPalletizeModal] = useState(null)
  const [palletizing, setPalletizing] = useState(false)

  // New-receipt form
  const [form, setForm] = useState({
    clientId: '', clientName: '', referenceId: '', poNumber: '',
    arrivalDate: new Date().toISOString().slice(0,16),
    expectedDate: '', notes: '',
    carrier: '', trackingNumber: '', bolNumber: '',
    truckNumber: '', sealNumber: '', driverName: '',
    warehouseInstructions: '',
    receiptType: 'fcl_palletized', containerSize: '40\'HQ', parcelWeightClass: '',
    parcelIncludePalletizing: false,
    lineItems: [{ ...emptyLineItem }],
    charges: []
  })
  const [loading, setLoading] = useState(false)

  // Detail-view edit state
  const [editingTransport, setEditingTransport] = useState(false)
  const [transportForm, setTransportForm] = useState({})
  const [expandedLines, setExpandedLines] = useState({})  // { lineIndex: bool }
  const [editingItem, setEditingItem] = useState(null)    // line index being edited
  const [editItemForm, setEditItemForm] = useState({ ...emptyLineItem })
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemForm, setNewItemForm] = useState({ ...emptyLineItem })
  const [skuDropdown, setSkuDropdown] = useState(null)
  const [skuSearch, setSkuSearch] = useState('')

  // Live inventory for the receipt being viewed (when confirmed/complete)
  const [detailInventory, setDetailInventory] = useState([])

  const [showScanner, setShowScanner] = useState(false)
  const [scanTarget, setScanTarget] = useState(null)

  // ──────────────────────────────────────────────────────────────────
  // DATA LOAD
  // ──────────────────────────────────────────────────────────────────
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

  // Refresh a single client's data (rate card, split day, etc.)
  // Called when entering detail view or selecting a client in new-form,
  // so edits made on the Clients page show up immediately.
  const refreshClient = async (clientId) => {
    if (!clientId) return
    const { getDoc, doc: fsDoc } = await import('firebase/firestore')
    const snap = await getDoc(fsDoc(db, 'clients', clientId))
    if (!snap.exists()) return
    const fresh = { id: snap.id, ...snap.data() }
    setClients(prev => {
      const exists = prev.some(c => c.id === clientId)
      return exists ? prev.map(c => c.id === clientId ? fresh : c) : [...prev, fresh]
    })
  }

  const loadDetailInventory = async (receiptId) => {
    if (!receiptId) { setDetailInventory([]); return }
    const snap = await getDocs(query(collection(db, 'inventory'), where('receiptId', '==', receiptId)))
    setDetailInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => {
    if (view === 'detail' && selectedReceipt?.id) {
      loadDetailInventory(selectedReceipt.id)
      refreshClient(selectedReceipt.clientId)   // pull fresh rate card
      setTransportForm({
        referenceId: selectedReceipt.referenceId || '',
        poNumber: selectedReceipt.poNumber || '',
        arrivalDate: selectedReceipt.arrivalDate || '',
        expectedDate: selectedReceipt.expectedDate || '',
        warehouseInstructions: selectedReceipt.warehouseInstructions || '',
        carrier: selectedReceipt.carrier || '',
        trackingNumber: selectedReceipt.trackingNumber || '',
        bolNumber: selectedReceipt.bolNumber || '',
        truckNumber: selectedReceipt.truckNumber || '',
        sealNumber: selectedReceipt.sealNumber || '',
        driverName: selectedReceipt.driverName || '',
        notes: selectedReceipt.notes || '',
        receiptType: selectedReceipt.receiptType || 'fcl_palletized',
        containerSize: selectedReceipt.containerSize || '40\'HQ',
        parcelWeightClass: selectedReceipt.parcelWeightClass || '',
        parcelIncludePalletizing: !!selectedReceipt.parcelIncludePalletizing,
      })
      setEditingTransport(false)
      setExpandedLines({})
    } else {
      setDetailInventory([])
    }
  }, [view, selectedReceipt?.id])

  const clientSkus = (clientId) => catalogItems.filter(i => i.clientId === clientId)
  const filteredSkus = (clientId) => {
    const all = clientSkus(clientId)
    if (!skuSearch) return all
    return all.filter(i =>
      i.sku?.toLowerCase().includes(skuSearch.toLowerCase()) ||
      i.description?.toLowerCase().includes(skuSearch.toLowerCase())
    )
  }
  const findCatalogItem = (clientId, sku) =>
    catalogItems.find(c => c.clientId === clientId && (c.sku || '').toUpperCase() === (sku || '').toUpperCase())

  // Compute total pieces for a line item when its unit is a carton-class.
  // Pulls piecesPerCarton (or unitsPerCarton as fallback) from the item catalog.
  // Returns null if not a carton unit or catalog lacks the field — caller decides fallback.
  const isCartonUnit = (u) => ['carton', 'case', 'box'].includes((u || '').toLowerCase())
  const piecesForItem = (item, clientId) => {
    if (!item || !isCartonUnit(item.primaryUnits)) return null
    const cat = findCatalogItem(clientId, item.sku)
    const ppc = Number(cat?.piecesPerCarton || cat?.unitsPerCarton || 0)
    if (ppc <= 0) return null
    return Number(item.quantity || 0) * ppc
  }

  // ──────────────────────────────────────────────────────────────────
  // PALLET ACCESSORS (status-aware)
  // ──────────────────────────────────────────────────────────────────
  // Pallets for a line item in the DETAIL view:
  //   - status 'open'   → from receipt.lineItems[i].pallets[] (no inventory exists yet)
  //   - confirmed/etc.  → from detailInventory (live Firestore inventory docs)
  const palletsForLine = (lineItem) => {
    if (!selectedReceipt) return []
    const sku = (lineItem.sku || '').toUpperCase()
    if (selectedReceipt.status === 'open') {
      return (lineItem.pallets || []).map(p => ({ ...p, _source: 'doc' }))
    }
    return detailInventory
      .filter(p => (p.sku || '').toUpperCase() === sku)
      .map(p => ({ ...p, _source: 'inv' }))
  }

  // ──────────────────────────────────────────────────────────────────
  // PDF REPORT (unchanged from current)
  // ──────────────────────────────────────────────────────────────────
  const generateReceivingReport = async (r) => {
    if (!r) return
    const invSnap = await getDocs(query(collection(db, 'inventory'), where('receiptId', '==', r.id)))
    let palletDocs = invSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // For 'open' receipts there is no inventory yet — pull pallets from the receipt doc instead
    if (palletDocs.length === 0 && (r.lineItems || []).some(li => (li.pallets || []).length > 0)) {
      palletDocs = (r.lineItems || []).flatMap(li =>
        (li.pallets || []).map(p => ({
          palletId: p.palletId, units: p.units, location: p.location, condition: li.condition || 'A',
          sku: li.sku, description: li.description, clientId: r.clientId
        }))
      )
    }

    const skuGroups = new Map()
    palletDocs.forEach(p => {
      const key = p.sku || '(no sku)'
      if (!skuGroups.has(key)) {
        const catalog = catalogItems.find(it => it.clientId === p.clientId && it.sku === p.sku)
        skuGroups.set(key, { sku: key, description: p.description || catalog?.description || '', pallets: [] })
      }
      skuGroups.get(key).pallets.push(p)
    })

    const pdf = new jsPDF()
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    pdf.setFillColor(200, 16, 46); pdf.rect(0, 0, pw, 18, 'F')
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.setFont('helvetica', 'bold')
    pdf.text('Receiving Report', pw / 2, 12, { align: 'center' })
    pdf.setTextColor(200, 16, 46); pdf.setFontSize(13)
    pdf.text(r.clientName || '', 14, 28)
    pdf.setFontSize(9); pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal')
    pdf.text('Warehouse: JCT LOGISTICS INC.', 14, 35)
    pdf.text(`Date: ${new Date().toLocaleDateString()}`, 14, 41)
    pdf.setTextColor(200, 16, 46); pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
    pdf.text(`Transaction # : ${r.transactionId || r.id.slice(-6).toUpperCase()}`, pw - 14, 28, { align: 'right' })
    pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
    pdf.text(`Reference: ${r.referenceId || '-'}`, pw - 14, 35, { align: 'right' })
    pdf.text(`Arrival: ${r.arrivalDate ? new Date(r.arrivalDate).toLocaleDateString() : '-'}`, pw - 14, 41, { align: 'right' })

    let y = 52
    pdf.setDrawColor(220, 220, 220); pdf.line(14, y - 2, pw - 14, y - 2)
    pdf.setFontSize(9); pdf.setTextColor(27, 42, 74)
    const totalPallets = palletDocs.length
    const totalUnits = palletDocs.reduce((s, p) => s + Number(p.units || 0), 0)
    pdf.text(`Total Pallets: ${totalPallets}`, 14, y + 4)
    pdf.text(`Total Units: ${totalUnits}`, 80, y + 4)
    pdf.text(`Status: ${(r.status || 'pending').toUpperCase()}`, pw - 14, y + 4, { align: 'right' })
    y += 12
    pdf.setFillColor(27, 42, 74); pdf.rect(14, y, pw - 28, 7, 'F')
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
    pdf.text('PALLET', 17, y + 5); pdf.text('SKU', 55, y + 5); pdf.text('DESCRIPTION', 90, y + 5)
    pdf.text('UNITS', 140, y + 5); pdf.text('LOCATION', 158, y + 5)
    y += 11
    pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    for (const group of skuGroups.values()) {
      if (group.pallets.length === 0) continue
      if (y > ph - 25) { pdf.addPage(); y = 20 }
      pdf.setFillColor(240, 240, 240); pdf.rect(14, y - 4, pw - 28, 6, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
      pdf.text(`${group.sku}  -  ${group.description}`, 17, y)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
      y += 5
      for (const p of group.pallets) {
        if (y > ph - 20) { pdf.addPage(); y = 20 }
        pdf.text(p.palletId || '-', 17, y)
        pdf.text(group.sku, 55, y)
        pdf.text((group.description || '').slice(0, 30), 90, y)
        pdf.setFont('helvetica', 'bold'); pdf.text(String(p.units || 0), 140, y); pdf.setFont('helvetica', 'normal')
        pdf.text((p.location || '-').slice(0, 14), 158, y)
        pdf.setDrawColor(235, 235, 235); pdf.line(14, y + 2, pw - 14, y + 2)
        y += 6
      }
      y += 2
    }
    if (y > ph - 30) { pdf.addPage(); y = 20 }
    y = ph - 25
    pdf.setDrawColor(27, 42, 74)
    pdf.line(14, y, 80, y); pdf.text('Received by', 14, y + 4)
    pdf.line(90, y, 156, y); pdf.text('Checked by', 90, y + 4)
    pdf.line(166, y, pw - 14, y); pdf.text('Date', 166, y + 4)
    pdf.save(`Receipt-${r.transactionId || r.id.slice(-6)}-Report.pdf`)
  }

  // ──────────────────────────────────────────────────────────────────
  // SCANNER
  // ──────────────────────────────────────────────────────────────────
  const handleScan = (barcode) => {
    setShowScanner(false)
    if (!scanTarget) return
    if (scanTarget.type === 'form') {
      const allSkus = clientSkus(form.clientId)
      const match = allSkus.find(s => s.sku === barcode || s.sku === barcode.toUpperCase())
      if (match) selectSkuForForm(scanTarget.index, match)
      else updateFormLineItem(scanTarget.index, 'sku', barcode.toUpperCase())
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

  // ──────────────────────────────────────────────────────────────────
  // NEW RECEIPT — CREATE (no inventory yet; pallets live on receipt doc)
  // ──────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!form.clientId || !form.arrivalDate) return
    setLoading(true)
    try {
      const validItems = form.lineItems.filter(i => i.sku)
      // If user didn't open the generator, fall back to one 1-unit pallet per quantity unit —
      // but ONLY for Pallet-unit lines. For Carton/Each, pallets must be generated manually
      // (typically during palletizing), so we leave pallets[] empty here.
      for (let idx = 0; idx < validItems.length; idx++) {
        const it = validItems[idx]
        if (Array.isArray(it.pallets) && it.pallets.length > 0) continue
        if ((it.primaryUnits || '').toLowerCase() !== 'pallet') continue
        const qty = Number(it.quantity || 0)
        if (qty > 0) {
          const ids = await reservePalletIds(qty)
          it.pallets = ids.map(pid => ({ palletId: pid, units: 1, location: it.location || '', partial: false }))
        }
      }
      const totalPallets = validItems.reduce((s, i) => s + (i.pallets || []).length, 0)
      const totalUnits = validItems.reduce((s, i) => s + (i.pallets || []).reduce((u, p) => u + Number(p.units || 0), 0), 0)
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
        receiptType: form.receiptType,
        containerSize: form.containerSize,
        parcelWeightClass: form.parcelWeightClass,
        parcelIncludePalletizing: form.parcelIncludePalletizing || false,
        lineItems: validItems,
        charges: form.charges || [],
        totalPallets,
        totalUnits,
        totalWeight,
        totalCharges,
        status: 'open',
        createdAt: new Date().toISOString()
      }
      await addDoc(collection(db, 'receipts'), receiptData)
      setView('list')
      resetForm()
      fetchData()
    } catch (err) { console.error(err); alert('Failed to create receipt: ' + err.message) }
    setLoading(false)
  }

  const resetForm = () => setForm({
    clientId: '', clientName: '', referenceId: '', poNumber: '',
    arrivalDate: new Date().toISOString().slice(0,16),
    expectedDate: '', notes: '', carrier: '', trackingNumber: '',
    bolNumber: '', truckNumber: '', sealNumber: '', driverName: '',
    warehouseInstructions: '',
    receiptType: 'fcl_palletized', containerSize: '40\'HQ', parcelWeightClass: '',
    parcelIncludePalletizing: false,
    lineItems: [{ ...emptyLineItem }], charges: []
  })

  // ──────────────────────────────────────────────────────────────────
  // STATUS TRANSITIONS  (confirm / complete / reopen)
  // ──────────────────────────────────────────────────────────────────
  const confirmReceipt = async () => {
    if (!selectedReceipt) return
    try {
      // Check if inventory already exists (legacy receipts had it created at creation)
      const invSnap = await getDocs(query(collection(db, 'inventory'), where('receiptId', '==', selectedReceipt.id)))

      if (invSnap.empty) {
        // Fresh confirm: create inventory docs from receipt's lineItems[].pallets[]
        const lineItems = selectedReceipt.lineItems || []
        for (const item of lineItems) {
          if (!item.sku) continue
          let pallets = item.pallets || []
          // Auto-fallback: if no pallets staged, create one per qty unit — Pallet-unit lines only.
          // For Carton/Each lines, leave inventory empty unless pallets were generated explicitly.
          if (pallets.length === 0 && (item.primaryUnits || '').toLowerCase() === 'pallet' && Number(item.quantity || 0) > 0) {
            const ids = await reservePalletIds(Number(item.quantity))
            pallets = ids.map(pid => ({ palletId: pid, units: 1, location: item.location || '', partial: false }))
            // persist back to receipt doc
            const updated = lineItems.map(li => li === item ? { ...li, pallets } : li)
            await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })
          }
          for (const p of pallets) {
            await addDoc(collection(db, 'inventory'), {
              palletId: p.palletId,
              clientId: selectedReceipt.clientId,
              clientName: selectedReceipt.clientName,
              sku: (item.sku || '').toUpperCase(),
              description: item.description || '',
              units: Number(p.units || 0),
              condition: item.condition || 'A',
              location: p.location || item.location || '',
              status: 'available',
              receivedDate: (selectedReceipt.arrivalDate || '').split('T')[0] || new Date().toISOString().split('T')[0],
              poNumber: selectedReceipt.poNumber || '',
              receiptId: selectedReceipt.id,
              weight: item.weight || '',
              partial: !!p.partial,
              createdAt: new Date().toISOString()
            })
          }
        }
      }
      await updateDoc(doc(db, 'receipts', selectedReceipt.id), { status: 'confirmed' })
      setSelectedReceipt({ ...selectedReceipt, status: 'confirmed' })
      await loadDetailInventory(selectedReceipt.id)
      fetchData()
    } catch (err) { console.error(err); alert('Confirm failed: ' + err.message) }
  }

  const completeReceipt = async () => {
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), {
      status: 'complete',
      completedAt: new Date().toISOString()
    })
    setSelectedReceipt({ ...selectedReceipt, status: 'complete' })
    fetchData()
  }

  const reopenReceipt = async () => {
    if (!selectedReceipt) return
    try {
      const invSnap = await getDocs(query(collection(db, 'inventory'), where('receiptId', '==', selectedReceipt.id)))
      const allocated = invSnap.docs.filter(d => {
        const st = (d.data().status || 'available').toLowerCase()
        return st !== 'available'
      })
      if (allocated.length > 0) {
        alert(`Cannot reopen this receipt.\n\n${allocated.length} pallet(s) have already been allocated to an order or shipped. Once any item leaves the warehouse via an outbound transaction, the inbound receipt is locked.\n\nAllocated pallets: ${allocated.slice(0,5).map(d => d.data().palletId).join(', ')}${allocated.length > 5 ? ` … (+${allocated.length - 5} more)` : ''}`)
        return
      }
      if (!window.confirm(`Reopen this receipt?\n\nThis will REMOVE ${invSnap.size} pallet(s) from current inventory.\nThe receipt can then be edited; inventory will be re-created when you Confirm again.`)) return

      // Sync inventory data back onto receipt's lineItems[].pallets[] before deleting
      const palletsBySku = new Map()
      invSnap.docs.forEach(d => {
        const data = d.data()
        const sku = (data.sku || '').toUpperCase()
        if (!palletsBySku.has(sku)) palletsBySku.set(sku, [])
        palletsBySku.get(sku).push({
          palletId: data.palletId,
          units: Number(data.units || 0),
          location: data.location || '',
          partial: !!data.partial,
        })
      })
      const updatedLineItems = (selectedReceipt.lineItems || []).map(item => {
        const sku = (item.sku || '').toUpperCase()
        const livePallets = palletsBySku.get(sku)
        return livePallets ? { ...item, pallets: livePallets } : item
      })

      // Delete inventory docs in batches of 450 (Firestore batch limit is 500)
      const docs = invSnap.docs
      for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db)
        docs.slice(i, i + 450).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }

      await updateDoc(doc(db, 'receipts', selectedReceipt.id), {
        status: 'open',
        lineItems: updatedLineItems,
        completedAt: null,
      })
      const next = { ...selectedReceipt, status: 'open', lineItems: updatedLineItems }
      setSelectedReceipt(next)
      await loadDetailInventory(selectedReceipt.id)
      fetchData()
    } catch (err) { console.error(err); alert('Reopen failed: ' + err.message) }
  }

  // ──────────────────────────────────────────────────────────────────
  // PALLET GENERATOR — shared between new-form and detail view
  // ──────────────────────────────────────────────────────────────────
  const openPalletGeneratorForForm = (lineIndex) => {
    const item = form.lineItems[lineIndex]
    if (!item.sku) { alert('Select a SKU first'); return }
    const qty = Number(item.quantity)
    if (!qty || qty <= 0) { alert('Enter a positive quantity first'); return }
    const catalog = findCatalogItem(form.clientId, item.sku)
    const unitsPerPallet = Number(catalog?.unitsPerPallet || 0)
    setPalletGenModal({ mode: 'form', lineIndex, qty, unitsPerPallet, sku: item.sku })
    setPalletGenConfig({ remainderMode: 'partial' })
  }

  const openPalletGeneratorForDetail = (lineIndex) => {
    if (!selectedReceipt) return
    const item = selectedReceipt.lineItems[lineIndex]
    if (!item?.sku) { alert('Select a SKU first'); return }
    const qty = Number(item.quantity)
    if (!qty || qty <= 0) { alert('Enter a positive quantity first'); return }
    const catalog = findCatalogItem(selectedReceipt.clientId, item.sku)
    const unitsPerPallet = Number(catalog?.unitsPerPallet || 0)
    const mode = selectedReceipt.status === 'open' ? 'detail-open' : 'detail-live'
    setPalletGenModal({ mode, lineIndex, qty, unitsPerPallet, sku: item.sku })
    setPalletGenConfig({ remainderMode: 'partial' })
  }

  // Build the pallets array based on user's choice — pure function, no Firestore writes
  const buildPallets = async (qty, unitsPerPallet, mode, location) => {
    if (!unitsPerPallet || unitsPerPallet <= 0) {
      const ids = await reservePalletIds(qty)
      return ids.map(id => ({ palletId: id, units: 1, location, partial: false }))
    }
    const fullPallets = Math.floor(qty / unitsPerPallet)
    const remainder = qty - (fullPallets * unitsPerPallet)
    if (remainder === 0) {
      const ids = await reservePalletIds(fullPallets)
      return ids.map(id => ({ palletId: id, units: unitsPerPallet, location, partial: false }))
    }
    if (mode === 'last') {
      const ids = await reservePalletIds(fullPallets)
      return ids.map((id, i) => ({ palletId: id, units: i === ids.length - 1 ? unitsPerPallet + remainder : unitsPerPallet, location, partial: false }))
    }
    if (mode === 'partial') {
      const ids = await reservePalletIds(fullPallets + 1)
      return ids.map((id, i) => ({ palletId: id, units: i < fullPallets ? unitsPerPallet : remainder, location, partial: i >= fullPallets }))
    }
    if (mode === 'even') {
      if (fullPallets === 0) {
        const ids = await reservePalletIds(1)
        return [{ palletId: ids[0], units: qty, location, partial: true }]
      }
      const base = Math.floor(qty / fullPallets)
      const extras = qty - (base * fullPallets)
      const ids = await reservePalletIds(fullPallets)
      return ids.map((id, i) => ({ palletId: id, units: i < extras ? base + 1 : base, location, partial: (i < extras ? base + 1 : base) !== unitsPerPallet }))
    }
    return []
  }

  const executePalletGeneration = async () => {
    if (generatingPallets) return
    setGeneratingPallets(true)
    try {
      const { mode, lineIndex, qty, unitsPerPallet } = palletGenModal
      const remMode = palletGenConfig.remainderMode

      if (mode === 'form') {
        const loc = form.lineItems[lineIndex].location || ''
        const pallets = await buildPallets(qty, unitsPerPallet, remMode, loc)
        const items = [...form.lineItems]
        items[lineIndex] = { ...items[lineIndex], pallets }
        setForm({ ...form, lineItems: items })

      } else if (mode === 'detail-open') {
        const item = selectedReceipt.lineItems[lineIndex]
        const loc = item.location || ''
        const pallets = await buildPallets(qty, unitsPerPallet, remMode, loc)
        const items = [...selectedReceipt.lineItems]
        items[lineIndex] = { ...items[lineIndex], pallets }
        await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: items })
        setSelectedReceipt({ ...selectedReceipt, lineItems: items })

      } else if (mode === 'detail-live') {
        const item = selectedReceipt.lineItems[lineIndex]
        const loc = item.location || ''
        const pallets = await buildPallets(qty, unitsPerPallet, remMode, loc)
        // Write each as an inventory doc
        for (const p of pallets) {
          await addDoc(collection(db, 'inventory'), {
            palletId: p.palletId,
            clientId: selectedReceipt.clientId,
            clientName: selectedReceipt.clientName,
            sku: (item.sku || '').toUpperCase(),
            description: item.description || '',
            units: Number(p.units || 0),
            condition: item.condition || 'A',
            location: p.location || '',
            status: 'available',
            receivedDate: (selectedReceipt.arrivalDate || '').split('T')[0] || new Date().toISOString().split('T')[0],
            poNumber: selectedReceipt.poNumber || '',
            receiptId: selectedReceipt.id,
            weight: item.weight || '',
            partial: !!p.partial,
            createdAt: new Date().toISOString()
          })
        }
        await loadDetailInventory(selectedReceipt.id)
      }

      setPalletGenModal(null)
    } finally { setGeneratingPallets(false) }
  }

  // ──────────────────────────────────────────────────────────────────
  // PALLETIZE CARTONS WORKFLOW
  // ──────────────────────────────────────────────────────────────────
  const openPalletizeForForm = (lineIndex) => {
    const item = form.lineItems[lineIndex]
    openPalletizeShared({ mode: 'form', lineIndex, item, clientId: form.clientId })
  }
  const openPalletizeForDetail = (lineIndex) => {
    const item = selectedReceipt?.lineItems?.[lineIndex]
    if (!item || !selectedReceipt) return
    const mode = selectedReceipt.status === 'open' ? 'detail-open' : 'detail-live'
    openPalletizeShared({ mode, lineIndex, item, clientId: selectedReceipt.clientId })
  }
  const openPalletizeShared = ({ mode, lineIndex, item, clientId }) => {
    if (!item.sku) { alert('Select a SKU first'); return }
    const totalCartons = Number(item.quantity || 0)
    if (totalCartons <= 0) { alert('Enter a positive carton quantity first'); return }
    const cat = findCatalogItem(clientId, item.sku)
    const cartonsPerPallet = Number(cat?.cartonsPerPallet || cat?.unitsPerPallet || 0)
    // Pre-fill: even distribution suggestion
    const pallets = []
    if (cartonsPerPallet > 0) {
      let remaining = totalCartons
      let i = 0
      while (remaining > 0) {
        const c = Math.min(remaining, cartonsPerPallet)
        pallets.push({ tmpId: i++, cartons: c, location: item.location || '' })
        remaining -= c
      }
    } else {
      pallets.push({ tmpId: 0, cartons: totalCartons, location: item.location || '' })
    }
    setPalletizeModal({ mode, lineIndex, sku: item.sku, description: item.description || '', totalCartons, cartonsPerPallet, pallets })
  }

  const addPalletizeRow = () => {
    if (!palletizeModal) return
    const next = [...palletizeModal.pallets]
    const usedSoFar = next.reduce((s, p) => s + Number(p.cartons || 0), 0)
    const remaining = Math.max(0, palletizeModal.totalCartons - usedSoFar)
    const defaultCartons = palletizeModal.cartonsPerPallet > 0
      ? Math.min(remaining, palletizeModal.cartonsPerPallet)
      : remaining
    next.push({ tmpId: Date.now(), cartons: defaultCartons, location: '' })
    setPalletizeModal({ ...palletizeModal, pallets: next })
  }
  const removePalletizeRow = (tmpId) => {
    if (!palletizeModal) return
    setPalletizeModal({ ...palletizeModal, pallets: palletizeModal.pallets.filter(p => p.tmpId !== tmpId) })
  }
  const updatePalletizeRow = (tmpId, field, value) => {
    if (!palletizeModal) return
    const v = field === 'cartons' ? Math.max(0, Number(value) || 0) : value
    setPalletizeModal({
      ...palletizeModal,
      pallets: palletizeModal.pallets.map(p => p.tmpId === tmpId ? { ...p, [field]: v } : p)
    })
  }
  const autofillPalletize = () => {
    if (!palletizeModal) return
    const { totalCartons, cartonsPerPallet } = palletizeModal
    const next = []
    if (cartonsPerPallet > 0) {
      let remaining = totalCartons
      let i = 0
      while (remaining > 0) {
        const c = Math.min(remaining, cartonsPerPallet)
        next.push({ tmpId: i++, cartons: c, location: '' })
        remaining -= c
      }
    } else {
      next.push({ tmpId: 0, cartons: totalCartons, location: '' })
    }
    setPalletizeModal({ ...palletizeModal, pallets: next })
  }

  const executePalletize = async () => {
    if (palletizing || !palletizeModal) return
    const { mode, lineIndex, pallets: modalPallets, totalCartons } = palletizeModal
    const allocated = modalPallets.reduce((s, p) => s + Number(p.cartons || 0), 0)
    if (allocated !== totalCartons) {
      alert(`Allocated ${allocated} of ${totalCartons} cartons. Adjust before confirming.`)
      return
    }
    const nonZero = modalPallets.filter(p => Number(p.cartons) > 0)
    if (nonZero.length === 0) { alert('Add at least one pallet.'); return }
    setPalletizing(true)
    try {
      const ids = await reservePalletIds(nonZero.length)
      const builtPallets = nonZero.map((p, i) => ({
        palletId: ids[i],
        units: Number(p.cartons),     // units = cartons on this pallet
        location: p.location || '',
        partial: palletizeModal.cartonsPerPallet > 0 && Number(p.cartons) !== palletizeModal.cartonsPerPallet,
      }))

      if (mode === 'form') {
        const items = [...form.lineItems]
        items[lineIndex] = { ...items[lineIndex], pallets: [...(items[lineIndex].pallets || []), ...builtPallets] }
        setForm({ ...form, lineItems: items })

      } else if (mode === 'detail-open') {
        const items = [...selectedReceipt.lineItems]
        items[lineIndex] = { ...items[lineIndex], pallets: [...(items[lineIndex].pallets || []), ...builtPallets] }
        await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: items })
        setSelectedReceipt({ ...selectedReceipt, lineItems: items })

      } else if (mode === 'detail-live') {
        const item = selectedReceipt.lineItems[lineIndex]
        for (const p of builtPallets) {
          await addDoc(collection(db, 'inventory'), {
            palletId: p.palletId,
            clientId: selectedReceipt.clientId,
            clientName: selectedReceipt.clientName,
            sku: (item.sku || '').toUpperCase(),
            description: item.description || '',
            units: Number(p.units || 0),
            condition: item.condition || 'A',
            location: p.location || '',
            status: 'available',
            receivedDate: (selectedReceipt.arrivalDate || '').split('T')[0] || new Date().toISOString().split('T')[0],
            poNumber: selectedReceipt.poNumber || '',
            receiptId: selectedReceipt.id,
            weight: item.weight || '',
            partial: !!p.partial,
            createdAt: new Date().toISOString(),
          })
        }
        await loadDetailInventory(selectedReceipt.id)
      }

      setPalletizeModal(null)
    } catch (err) { console.error(err); alert('Palletize failed: ' + err.message) }
    finally { setPalletizing(false) }
  }

  // ──────────────────────────────────────────────────────────────────
  // NEW-FORM PALLET HELPERS (unchanged from current behavior)
  // ──────────────────────────────────────────────────────────────────
  const addManualPalletToForm = async (lineIndex) => {
    const ids = await reservePalletIds(1)
    const items = [...form.lineItems]
    const current = items[lineIndex].pallets || []
    items[lineIndex] = { ...items[lineIndex], pallets: [...current, { palletId: ids[0], units: 0, location: items[lineIndex].location || '', partial: false }] }
    setForm({ ...form, lineItems: items })
  }

  const updateFormPalletField = (lineIndex, palletIdx, field, value) => {
    const items = [...form.lineItems]
    const pallets = [...(items[lineIndex].pallets || [])]
    pallets[palletIdx] = { ...pallets[palletIdx], [field]: field === 'units' ? Number(value) : value }
    if (field === 'units') {
      const catalog = findCatalogItem(form.clientId, items[lineIndex].sku)
      const upp = Number(catalog?.unitsPerPallet || 0)
      pallets[palletIdx].partial = upp > 0 && Number(value) !== upp
    }
    items[lineIndex] = { ...items[lineIndex], pallets }
    setForm({ ...form, lineItems: items })
  }

  const removeFormPallet = (lineIndex, palletIdx) => {
    const items = [...form.lineItems]
    items[lineIndex] = { ...items[lineIndex], pallets: (items[lineIndex].pallets || []).filter((_, i) => i !== palletIdx) }
    setForm({ ...form, lineItems: items })
  }

  const addFormLineItem = () => setForm({
    ...form,
    lineItems: [...form.lineItems, {
      ...emptyLineItem,
      primaryUnits: form.receiptType === 'parcel' ? 'Carton' : 'Pallet'
    }]
  })
  const removeFormLineItem = (i) => setForm({ ...form, lineItems: form.lineItems.filter((_, idx) => idx !== i) })
  const updateFormLineItem = (i, field, value) => {
    const items = [...form.lineItems]
    items[i] = { ...items[i], [field]: value }
    setForm({ ...form, lineItems: items })
  }
  const selectSkuForForm = (i, catalogItem) => {
    const items = [...form.lineItems]
    items[i] = { ...items[i], sku: catalogItem.sku, description: catalogItem.description || '', weight: catalogItem.weight || '' }
    setForm({ ...form, lineItems: items })
    setSkuDropdown(null); setSkuSearch('')
  }

  // ──────────────────────────────────────────────────────────────────
  // DETAIL-VIEW EDIT HELPERS (auto-save, status-aware)
  // ──────────────────────────────────────────────────────────────────
  const saveReceiptField = async (id, field, value) => {
    await updateDoc(doc(db, 'receipts', id), { [field]: value })
    fetchData()
  }

  const saveTransportEdits = async () => {
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { ...transportForm })
    setSelectedReceipt({ ...selectedReceipt, ...transportForm })
    setEditingTransport(false)
    fetchData()
  }

  // Edit a pallet field (auto-save on blur)
  const editPalletField = async (lineIndex, palletKey, field, value) => {
    const lineItem = selectedReceipt.lineItems[lineIndex]
    const numericFields = ['units']
    const v = numericFields.includes(field) ? Number(value) : value

    if (selectedReceipt.status === 'open') {
      // Update receipt.lineItems[].pallets[]
      const items = [...selectedReceipt.lineItems]
      const pallets = [...(items[lineIndex].pallets || [])]
      const pi = pallets.findIndex(p => p.palletId === palletKey)
      if (pi === -1) return
      pallets[pi] = { ...pallets[pi], [field]: v }
      if (field === 'units') {
        const catalog = findCatalogItem(selectedReceipt.clientId, lineItem.sku)
        const upp = Number(catalog?.unitsPerPallet || 0)
        pallets[pi].partial = upp > 0 && Number(v) !== upp
      }
      items[lineIndex] = { ...items[lineIndex], pallets }
      await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: items })
      setSelectedReceipt({ ...selectedReceipt, lineItems: items })
    } else {
      // Update the inventory doc directly. palletKey here = inventory doc id
      await updateDoc(doc(db, 'inventory', palletKey), { [field]: v })
      await loadDetailInventory(selectedReceipt.id)
    }
  }

  // Delete a pallet
  const deletePallet = async (lineIndex, palletKey) => {
    if (!window.confirm('Remove this pallet?')) return
    if (selectedReceipt.status === 'open') {
      const items = [...selectedReceipt.lineItems]
      const pallets = (items[lineIndex].pallets || []).filter(p => p.palletId !== palletKey)
      items[lineIndex] = { ...items[lineIndex], pallets }
      await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: items })
      setSelectedReceipt({ ...selectedReceipt, lineItems: items })
    } else {
      // Check status before deleting
      const docSnap = detailInventory.find(d => d.id === palletKey)
      if (docSnap && (docSnap.status || 'available') !== 'available') {
        alert('This pallet is allocated to an order and cannot be removed.')
        return
      }
      await deleteDoc(doc(db, 'inventory', palletKey))
      await loadDetailInventory(selectedReceipt.id)
    }
  }

  // Add a manual (blank) pallet
  const addManualPalletToLine = async (lineIndex) => {
    const item = selectedReceipt.lineItems[lineIndex]
    const ids = await reservePalletIds(1)
    if (selectedReceipt.status === 'open') {
      const items = [...selectedReceipt.lineItems]
      const current = items[lineIndex].pallets || []
      items[lineIndex] = { ...items[lineIndex], pallets: [...current, { palletId: ids[0], units: 0, location: item.location || '', partial: false }] }
      await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: items })
      setSelectedReceipt({ ...selectedReceipt, lineItems: items })
    } else {
      await addDoc(collection(db, 'inventory'), {
        palletId: ids[0],
        clientId: selectedReceipt.clientId,
        clientName: selectedReceipt.clientName,
        sku: (item.sku || '').toUpperCase(),
        description: item.description || '',
        units: 0,
        condition: item.condition || 'A',
        location: item.location || '',
        status: 'available',
        receivedDate: (selectedReceipt.arrivalDate || '').split('T')[0] || new Date().toISOString().split('T')[0],
        poNumber: selectedReceipt.poNumber || '',
        receiptId: selectedReceipt.id,
        weight: item.weight || '',
        partial: false,
        createdAt: new Date().toISOString()
      })
      await loadDetailInventory(selectedReceipt.id)
    }
  }

  // Clear ALL pallets on a line item (form context)
  const clearAllPalletsOnFormLine = (lineIndex) => {
    const item = form.lineItems[lineIndex]
    const count = (item?.pallets || []).length
    if (count === 0) return
    if (!window.confirm(`Remove all ${count} pallet(s) from this line?`)) return
    const items = [...form.lineItems]
    items[lineIndex] = { ...items[lineIndex], pallets: [] }
    setForm({ ...form, lineItems: items })
  }

  // Clear ALL pallets on a line item (detail context). Status-aware.
  const clearAllPalletsOnDetailLine = async (lineIndex) => {
    if (!selectedReceipt) return
    const item = selectedReceipt.lineItems[lineIndex]
    const livePallets = palletsForLine(item)
    if (livePallets.length === 0) return

    if (selectedReceipt.status !== 'open') {
      const allocated = detailInventory.filter(p =>
        (p.sku || '').toUpperCase() === (item.sku || '').toUpperCase() &&
        (p.status || 'available').toLowerCase() !== 'available'
      )
      if (allocated.length > 0) {
        alert(`Cannot clear pallets — ${allocated.length} are allocated to an order.`)
        return
      }
    }
    if (!window.confirm(`Remove all ${livePallets.length} pallet(s) from this line?`)) return

    if (selectedReceipt.status === 'open') {
      const items = [...selectedReceipt.lineItems]
      items[lineIndex] = { ...items[lineIndex], pallets: [] }
      await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: items })
      setSelectedReceipt({ ...selectedReceipt, lineItems: items })
    } else {
      const matches = detailInventory.filter(p => (p.sku || '').toUpperCase() === (item.sku || '').toUpperCase())
      for (let j = 0; j < matches.length; j += 450) {
        const batch = writeBatch(db)
        matches.slice(j, j + 450).forEach(d => batch.delete(doc(db, 'inventory', d.id)))
        await batch.commit()
      }
      await loadDetailInventory(selectedReceipt.id)
    }
  }

  // ─── Line item add / edit / delete in detail view ───
  const addLineItemToReceipt = async () => {
    if (!newItemForm.sku) return
    const newItem = { ...newItemForm, sku: newItemForm.sku.toUpperCase(), pallets: [] }
    const updated = [...(selectedReceipt.lineItems || []), newItem]
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })
    setSelectedReceipt({ ...selectedReceipt, lineItems: updated })
    setNewItemForm({ ...emptyLineItem })
    setShowAddItem(false)
    // Auto-expand the new line so user can immediately add pallets
    setExpandedLines(prev => ({ ...prev, [updated.length - 1]: true }))
    fetchData()
  }

  const saveEditItem = async (i) => {
    const updated = [...(selectedReceipt.lineItems || [])]
    const original = updated[i]
    updated[i] = { ...editItemForm, sku: editItemForm.sku.toUpperCase(), pallets: original.pallets || [] }
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })

    // If the receipt is confirmed/complete and SKU/description/condition/weight changed,
    // propagate to all inventory docs for this line item
    if (selectedReceipt.status !== 'open') {
      const oldSku = (original.sku || '').toUpperCase()
      const newSku = editItemForm.sku.toUpperCase()
      const matches = detailInventory.filter(p => (p.sku || '').toUpperCase() === oldSku)
      for (const inv of matches) {
        const patch = {}
        if (newSku !== oldSku) patch.sku = newSku
        if (editItemForm.description !== original.description) patch.description = editItemForm.description
        if (editItemForm.condition !== original.condition) patch.condition = editItemForm.condition
        if (editItemForm.weight !== original.weight) patch.weight = editItemForm.weight
        if (Object.keys(patch).length > 0) {
          await updateDoc(doc(db, 'inventory', inv.id), patch)
        }
      }
      await loadDetailInventory(selectedReceipt.id)
    }
    setSelectedReceipt({ ...selectedReceipt, lineItems: updated })
    setEditingItem(null)
    fetchData()
  }

  const deleteLineItem = async (i) => {
    const item = selectedReceipt.lineItems[i]
    const livePallets = palletsForLine(item)
    if (livePallets.length > 0) {
      if (selectedReceipt.status !== 'open') {
        const allocated = detailInventory.filter(p =>
          (p.sku || '').toUpperCase() === (item.sku || '').toUpperCase() &&
          (p.status || 'available').toLowerCase() !== 'available'
        )
        if (allocated.length > 0) {
          alert(`Cannot delete this line — ${allocated.length} pallet(s) on this SKU are allocated to an order.`)
          return
        }
      }
      if (!window.confirm(`Remove this line item AND its ${livePallets.length} pallet(s)?`)) return
    } else {
      if (!window.confirm('Remove this line item?')) return
    }

    // Delete inventory docs for this SKU on this receipt (if any)
    if (selectedReceipt.status !== 'open') {
      const matches = detailInventory.filter(p => (p.sku || '').toUpperCase() === (item.sku || '').toUpperCase())
      for (let j = 0; j < matches.length; j += 450) {
        const batch = writeBatch(db)
        matches.slice(j, j + 450).forEach(d => batch.delete(doc(db, 'inventory', d.id)))
        await batch.commit()
      }
    }
    const updated = (selectedReceipt.lineItems || []).filter((_, idx) => idx !== i)
    await updateDoc(doc(db, 'receipts', selectedReceipt.id), { lineItems: updated })
    setSelectedReceipt({ ...selectedReceipt, lineItems: updated })
    if (selectedReceipt.status !== 'open') await loadDetailInventory(selectedReceipt.id)
    fetchData()
  }

  // ──────────────────────────────────────────────────────────────────
  // DELETE WHOLE RECEIPT (existing behavior, now status-aware)
  // ──────────────────────────────────────────────────────────────────
  const deleteEntireReceipt = async (r) => {
    const word = window.prompt(`Type DELETE to confirm permanent deletion of receipt ${r.transactionId || r.id.slice(-6)}.\nThis also removes all associated inventory pallets.`)
    if (word !== 'DELETE') return
    try {
      // Check for allocated inventory
      const invSnap = await getDocs(query(collection(db, 'inventory'), where('receiptId', '==', r.id)))
      const allocated = invSnap.docs.filter(d => (d.data().status || 'available').toLowerCase() !== 'available')
      if (allocated.length > 0) {
        alert(`Cannot delete: ${allocated.length} pallet(s) are allocated to orders.`)
        return
      }
      // Delete inventory + palletHistory in batches
      const docsToDelete = invSnap.docs
      for (let i = 0; i < docsToDelete.length; i += 450) {
        const batch = writeBatch(db)
        docsToDelete.slice(i, i + 450).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      const histSnap = await getDocs(query(collection(db, 'palletHistory'), where('receiptId', '==', r.id)))
      for (let i = 0; i < histSnap.docs.length; i += 450) {
        const batch = writeBatch(db)
        histSnap.docs.slice(i, i + 450).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      await deleteDoc(doc(db, 'receipts', r.id))
      setView('list'); setSelectedReceipt(null); fetchData()
    } catch (err) { console.error(err); alert('Delete failed: ' + err.message) }
  }

  // ──────────────────────────────────────────────────────────────────
  // SIDEBAR / FILTER HELPERS
  // ──────────────────────────────────────────────────────────────────
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
  // PALLET-GENERATOR MODAL (extracted JSX, used in both views)
  // ═══════════════════════════════════════════════════════════════════
  const PalletGeneratorModal = () => {
    if (!palletGenModal) return null
    const { qty, unitsPerPallet, sku } = palletGenModal
    const fullPallets = unitsPerPallet > 0 ? Math.floor(qty / unitsPerPallet) : qty
    const remainder = unitsPerPallet > 0 ? qty - (fullPallets * unitsPerPallet) : 0
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Hash size={16}/> Generate Pallets — {sku}
            </h3>
            <button onClick={() => setPalletGenModal(null)} className="text-gray-400 hover:text-white"><X size={18}/></button>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div className="bg-gray-800/40 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-400">Total quantity:</span><span className="text-white font-medium">{qty} units</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Units per pallet (from catalog):</span><span className="text-white font-medium">{unitsPerPallet || 'not set'}</span></div>
              {unitsPerPallet > 0 && (<>
                <div className="flex justify-between"><span className="text-gray-400">Full pallets:</span><span className="text-green-400 font-medium">{fullPallets}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Remainder units:</span><span className={remainder > 0 ? 'text-amber-400 font-medium' : 'text-gray-500'}>{remainder}</span></div>
              </>)}
            </div>
            {palletGenModal.mode === 'detail-live' && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
                These pallets will be added directly to live inventory (receipt is already confirmed).
              </div>
            )}
            {unitsPerPallet === 0 && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
                No "Units per pallet" set for this SKU. Each unit becomes its own pallet ({qty} pallets). Set "Units per pallet" in the Items catalog to enable smart splitting.
              </div>
            )}
            {unitsPerPallet > 0 && remainder > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">How to handle the {remainder}-unit remainder?</div>
                <div className="space-y-2">
                  {[
                    { id: 'partial', title: 'Create a partial pallet', desc: `${fullPallets} full pallets (${unitsPerPallet} units each) + 1 partial pallet (${remainder} units).` },
                    { id: 'last',    title: 'Add to last pallet (over-fill)', desc: `${Math.max(fullPallets-1,0)} full pallets + 1 over-full pallet with ${unitsPerPallet + remainder} units.` },
                    { id: 'even',    title: 'Spread evenly', desc: `Distribute ${qty} units across ${fullPallets} pallets — none will match the catalog quantity exactly.` },
                  ].map(opt => (
                    <label key={opt.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${palletGenConfig.remainderMode === opt.id ? 'bg-blue-600/10 border-blue-500/30' : 'bg-gray-800/30 border-gray-700 hover:bg-gray-800/50'}`}>
                      <input type="radio" checked={palletGenConfig.remainderMode === opt.id} onChange={() => setPalletGenConfig({ remainderMode: opt.id })} className="mt-0.5 accent-blue-500"/>
                      <div className="flex-1 text-xs">
                        <div className="text-white font-medium mb-0.5">{opt.title}</div>
                        <div className="text-gray-500">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
            <button onClick={() => setPalletGenModal(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
            <button onClick={executePalletGeneration} disabled={generatingPallets}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
              {generatingPallets ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // PALLETIZE CARTONS MODAL
  // ═══════════════════════════════════════════════════════════════════
  const PalletizeModal = () => {
    if (!palletizeModal) return null
    const { sku, description, totalCartons, cartonsPerPallet, pallets } = palletizeModal
    const allocated = pallets.reduce((s, p) => s + Number(p.cartons || 0), 0)
    const remaining = totalCartons - allocated
    const matches = allocated === totalCartons
    const overAllocated = allocated > totalCartons

    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <div>
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Layers size={16}/> Palletize Cartons — {sku}
              </h3>
              {description && <p className="text-gray-500 text-xs mt-0.5">{description}</p>}
            </div>
            <button onClick={() => setPalletizeModal(null)} className="text-gray-400 hover:text-white"><X size={18}/></button>
          </div>

          <div className="px-6 py-4 space-y-4 overflow-y-auto">
            <div className="bg-gray-800/40 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-400">Total cartons:</span><span className="text-white font-medium">{totalCartons}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Cartons per pallet (catalog):</span><span className="text-white font-medium">{cartonsPerPallet || 'not set'}</span></div>
              <div className="flex justify-between">
                <span className="text-gray-400">Allocated:</span>
                <span className={`font-medium ${overAllocated ? 'text-red-400' : matches ? 'text-green-400' : 'text-amber-400'}`}>
                  {allocated} / {totalCartons}
                  {overAllocated && ' (over!)'}
                  {!matches && !overAllocated && ` (${remaining} remaining)`}
                  {matches && ' ✓'}
                </span>
              </div>
            </div>

            {cartonsPerPallet === 0 && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
                No "cartonsPerPallet" or "unitsPerPallet" set for this SKU in the catalog. Set it for better autofill suggestions.
              </div>
            )}

            <div className="flex items-center justify-between">
              <h4 className="text-white text-sm font-medium">Pallet allocation</h4>
              <div className="flex gap-2">
                <button onClick={autofillPalletize}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/20">
                  Autofill ({cartonsPerPallet > 0 ? `${cartonsPerPallet}/pallet` : 'single pallet'})
                </button>
                <button onClick={addPalletizeRow}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/20">
                  <Plus size={11}/> Add Pallet
                </button>
              </div>
            </div>

            <div className="bg-gray-950/50 rounded-lg p-2 max-h-72 overflow-y-auto">
              <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] text-gray-600 border-b border-gray-800 px-2">
                <div className="col-span-1">#</div>
                <div className="col-span-4">Cartons on this pallet</div>
                <div className="col-span-5">Location</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1"></div>
              </div>
              {pallets.length === 0 ? (
                <p className="text-gray-500 text-xs py-4 text-center">No pallets. Click "Add Pallet" or "Autofill".</p>
              ) : pallets.map((p, idx) => {
                const isPartial = cartonsPerPallet > 0 && Number(p.cartons) !== cartonsPerPallet
                return (
                  <div key={p.tmpId} className="grid grid-cols-12 gap-2 items-center py-1.5 text-xs px-2">
                    <div className="col-span-1 text-gray-500 font-mono">{idx + 1}</div>
                    <input type="number" min="0" value={p.cartons}
                      onChange={e => updatePalletizeRow(p.tmpId, 'cartons', e.target.value)}
                      className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
                    <input value={p.location}
                      onChange={e => updatePalletizeRow(p.tmpId, 'location', e.target.value)}
                      placeholder="Location"
                      className="col-span-5 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
                    <div className="col-span-1 text-[10px]">
                      {Number(p.cartons) === 0 ? (
                        <span className="text-gray-500">empty</span>
                      ) : isPartial ? (
                        <span className="inline-flex items-center gap-1 text-amber-400" title="Partial pallet"><AlertTriangle size={10}/> partial</span>
                      ) : (
                        <span className="text-green-400">full</span>
                      )}
                    </div>
                    <button onClick={() => removePalletizeRow(p.tmpId)}
                      className="col-span-1 text-gray-600 hover:text-red-400 flex items-center justify-center"><X size={12}/></button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-800 flex justify-between items-center">
            <div className="text-xs text-gray-500">
              {pallets.length} pallet{pallets.length !== 1 ? 's' : ''} → {allocated} cartons
              {palletizeModal.mode === 'detail-live' && <span className="text-blue-400 ml-2">· will write to live inventory</span>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPalletizeModal(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={executePalletize} disabled={palletizing || !matches}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg">
                {palletizing ? 'Palletizing…' : 'Confirm Palletize'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

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
              className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
              📷 Scan SKU
            </button>
            <button onClick={() => { setView('list'); resetForm() }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={loading || !form.clientId || !form.arrivalDate}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
              {loading ? 'Saving…' : 'Create Receipt'}
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
              <h3 className="text-white font-medium mb-4">Receipt Type</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Receipt Type *</label>
                  <select value={form.receiptType} onChange={e => {
                    const newType = e.target.value
                    // Flip primaryUnits for any blank/SKU-less lines
                    const defaultUnit = newType === 'parcel' ? 'Carton' : 'Pallet'
                    const updatedLines = form.lineItems.map(li => li.sku ? li : { ...li, primaryUnits: defaultUnit })
                    setForm({ ...form, receiptType: newType, lineItems: updatedLines })
                  }} className={inputCls}>
                    {RECEIPT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {(form.receiptType === 'fcl_loose' || form.receiptType === 'fcl_palletized') && (
                  <div>
                    <label className={labelCls}>Container Size</label>
                    <select value={form.containerSize} onChange={e => setForm({ ...form, containerSize: e.target.value })} className={inputCls}>
                      {CONTAINER_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {form.receiptType === 'parcel' && (
                  <>
                    <div>
                      <label className={labelCls}>Parcel Weight Class</label>
                      <select value={form.parcelWeightClass} onChange={e => setForm({ ...form, parcelWeightClass: e.target.value })} className={inputCls}>
                        <option value="">Select…</option>
                        {PARCEL_WEIGHT_CLASSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm text-gray-300 pb-2 cursor-pointer">
                        <input type="checkbox" checked={!!form.parcelIncludePalletizing}
                          onChange={e => setForm({ ...form, parcelIncludePalletizing: e.target.checked })}
                          className="accent-blue-500 w-4 h-4" />
                        Include palletizing fee
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Order Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Customer *</label>
                  <select value={form.clientId} onChange={e => {
                    const c = clients.find(x => x.id === e.target.value)
                    setForm({ ...form, clientId: e.target.value, clientName: c?.companyName || '' })
                    refreshClient(e.target.value)   // pull fresh rate card
                  }} className={inputCls}>
                    <option value="">Select client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Reference ID</label><input value={form.referenceId} onChange={e => setForm({ ...form, referenceId: e.target.value })} className={inputCls} placeholder="GAOU6317185" /></div>
                <div><label className={labelCls}>Purchase Order</label><input value={form.poNumber} onChange={e => setForm({ ...form, poNumber: e.target.value })} className={inputCls} placeholder="PO-001" /></div>
                <div><label className={labelCls}>Arrival Date *</label><input type="datetime-local" value={form.arrivalDate} onChange={e => setForm({ ...form, arrivalDate: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Expected Date</label><input type="datetime-local" value={form.expectedDate} onChange={e => setForm({ ...form, expectedDate: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Warehouse Instructions</label><input value={form.warehouseInstructions} onChange={e => setForm({ ...form, warehouseInstructions: e.target.value })} className={inputCls} placeholder="Special instructions…" /></div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Transport Details</h3>
              <div className="grid grid-cols-3 gap-4">
                <div><label className={labelCls}>Carrier</label><input value={form.carrier} onChange={e => setForm({ ...form, carrier: e.target.value })} className={inputCls} placeholder="UPS, FedEx…" /></div>
                <div><label className={labelCls}>Tracking Number</label><input value={form.trackingNumber} onChange={e => setForm({ ...form, trackingNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>BOL Number</label><input value={form.bolNumber} onChange={e => setForm({ ...form, bolNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Truck Number</label><input value={form.truckNumber} onChange={e => setForm({ ...form, truckNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Seal Number</label><input value={form.sealNumber} onChange={e => setForm({ ...form, sealNumber: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Driver Name</label><input value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })} className={inputCls} /></div>
              </div>
              <div className="mt-4">
                <label className={labelCls}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls + ' resize-none'} placeholder="Any additional notes…" />
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
                  className="flex items-center gap-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">📷 Scan</button>
                <button onClick={addFormLineItem}
                  className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">
                  <Plus size={13} /> Add Line Item
                </button>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-2 mb-2 px-2 text-gray-500 text-xs border-b border-gray-800 pb-2">
              <div className="col-span-2">SKU</div>
              <div className="col-span-4">Description</div>
              <div className="col-span-1">Qty</div>
              <div className="col-span-1">Unit</div>
              <div className="col-span-2">Location</div>
              <div className="col-span-1">Weight</div>
              <div className="col-span-1"></div>
            </div>

            {form.lineItems.map((item, i) => (
              <div key={i}>
                <div className="grid grid-cols-12 gap-2 items-center mb-2">
                  <div className="col-span-2 relative">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden focus-within:border-blue-500">
                        <Search size={11} className="text-gray-500 ml-2 flex-shrink-0" />
                        <input value={item.sku}
                          onChange={e => { updateFormLineItem(i, 'sku', e.target.value.toUpperCase()); setSkuSearch(e.target.value); setSkuDropdown(i) }}
                          onFocus={() => { setSkuSearch(''); setSkuDropdown(i) }}
                          onBlur={() => setTimeout(() => setSkuDropdown(null), 150)}
                          className="flex-1 bg-transparent text-white px-2 py-2 text-xs focus:outline-none uppercase" placeholder="SKU…" />
                      </div>
                      <button onClick={() => { setScanTarget({ type: 'form', index: i }); setShowScanner(true) }}
                        className="text-blue-400 hover:text-blue-300 p-1 flex-shrink-0" title="Scan barcode">📷</button>
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
                    className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="Description" />
                  <input type="number" min="0" value={item.quantity} onChange={e => updateFormLineItem(i, 'quantity', e.target.value)}
                    className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="0" />
                  <select value={item.primaryUnits} onChange={e => updateFormLineItem(i, 'primaryUnits', e.target.value)}
                    className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none">
                    <option>Pallet</option><option>Each</option><option>Carton</option>
                  </select>
                  <input value={item.location} onChange={e => updateFormLineItem(i, 'location', e.target.value)}
                    className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="Location" />
                  <input type="number" min="0" value={item.weight} onChange={e => updateFormLineItem(i, 'weight', e.target.value)}
                    className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-blue-500" placeholder="lbs" />
                  <button onClick={() => removeFormLineItem(i)} disabled={form.lineItems.length === 1}
                    className="col-span-1 text-gray-600 hover:text-red-400 disabled:opacity-20 flex items-center justify-center"><X size={14} /></button>
                </div>

                {/* --- PALLETS SUB-PANEL (new form) --- */}
                <div className="mb-3 ml-2 pl-3 border-l-2 border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Layers size={11} className="text-purple-400"/>
                      <span className="text-gray-400">Pallets:</span>
                      <span className="text-purple-400 font-medium">{(item.pallets || []).length}</span>
                      {(item.pallets || []).some(p => p.partial) && (
                        <span className="flex items-center gap-1 text-amber-400 text-[10px]">
                          <AlertTriangle size={10}/> contains partial
                        </span>
                      )}
                      {(item.pallets || []).length > 0 && (
                        <span className="text-gray-500 text-[10px]">
                          · {(item.pallets || []).reduce((s, p) => s + Number(p.units || 0), 0)} total units
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => openPalletGeneratorForForm(i)} disabled={!item.sku || !item.quantity}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/20 disabled:opacity-30">
                        <Hash size={9}/> Generate Pallets
                      </button>
                      {isCartonUnit(item.primaryUnits) && (
                        <button type="button" onClick={() => openPalletizeForForm(i)} disabled={!item.sku || !item.quantity}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-teal-600/20 hover:bg-teal-600/40 text-teal-300 border border-teal-500/20 disabled:opacity-30">
                          <Layers size={9}/> Palletize
                        </button>
                      )}
                      <button type="button" onClick={() => addManualPalletToForm(i)} disabled={!item.sku}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 border border-gray-600/30 disabled:opacity-30">
                        <Plus size={9}/> Add Manually
                      </button>
                      {(item.pallets || []).length > 0 && (
                        <button type="button" onClick={() => clearAllPalletsOnFormLine(i)}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-red-600/10 hover:bg-red-600/30 text-red-400 border border-red-500/20">
                          <Trash2 size={9}/> Clear ({(item.pallets || []).length})
                        </button>
                      )}
                    </div>
                  </div>
                  {(item.pallets || []).length > 0 && (
                    <div className="bg-gray-950/50 rounded-lg p-2">
                      <div className="grid grid-cols-12 gap-2 pb-1 text-[10px] text-gray-600 border-b border-gray-800">
                        <div className="col-span-3">Pallet ID</div>
                        <div className="col-span-3">Units</div>
                        <div className="col-span-4">Location</div>
                        <div className="col-span-1">Status</div>
                        <div className="col-span-1"></div>
                      </div>
                      {(item.pallets || []).map((p, pi) => (
                        <div key={pi} className="grid grid-cols-12 gap-2 items-center py-1 text-xs">
                          <div className="col-span-3 font-mono text-blue-400 text-[11px]">{p.palletId}</div>
                          <input type="number" min="0" value={p.units} onChange={e => updateFormPalletField(i, pi, 'units', e.target.value)}
                            className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-[11px] focus:outline-none focus:border-blue-500" placeholder="0" />
                          <input value={p.location} onChange={e => updateFormPalletField(i, pi, 'location', e.target.value)}
                            className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-[11px] focus:outline-none focus:border-blue-500" placeholder="Location" />
                          <div className="col-span-1">
                            {p.partial ? (
                              <span className="flex items-center gap-1 text-amber-400 text-[10px]" title="Partial pallet"><AlertTriangle size={10}/> partial</span>
                            ) : <span className="text-green-400 text-[10px]">full</span>}
                          </div>
                          <button type="button" onClick={() => removeFormPallet(i, pi)} className="col-span-1 text-gray-600 hover:text-red-400 flex items-center justify-center"><X size={11}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div className="border-t border-gray-800 mt-4 pt-3 flex justify-end gap-8 text-sm">
              <span className="text-gray-400">Total Pallets: <span className="text-white font-medium">{form.lineItems.reduce((s, i) => s + (i.pallets || []).length, 0)}</span></span>
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
              receiptType={form.receiptType}
              containerSize={form.containerSize}
              parcelWeightClass={form.parcelWeightClass}
              parcelIncludePalletizing={form.parcelIncludePalletizing}
              arrivalDate={form.arrivalDate}
              splitPeriodDay={clients.find(c => c.id === form.clientId)?.splitPeriodDay || '15'}
              quantities={{
                pallets: form.lineItems.reduce((s, i) => s + (i.pallets || []).length, 0),
                units: form.lineItems.reduce((s, i) => {
                  const pcs = piecesForItem(i, form.clientId)
                  if (pcs != null) return s + pcs                            // cartons × pieces/ctn
                  const u = (i.primaryUnits || '').toLowerCase()
                  if (u === 'each' || u === 'unit') return s + Number(i.quantity || 0)
                  return s
                }, 0),
                cartons: form.lineItems.reduce((s, i) => isCartonUnit(i.primaryUnits) ? s + Number(i.quantity || 0) : s, 0),
                orders: 1,
              }}
              clientName={form.clientName}
            />
          </div>
        )}

        <PalletGeneratorModal />
        <PalletizeModal />
        {showScanner && (
          <BarcodeScanner title="Scan SKU Barcode" onScan={handleScan} onClose={() => { setShowScanner(false); setScanTarget(null) }} />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL VIEW (now fully editable on any status)
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedReceipt) {
    const r = receipts.find(x => x.id === selectedReceipt.id) || selectedReceipt
    const sc = statusConfig[r.status] || statusConfig.open
    const StatusIcon = sc.icon
    const lineItems = r.lineItems || []

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
            <button onClick={() => deleteEntireReceipt(r)}
              className="flex items-center gap-1.5 text-sm bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg">
              <Trash2 size={14}/> Delete Receipt
            </button>
            <button onClick={() => generateReceivingReport(r)}
              className="flex items-center gap-1.5 text-sm bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-600/20 px-3 py-2 rounded-lg">
              <FileText size={14} /> Print Report
            </button>
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
            {(r.status === 'confirmed' || r.status === 'complete' || r.status === 'cancelled') && (
              <button onClick={reopenReceipt}
                className="flex items-center gap-1.5 text-sm bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 border border-yellow-600/20 px-3 py-2 rounded-lg">
                Reopen
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-6 gap-3 mb-4">
          {[
            { label: 'Customer',     value: r.clientName },
            { label: 'Reference #',  value: r.referenceId || '—' },
            { label: 'Transaction',  value: r.transactionId || r.id.slice(-6).toUpperCase() },
            { label: 'Arrival Date', value: r.arrivalDate ? new Date(r.arrivalDate).toLocaleDateString() : '—' },
            { label: 'Total Pallets',value: String(
                r.status === 'open'
                  ? lineItems.reduce((s, i) => s + (i.pallets || []).length, 0)
                  : detailInventory.length
              ) },
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

        {/* ───────── TRANSPORT TAB ───────── */}
        {activeTab === 'transport' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              {!editingTransport ? (
                <button onClick={() => setEditingTransport(true)}
                  className="flex items-center gap-1.5 text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-lg">
                  <Pencil size={13}/> Edit Transport Info
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => {
                    setTransportForm({
                      referenceId: r.referenceId || '', poNumber: r.poNumber || '',
                      arrivalDate: r.arrivalDate || '', expectedDate: r.expectedDate || '',
                      warehouseInstructions: r.warehouseInstructions || '',
                      carrier: r.carrier || '', trackingNumber: r.trackingNumber || '',
                      bolNumber: r.bolNumber || '', truckNumber: r.truckNumber || '',
                      sealNumber: r.sealNumber || '', driverName: r.driverName || '', notes: r.notes || '',
                      receiptType: r.receiptType || 'fcl_palletized',
                      containerSize: r.containerSize || '40\'HQ',
                      parcelWeightClass: r.parcelWeightClass || '',
                    })
                    setEditingTransport(false)
                  }} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
                  <button onClick={saveTransportEdits}
                    className="flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
                    <Save size={13}/> Save
                  </button>
                </div>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Receipt Type</h3>
              {!editingTransport ? (
                <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                  <div><span className="text-gray-500 text-xs">Receipt Type</span><p className="text-white">{(RECEIPT_TYPES.find(t => t.value === r.receiptType) || {}).label || '—'}</p></div>
                  {(r.receiptType === 'fcl_loose' || r.receiptType === 'fcl_palletized') && (
                    <div><span className="text-gray-500 text-xs">Container Size</span><p className="text-white">{r.containerSize || '—'}</p></div>
                  )}
                  {r.receiptType === 'parcel' && (
                    <>
                      <div><span className="text-gray-500 text-xs">Parcel Weight Class</span><p className="text-white">{r.parcelWeightClass || '—'}</p></div>
                      <div><span className="text-gray-500 text-xs">Include Palletizing</span><p className="text-white">{r.parcelIncludePalletizing ? 'Yes' : 'No'}</p></div>
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Receipt Type *</label>
                    <select value={transportForm.receiptType} onChange={e => setTransportForm({ ...transportForm, receiptType: e.target.value })} className={inputCls}>
                      {RECEIPT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  {(transportForm.receiptType === 'fcl_loose' || transportForm.receiptType === 'fcl_palletized') && (
                    <div>
                      <label className={labelCls}>Container Size</label>
                      <select value={transportForm.containerSize} onChange={e => setTransportForm({ ...transportForm, containerSize: e.target.value })} className={inputCls}>
                        {CONTAINER_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {transportForm.receiptType === 'parcel' && (
                    <>
                      <div>
                        <label className={labelCls}>Parcel Weight Class</label>
                        <select value={transportForm.parcelWeightClass} onChange={e => setTransportForm({ ...transportForm, parcelWeightClass: e.target.value })} className={inputCls}>
                          <option value="">Select…</option>
                          {PARCEL_WEIGHT_CLASSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm text-gray-300 pb-2 cursor-pointer">
                          <input type="checkbox" checked={!!transportForm.parcelIncludePalletizing}
                            onChange={e => setTransportForm({ ...transportForm, parcelIncludePalletizing: e.target.checked })}
                            className="accent-blue-500 w-4 h-4" />
                          Include palletizing fee
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Order Information</h3>
              {!editingTransport ? (
                <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                  {[
                    ['Customer', r.clientName || '—'],
                    ['Reference ID', r.referenceId || '—'],
                    ['Purchase Order', r.poNumber || '—'],
                    ['Arrival Date', r.arrivalDate ? new Date(r.arrivalDate).toLocaleString() : '—'],
                    ['Expected Date', r.expectedDate ? new Date(r.expectedDate).toLocaleString() : '—'],
                    ['Warehouse Instructions', r.warehouseInstructions || '—'],
                  ].map(([label, value]) => (
                    <div key={label}><span className="text-gray-500 text-xs">{label}</span><p className="text-white">{value}</p></div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div><label className={labelCls}>Reference ID</label><input value={transportForm.referenceId} onChange={e => setTransportForm({ ...transportForm, referenceId: e.target.value })} className={inputCls} /></div>
                  <div><label className={labelCls}>Purchase Order</label><input value={transportForm.poNumber} onChange={e => setTransportForm({ ...transportForm, poNumber: e.target.value })} className={inputCls} /></div>
                  <div><label className={labelCls}>Arrival Date</label><input type="datetime-local" value={transportForm.arrivalDate?.slice(0,16) || ''} onChange={e => setTransportForm({ ...transportForm, arrivalDate: e.target.value })} className={inputCls} /></div>
                  <div><label className={labelCls}>Expected Date</label><input type="datetime-local" value={transportForm.expectedDate?.slice(0,16) || ''} onChange={e => setTransportForm({ ...transportForm, expectedDate: e.target.value })} className={inputCls} /></div>
                  <div className="col-span-2"><label className={labelCls}>Warehouse Instructions</label><input value={transportForm.warehouseInstructions} onChange={e => setTransportForm({ ...transportForm, warehouseInstructions: e.target.value })} className={inputCls} /></div>
                </div>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Transport Details</h3>
              {!editingTransport ? (
                <>
                  <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                    {[
                      ['Carrier', r.carrier || '—'],
                      ['Tracking #', r.trackingNumber || '—'],
                      ['BOL #', r.bolNumber || '—'],
                      ['Truck #', r.truckNumber || '—'],
                      ['Seal #', r.sealNumber || '—'],
                      ['Driver', r.driverName || '—'],
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
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <div><label className={labelCls}>Carrier</label><input value={transportForm.carrier} onChange={e => setTransportForm({ ...transportForm, carrier: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Tracking #</label><input value={transportForm.trackingNumber} onChange={e => setTransportForm({ ...transportForm, trackingNumber: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>BOL #</label><input value={transportForm.bolNumber} onChange={e => setTransportForm({ ...transportForm, bolNumber: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Truck #</label><input value={transportForm.truckNumber} onChange={e => setTransportForm({ ...transportForm, truckNumber: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Seal #</label><input value={transportForm.sealNumber} onChange={e => setTransportForm({ ...transportForm, sealNumber: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Driver</label><input value={transportForm.driverName} onChange={e => setTransportForm({ ...transportForm, driverName: e.target.value })} className={inputCls} /></div>
                  </div>
                  <div className="mt-4">
                    <label className={labelCls}>Notes</label>
                    <textarea value={transportForm.notes} onChange={e => setTransportForm({ ...transportForm, notes: e.target.value })} rows={2} className={inputCls + ' resize-none'} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ───────── ITEMS TAB (expandable rows w/ pallet sub-panel) ───────── */}
        {activeTab === 'items' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h3 className="text-white font-medium">Receipt Line Items</h3>
              <div className="flex gap-2 items-center">
                <span className="text-gray-500 text-xs">{lineItems.length} lines · {r.status === 'open'
                  ? lineItems.reduce((s, i) => s + (i.pallets || []).length, 0)
                  : detailInventory.length} pallets</span>
                <button onClick={() => setExpandedLines(lineItems.reduce((acc, _, idx) => ({ ...acc, [idx]: true }), {}))}
                  className="text-xs text-gray-400 hover:text-white">Expand all</button>
                <button onClick={() => setExpandedLines({})}
                  className="text-xs text-gray-400 hover:text-white">Collapse</button>
                <button onClick={() => { setScanTarget({ type: 'detail' }); setShowScanner(true) }}
                  className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">📷 Scan</button>
                <button onClick={() => { setShowAddItem(!showAddItem); setNewItemForm({ ...emptyLineItem, primaryUnits: r.receiptType === 'parcel' ? 'Carton' : 'Pallet' }) }}
                  className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">
                  <Plus size={13} /> Add Line Item
                </button>
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
                        className={inputCls} placeholder="SKU…" />
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
                  <div className="col-span-4"><label className={labelCls}>Description</label><input value={newItemForm.description} onChange={e => setNewItemForm({ ...newItemForm, description: e.target.value })} className={inputCls} /></div>
                  <div className="col-span-1"><label className={labelCls}>Qty</label><input type="number" min="0" value={newItemForm.quantity} onChange={e => setNewItemForm({ ...newItemForm, quantity: e.target.value })} className={inputCls} /></div>
                  <div className="col-span-1"><label className={labelCls}>Unit</label><select value={newItemForm.primaryUnits} onChange={e => setNewItemForm({ ...newItemForm, primaryUnits: e.target.value })} className={inputCls}><option>Pallet</option><option>Each</option><option>Carton</option></select></div>
                  <div className="col-span-2"><label className={labelCls}>Location</label><input value={newItemForm.location} onChange={e => setNewItemForm({ ...newItemForm, location: e.target.value })} className={inputCls} /></div>
                  <div className="col-span-1"><label className={labelCls}>Weight</label><input type="number" min="0" value={newItemForm.weight} onChange={e => setNewItemForm({ ...newItemForm, weight: e.target.value })} className={inputCls} /></div>
                  <div className="col-span-1 flex gap-2 items-end">
                    <button onClick={addLineItemToReceipt} disabled={!newItemForm.sku}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg py-2.5 text-xs">Add</button>
                    <button onClick={() => setShowAddItem(false)} className="text-gray-500 hover:text-white pb-1"><X size={16} /></button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">After adding, expand the row to generate pallets.</p>
              </div>
            )}

            {lineItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">No line items</div>
            ) : lineItems.map((item, i) => {
              const livePallets = palletsForLine(item)
              const isExpanded = !!expandedLines[i]
              const isEditing = editingItem === i
              return (
                <div key={i} className="border-b border-gray-800/50 last:border-0">
                  <div className="grid grid-cols-12 gap-2 items-center px-5 py-3 hover:bg-gray-800/20">
                    {isEditing ? (
                      <>
                        <div className="col-span-1"><button onClick={() => setExpandedLines({ ...expandedLines, [i]: !isExpanded })} className="text-gray-500 hover:text-white">{isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button></div>
                        <input value={editItemForm.sku} onChange={e => setEditItemForm({ ...editItemForm, sku: e.target.value.toUpperCase() })} className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" />
                        <input value={editItemForm.description} onChange={e => setEditItemForm({ ...editItemForm, description: e.target.value })} className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" />
                        <div className="col-span-1 flex gap-1">
                          <input type="number" min="0" value={editItemForm.quantity} onChange={e => setEditItemForm({ ...editItemForm, quantity: e.target.value })} className="w-12 bg-gray-800 border border-gray-700 text-white rounded px-1 py-1.5 text-xs focus:outline-none" />
                          <select value={editItemForm.primaryUnits || 'Pallet'} onChange={e => setEditItemForm({ ...editItemForm, primaryUnits: e.target.value })} className="flex-1 bg-gray-800 border border-gray-700 text-white rounded px-1 py-1.5 text-xs focus:outline-none">
                            <option>Pallet</option><option>Each</option><option>Carton</option>
                          </select>
                        </div>
                        <input value={editItemForm.location} onChange={e => setEditItemForm({ ...editItemForm, location: e.target.value })} className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" />
                        <input type="number" min="0" value={editItemForm.weight} onChange={e => setEditItemForm({ ...editItemForm, weight: e.target.value })} className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" />
                        <div className="col-span-1 flex gap-2 justify-end">
                          <button onClick={() => saveEditItem(i)} className="text-green-400 hover:text-green-300"><Save size={14}/></button>
                          <button onClick={() => setEditingItem(null)} className="text-gray-500 hover:text-white"><X size={14}/></button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="col-span-1 flex items-center gap-2">
                          <button onClick={() => setExpandedLines({ ...expandedLines, [i]: !isExpanded })}
                            className="text-gray-500 hover:text-white">{isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>
                          <span className="flex items-center gap-1 text-purple-400 text-xs">
                            <Layers size={11}/> {livePallets.length}
                          </span>
                        </div>
                        <div className="col-span-2 text-white font-mono text-xs font-medium">{item.sku}</div>
                        <div className="col-span-3 text-gray-300 text-xs truncate">{item.description || '—'}</div>
                        <div className="col-span-1 text-white text-xs">
                          {item.quantity ? (
                            <>
                              <div>
                                <span className="font-medium">{item.quantity}</span>
                                <span className="text-gray-500 ml-1">{item.primaryUnits || 'Pallet'}</span>
                              </div>
                              {piecesForItem(item, r.clientId) != null && (
                                <div className="text-purple-400 text-[10px] mt-0.5">= {piecesForItem(item, r.clientId)} pcs</div>
                              )}
                            </>
                          ) : '—'}
                        </div>
                        <div className="col-span-3 text-gray-300 text-xs truncate">{item.location || '—'}</div>
                        <div className="col-span-1 text-gray-400 text-xs">{item.weight ? `${item.weight} lbs` : '—'}</div>
                        <div className="col-span-1 flex gap-2 justify-end">
                          <button onClick={() => { setEditingItem(i); setEditItemForm({ ...item }) }} className="text-gray-400 hover:text-white"><Pencil size={13}/></button>
                          <button onClick={() => deleteLineItem(i)} className="text-gray-400 hover:text-red-400"><Trash2 size={13}/></button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Expanded pallet sub-panel */}
                  {isExpanded && (
                    <div className="px-5 pb-4 bg-gray-950/40">
                      <div className="ml-2 pl-3 border-l-2 border-gray-800">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 text-xs">
                            <Layers size={11} className="text-purple-400"/>
                            <span className="text-gray-400">Pallets:</span>
                            <span className="text-purple-400 font-medium">{livePallets.length}</span>
                            {livePallets.some(p => p.partial) && (
                              <span className="flex items-center gap-1 text-amber-400 text-[10px]"><AlertTriangle size={10}/> contains partial</span>
                            )}
                            {livePallets.length > 0 && (
                              <span className="text-gray-500 text-[10px]">· {livePallets.reduce((s, p) => s + Number(p.units || 0), 0)} total units</span>
                            )}
                            {r.status !== 'open' && (
                              <span className="text-blue-400 text-[10px] ml-2">· live inventory</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => openPalletGeneratorForDetail(i)} disabled={!item.sku || !item.quantity}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/20 disabled:opacity-30">
                              <Hash size={9}/> Generate Pallets
                            </button>
                            {isCartonUnit(item.primaryUnits) && (
                              <button onClick={() => openPalletizeForDetail(i)} disabled={!item.sku || !item.quantity}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-teal-600/20 hover:bg-teal-600/40 text-teal-300 border border-teal-500/20 disabled:opacity-30">
                                <Layers size={9}/> Palletize
                              </button>
                            )}
                            <button onClick={() => addManualPalletToLine(i)} disabled={!item.sku}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 border border-gray-600/30 disabled:opacity-30">
                              <Plus size={9}/> Add Manually
                            </button>
                            {livePallets.length > 0 && (
                              <button onClick={() => clearAllPalletsOnDetailLine(i)}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-red-600/10 hover:bg-red-600/30 text-red-400 border border-red-500/20">
                                <Trash2 size={9}/> Clear ({livePallets.length})
                              </button>
                            )}
                          </div>
                        </div>
                        {livePallets.length > 0 ? (
                          <div className="bg-gray-900/50 rounded-lg p-2">
                            <div className="grid grid-cols-12 gap-2 pb-1 text-[10px] text-gray-600 border-b border-gray-800">
                              <div className="col-span-3">Pallet ID</div>
                              <div className="col-span-2">Units</div>
                              <div className="col-span-3">Location</div>
                              <div className="col-span-3">Status</div>
                              <div className="col-span-1"></div>
                            </div>
                            {livePallets.map((p) => {
                              const key = p._source === 'inv' ? p.id : p.palletId
                              const isAllocated = p._source === 'inv' && (p.status || 'available').toLowerCase() !== 'available'
                              return (
                                <div key={key} className="grid grid-cols-12 gap-2 items-center py-1 text-xs">
                                  <div className="col-span-3 font-mono text-blue-400 text-[11px]">{p.palletId}</div>
                                  <input type="number" min="0" defaultValue={p.units}
                                    onBlur={e => { if (Number(e.target.value) !== Number(p.units)) editPalletField(i, key, 'units', e.target.value) }}
                                    disabled={isAllocated}
                                    className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-[11px] focus:outline-none focus:border-blue-500 disabled:opacity-40" />
                                  <input defaultValue={p.location}
                                    onBlur={e => { if (e.target.value !== p.location) editPalletField(i, key, 'location', e.target.value) }}
                                    disabled={isAllocated}
                                    className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-[11px] focus:outline-none focus:border-blue-500 disabled:opacity-40" />
                                  <div className="col-span-3 text-[10px]">
                                    {p._source === 'inv' ? (
                                      <span className={`px-1.5 py-0.5 rounded ${(p.status || 'available') === 'available' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                        {p.status || 'available'}
                                      </span>
                                    ) : (
                                      <span className="text-gray-500">staged</span>
                                    )}
                                    {p.partial && (
                                      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-400 text-[10px]"><AlertTriangle size={9}/></span>
                                    )}
                                  </div>
                                  <button onClick={() => deletePallet(i, key)} disabled={isAllocated}
                                    className="col-span-1 text-gray-600 hover:text-red-400 disabled:opacity-30 flex items-center justify-center"><X size={11}/></button>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-xs py-2">No pallets yet. Click "Generate Pallets" to create them based on the SKU's units-per-pallet, or "Add Manually" for a blank pallet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            <div className="border-t border-gray-700 bg-gray-800/30 px-5 py-3 flex justify-end gap-8 text-xs">
              <span className="text-gray-400">Lines: <span className="text-white font-semibold">{lineItems.length}</span></span>
              <span className="text-gray-400">Total Pallets: <span className="text-white font-semibold">{r.status === 'open' ? lineItems.reduce((s, i) => s + (i.pallets || []).length, 0) : detailInventory.length}</span></span>
              <span className="text-gray-400">Total Cartons: <span className="text-white font-semibold">{lineItems.reduce((s, i) => isCartonUnit(i.primaryUnits) ? s + Number(i.quantity || 0) : s, 0)}</span></span>
              <span className="text-gray-400">Total Pieces: <span className="text-purple-400 font-semibold">{lineItems.reduce((s, i) => {
                const pcs = piecesForItem(i, r.clientId)
                if (pcs != null) return s + pcs
                const u = (i.primaryUnits || '').toLowerCase()
                if (u === 'each' || u === 'unit') return s + Number(i.quantity || 0)
                return s
              }, 0)}</span></span>
              <span className="text-gray-400">Total Weight: <span className="text-white font-semibold">{lineItems.reduce((s, i) => s + Number(i.weight || 0), 0)} lbs</span></span>
            </div>
          </div>
        )}

        {/* ───────── CHARGES TAB ───────── */}
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
              receiptType={r.receiptType}
              containerSize={r.containerSize}
              parcelWeightClass={r.parcelWeightClass}
              parcelIncludePalletizing={r.parcelIncludePalletizing}
              arrivalDate={r.arrivalDate}
              splitPeriodDay={clients.find(c => c.id === r.clientId)?.splitPeriodDay || '15'}
              quantities={{
                pallets: r.status === 'open'
                  ? lineItems.reduce((s, i) => s + (i.pallets || []).length, 0)
                  : detailInventory.length,
                units: lineItems.reduce((s, i) => {
                  const pcs = piecesForItem(i, r.clientId)
                  if (pcs != null) return s + pcs
                  const u = (i.primaryUnits || '').toLowerCase()
                  if (u === 'each' || u === 'unit') return s + Number(i.quantity || 0)
                  return s
                }, 0),
                cartons: lineItems.reduce((s, i) => isCartonUnit(i.primaryUnits) ? s + Number(i.quantity || 0) : s, 0),
                orders: 1,
              }}
              clientName={r.clientName}
              readOnly={false}
            />
          </div>
        )}

        {/* ───────── CUSTOM TAB ───────── */}
        {activeTab === 'custom' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Custom Receipt Info</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ['Receipt ID', r.id],
                ['Status', sc.label],
                ['Created', r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'],
                ['Completed', r.completedAt ? new Date(r.completedAt).toLocaleString() : '—'],
                ['Total Pallets', String(r.status === 'open' ? lineItems.reduce((s, i) => s + (i.pallets || []).length, 0) : detailInventory.length)],
                ['Total Weight', r.totalWeight ? `${r.totalWeight} lbs` : '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="text-gray-500 text-xs">{label}</span>
                  <p className="text-white font-mono text-xs mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <PalletGeneratorModal />
        <PalletizeModal />
        {showScanner && (
          <BarcodeScanner title="Scan SKU Barcode" onScan={handleScan} onClose={() => { setShowScanner(false); setScanTarget(null) }} />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Receipts</h2>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} results</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkUpload(true)}
            className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 text-sm font-medium px-4 py-2.5 rounded-lg">Bulk Upload</button>
          <button onClick={() => { setView('new'); setActiveTab('transport') }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
            <Plus size={16} /> New Receipt
          </button>
        </div>
      </div>

      <div className="mb-4 bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/50">
          <button onClick={toggleFilters} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white">
            <Filter size={14}/><span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-blue-600/30 text-blue-400 text-xs px-2 py-0.5 rounded-full border border-blue-500/20">{activeFilterCount} active</span>
            )}
            <ChevronDown size={14} className={`transition-transform ${filtersExpanded ? '' : '-rotate-90'}`}/>
          </button>
          <div className="flex items-center gap-3">
            <input type="text" placeholder="Quick search…" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 w-48" />
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1">
                <XIcon size={12}/> Clear all
              </button>
            )}
          </div>
        </div>
        {filtersExpanded && (
          <div className="grid grid-cols-5 gap-3 px-4 py-3">
            <div>
              <label className="text-gray-500 text-xs mb-1 block">Customer</label>
              <select value={filterClient} onChange={e => setFilterClient(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500">
                <option value="">All clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-gray-500 text-xs mb-1 block">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500">
                <option value="">All statuses</option>
                <option value="open">Open</option><option value="confirmed">Confirmed</option>
                <option value="complete">Complete</option><option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="text-gray-500 text-xs mb-1 block">Reference / Search</label>
              <input type="text" placeholder="Ref # or text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-gray-500 text-xs mb-1 block">Arrival From</label>
              <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-gray-500 text-xs mb-1 block">Arrival To</label>
              <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-800/50">
              {['Transaction ID', 'Reference Number', 'Creation Date', 'Customer', 'SKUs', 'Arrival Date', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12"><Package size={32} className="text-gray-700 mx-auto mb-3" /><p className="text-gray-500 text-sm">No receipts found</p></td></tr>
            ) : filtered.map((r, i) => {
              const sc2 = statusConfig[r.status] || statusConfig.open
              const StatusIcon2 = sc2.icon
              const skuList = (r.lineItems || r.pallets || []).map(p => p.sku).filter(Boolean).join(', ')
              return (
                <tr key={r.id} onClick={() => { setSelectedReceipt(r); setActiveTab('items'); setView('detail') }}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                  <td className="px-4 py-3 text-blue-400 font-mono text-xs font-medium">{r.transactionId || r.id.slice(-6).toUpperCase()}</td>
                  <td className="px-4 py-3 text-white text-xs font-medium">{r.referenceId || r.poNumber || '—'}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-white text-sm font-medium">{r.clientName}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{skuList || '—'}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{r.arrivalDate ? new Date(r.arrivalDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit ${sc2.color}`}>
                      <StatusIcon2 size={10} /> {sc2.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); generateReceivingReport(r) }} title="Print receiving report"
                      className="text-purple-400 hover:text-purple-300 p-1 rounded hover:bg-purple-500/10">
                      <FileText size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showBulkUpload && (
        <BulkUpload type="receipts" onClose={() => setShowBulkUpload(false)} onSuccess={fetchData} />
      )}
    </div>
  )
}
