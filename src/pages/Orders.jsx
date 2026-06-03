import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import {
  Plus, X, ShoppingCart, CheckCircle, Clock, XCircle,
  Search, Package, FileText, Check, Pencil, ArrowLeft,
  Truck, DollarSign, List, ChevronDown, RotateCcw
} from 'lucide-react'
import { sendShipmentEmail } from '../email'
import jsPDF from 'jspdf'
import BarcodeScanner from '../components/BarcodeScanner'
import BulkUpload from '../components/BulkUpload'
import TransactionCharges from '../components/TransactionCharges'

const emptyShipTo = {
  company: '', recipient: '', address1: '', address2: '',
  city: '', state: '', zip: '', country: 'US', phone: '', email: ''
}
const emptyCarrier = {
  carrier: '', scac: '', service: '', billingType: '',
  accountNumber: '', trackingNumber: '', loadNumber: '',
  bolNumber: '', trailerNumber: '', sealNumber: '',
  door: '', pickupDate: '', warehouseInstructions: '', carrierInstructions: ''
}
const emptyForm = {
  clientId: '', clientName: '',
  orderNumber: '', orderDate: '', cancelDate: '', earliestShipDate: '',
  shipTo: { ...emptyShipTo },
  carrier: { ...emptyCarrier },
  notes: '', items: [], charges: []
}

const statusConfig = {
  pending:   { label: 'Pending',   color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock },
  picking:   { label: 'Picking',   color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       icon: ShoppingCart },
  shipped:   { label: 'Shipped',   color: 'bg-green-500/10 text-green-400 border-green-500/20',    icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/10 text-red-400 border-red-500/20',          icon: XCircle },
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [clients, setClients] = useState([])
  const [inventory, setInventory] = useState([])
  const [catalogItems, setCatalogItems] = useState([])

  const [openTabs, setOpenTabs] = useState([])
  const [activeTabId, setActiveTabId] = useState(null)

  const [view, setView] = useState('list')
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [activeTab, setActiveTab] = useState('details')
  const [editOrderId, setEditOrderId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [skuSearch, setSkuSearch] = useState({})
  const [skuDropdown, setSkuDropdown] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')

  const [showPickModal, setShowPickModal] = useState(false)
  const [allocations, setAllocations] = useState([])
  const [manualMode, setManualMode] = useState(false)

  const [showScanner, setShowScanner] = useState(false)
  const [scannedPallets, setScannedPallets] = useState([])

  const fetchData = async () => {
    const [ordersSnap, clientsSnap, invSnap, catalogSnap] = await Promise.all([
      getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'inventory')),
      getDocs(collection(db, 'items'))
    ])
    const newOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    setOrders(newOrders)
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setCatalogItems(catalogSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    if (selectedOrder) {
      const refreshed = newOrders.find(o => o.id === selectedOrder.id)
      if (refreshed) setSelectedOrder(refreshed)
    }
  }

  useEffect(() => { fetchData() }, [])

  const openTab = (order) => {
    if (!openTabs.find(t => t.id === order.id)) {
      setOpenTabs(prev => [...prev, { id: order.id, orderNumber: order.orderNumber || order.id.slice(-6), clientName: order.clientName }])
    }
    setActiveTabId(order.id)
    setSelectedOrder(order)
    setActiveTab('details')
    setView('detail')
  }

  const closeTab = (e, tabId) => {
    e.stopPropagation()
    const remaining = openTabs.filter(t => t.id !== tabId)
    setOpenTabs(remaining)
    if (activeTabId === tabId) {
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1]
        setActiveTabId(last.id)
        const order = orders.find(o => o.id === last.id)
        if (order) { setSelectedOrder(order); setView('detail') }
      } else { setActiveTabId(null); setView('list') }
    }
  }

  const switchTab = (tab) => {
    setActiveTabId(tab.id)
    const order = orders.find(o => o.id === tab.id)
    if (order) { setSelectedOrder(order); setView('detail'); setActiveTab('details') }
  }
  const availableSkusFor = (clientId, excludeIdx = null) => {
    const inv = inventory.filter(i => i.clientId === clientId && (i.status || 'available') === 'available')
    const skuMap = inv.reduce((acc, item) => {
      const sku = item.sku
      if (!acc[sku]) acc[sku] = { sku, description: item.description || '', totalUnits: 0, pallets: [] }
      acc[sku].totalUnits += Number(item.units || item.quantity || 0)
      acc[sku].pallets.push(item)
      return acc
    }, {})
    // Subtract already-allocated quantities from current form line items
    ;(form.items || []).forEach((it, i) => {
      if (excludeIdx !== null && i === excludeIdx) return
      if (it.sku && skuMap[it.sku]) {
        skuMap[it.sku].totalUnits = Math.max(0, skuMap[it.sku].totalUnits - Number(it.pieces || 0))
      }
    })
    return Object.values(skuMap)
  }

  const getFilteredSkus = (idx) => {
    const s = (skuSearch[idx] || '').toLowerCase()
    const all = availableSkusFor(form.clientId, idx)
    if (!s) return all
    return all.filter(i => i.sku.toLowerCase().includes(s) || i.description.toLowerCase().includes(s))
  }

  const selectSku = (idx, skuItem) => {
    const items = [...form.items]
    items[idx] = { ...items[idx], sku: skuItem.sku, description: skuItem.description, availableUnits: skuItem.totalUnits }
    setForm({ ...form, items })
    setSkuSearch({ ...skuSearch, [idx]: skuItem.sku })
    setSkuDropdown(null)
  }

  const addItem = () => setForm({ ...form, items: [...form.items, { sku: '', description: '', pieces: '', availableUnits: 0 }] })
  const removeItem = (i) => {
    setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) })
    const s = { ...skuSearch }; delete s[i]; setSkuSearch(s)
  }
  const updateItem = (i, field, value) => {
    const items = [...form.items]; items[i] = { ...items[i], [field]: value }; setForm({ ...form, items })
  }

  const calcQuantities = (items, clientId) => ({
    pallets: items.reduce((s, item) => {
      const cat = catalogItems.find(c => c.clientId === clientId && c.sku === item.sku)
      const upp = Number(cat?.unitsPerPallet || 1)
      const ppc = Number(cat?.piecesPerCarton || 1)
      const cartons = Math.ceil(Number(item.pieces || 0) / ppc)
      const ctnPerPallet = Math.ceil(upp / ppc)
      return s + (ctnPerPallet > 0 ? Math.ceil(cartons / ctnPerPallet) : 0)
    }, 0),
    units: items.reduce((s, i) => s + Number(i.pieces || 0), 0),
    cartons: items.reduce((s, item) => {
      const cat = catalogItems.find(c => c.clientId === clientId && c.sku === item.sku)
      const ppc = Number(cat?.piecesPerCarton || 1)
      return s + Math.ceil(Number(item.pieces || 0) / ppc)
    }, 0),
    orders: 1,
  })

  const chargesTotal = (form.charges || []).reduce((sum, c) => sum + Number(c.total || 0), 0)

  const allocateInventory = (clientId, items, inv) => {
    const availableInv = inv
      .filter(i => i.clientId === clientId && (i.status || 'available') === 'available')
      .sort((a, b) => new Date(a.receivedDate || a.createdAt) - new Date(b.receivedDate || b.createdAt))
    const allocationSnapshot = []
    for (const orderItem of items) {
      let remaining = Number(orderItem.pieces || orderItem.quantity || 0)
      const skuPallets = availableInv.filter(i => i.sku === orderItem.sku)
      for (const pallet of skuPallets) {
        if (remaining <= 0) break
        const palletUnits = Number(pallet.units || pallet.quantity || 0)
        const allocUnits = Math.min(palletUnits, remaining)
        allocationSnapshot.push({ inventoryId: pallet.id, palletId: pallet.palletId, sku: pallet.sku, unitsAllocated: allocUnits, previousUnits: palletUnits })
        remaining -= allocUnits
      }
    }
    return allocationSnapshot
  }

  const applyAllocation = async (allocationSnapshot, orderId) => {
    for (const alloc of allocationSnapshot) {
      const invItem = inventory.find(i => i.id === alloc.inventoryId)
      if (!invItem) continue
      const newUnits = Number(invItem.units || invItem.quantity || 0) - alloc.unitsAllocated
      await updateDoc(doc(db, 'inventory', alloc.inventoryId), {
        units: newUnits, status: newUnits <= 0 ? 'allocated' : 'available',
        allocatedOrderId: orderId, allocatedAt: new Date().toISOString()
      })
    }
  }

  const restoreInventory = async (allocationSnapshot) => {
    for (const alloc of allocationSnapshot) {
      await updateDoc(doc(db, 'inventory', alloc.inventoryId), {
        units: alloc.previousUnits, status: 'available',
        allocatedOrderId: null, allocatedAt: null, shippedOrderId: null, shippedAt: null
      })
    }
  }

  const genTransactionId = () => {
    const n = new Date()
    const date = `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`
    return `ORD-${date}-${Math.floor(Math.random()*9000)+1000}`
  }
  const openNew = () => { setForm(emptyForm); setSkuSearch({}); setEditOrderId(null); setActiveTab('details'); setView('new') }

  const openEdit = (order) => {
    const skuSearchMap = {}
    const items = (order.items || []).map((item, i) => { skuSearchMap[i] = item.sku; return { ...item, availableUnits: 0 } })
    setForm({
      clientId: order.clientId || '', clientName: order.clientName || '',
      orderNumber: order.orderNumber || '', orderDate: order.orderDate || '',
      cancelDate: order.cancelDate || '', earliestShipDate: order.earliestShipDate || '',
      shipTo: order.shipTo || { ...emptyShipTo }, carrier: order.carrier || { ...emptyCarrier },
      notes: order.notes || '', items, charges: order.charges || []
    })
    setSkuSearch(skuSearchMap); setEditOrderId(order.id); setActiveTab('details'); setView('edit')
  }

  const handleSubmit = async () => {
    if (!form.clientId || !form.orderDate || form.items.length === 0) return
    setLoading(true)
    try {
      const confirmedCharges = (form.charges || []).filter(c => c.status === 'confirmed' || c.status === 'adjusted')
      const data = {
        ...form,
        charges: form.charges || [],
        totalUnits: form.items.reduce((sum, i) => sum + Number(i.pieces || 0), 0),
        totalCharges: confirmedCharges.reduce((s, c) => s + Number(c.total || 0), 0)
      }
      if (editOrderId) {
        const existingOrder = orders.find(o => o.id === editOrderId)
        if (existingOrder?.inventoryAllocations?.length) await restoreInventory(existingOrder.inventoryAllocations)
        const freshInv = await getDocs(collection(db, 'inventory'))
        const freshInventory = freshInv.docs.map(d => ({ id: d.id, ...d.data() }))
        const newAlloc = allocateInventory(form.clientId, form.items, freshInventory)
        await applyAllocation(newAlloc, editOrderId)
        await updateDoc(doc(db, 'orders', editOrderId), { ...data, inventoryAllocations: newAlloc })
      } else {
        const freshInv = await getDocs(collection(db, 'inventory'))
        const freshInventory = freshInv.docs.map(d => ({ id: d.id, ...d.data() }))
        const allocationSnapshot = allocateInventory(form.clientId, form.items, freshInventory)
        const newOrderRef = await addDoc(collection(db, 'orders'), { ...data, transactionId: genTransactionId(), status: 'pending', inventoryAllocations: allocationSnapshot, createdAt: new Date().toISOString() })
        await applyAllocation(allocationSnapshot, newOrderRef.id)
      }
      setView('list'); setEditOrderId(null); fetchData()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const updateStatus = async (order, newStatus) => {
    if (newStatus === 'shipped') {
      if (order.inventoryAllocations?.length) {
        for (const alloc of order.inventoryAllocations) {
          const invItem = inventory.find(i => i.id === alloc.inventoryId)
          if (!invItem) continue
          await updateDoc(doc(db, 'inventory', alloc.inventoryId), {
            units: Number(invItem.units || 0),
            status: Number(invItem.units || 0) <= 0 ? 'shipped' : invItem.status,
            shippedOrderId: order.id, shippedAt: new Date().toISOString()
          })
        }
      }
      const client = clients.find(c => c.id === order.clientId)
      if (client?.email) await sendShipmentEmail(order, client.email)
    }
    await updateDoc(doc(db, 'orders', order.id), { status: newStatus })
    fetchData()
    setSuccessMsg(`Order status updated to ${newStatus}`)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const deleteOrder = async (order) => {
  if (!window.confirm(`Delete order ${order.orderNumber || '#' + order.id.slice(-6)}? This cannot be undone.`)) return
  setLoading(true)
  try {
    if (order.inventoryAllocations?.length) await restoreInventory(order.inventoryAllocations)
    const { deleteDoc: dd, doc: fd } = await import('firebase/firestore')
    await dd(fd(db, 'orders', order.id))
    setSelectedOrder(null)
    fetchData()
  } catch (err) { console.error(err) }
  setLoading(false)
}
const revertOrder = async (order) => {
    if (!window.confirm('Revert this order back to Pending? This will restore all allocated inventory.')) return
    setLoading(true)
    try {
      if (order.inventoryAllocations?.length) await restoreInventory(order.inventoryAllocations)
      const freshInv = await getDocs(collection(db, 'inventory'))
      const freshInventory = freshInv.docs.map(d => ({ id: d.id, ...d.data() }))
      const newAlloc = allocateInventory(order.clientId, order.items || [], freshInventory)
      await applyAllocation(newAlloc, order.id)
      await updateDoc(doc(db, 'orders', order.id), { status: 'pending', inventoryAllocations: newAlloc, revertedAt: new Date().toISOString() })
      fetchData()
      setSuccessMsg('Order reverted to Pending � inventory restored')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const openPickTicket = (order) => {
    setScannedPallets([])
    const allocationSnapshot = order.inventoryAllocations || []
    const allocs = (order.items || []).map(orderItem => {
      const catalog = catalogItems.find(c => c.clientId === order.clientId && c.sku === orderItem.sku)
      const piecesPerCarton = Number(catalog?.piecesPerCarton || 1)
      const totalPiecesNeeded = Number(orderItem.pieces || orderItem.quantity || 0)
      const skuAllocs = allocationSnapshot.filter(a => a.sku === orderItem.sku)
      const palletAllocs = skuAllocs.map(a => {
        const invItem = inventory.find(i => i.id === a.inventoryId)
        return { palletId: a.palletId || a.inventoryId, location: invItem?.location || '�', units: a.unitsAllocated, cartons: piecesPerCarton > 0 ? Math.ceil(a.unitsAllocated / piecesPerCarton) : 0, piecesPerCarton, receivedDate: invItem?.receivedDate, selected: true, scanned: false, inventoryId: a.inventoryId }
      })
      return { sku: orderItem.sku, description: orderItem.description, qtyOrdered: totalPiecesNeeded, totalCartons: piecesPerCarton > 0 ? Math.ceil(totalPiecesNeeded / piecesPerCarton) : 0, piecesPerCarton, pallets: palletAllocs, shortfall: Math.max(0, totalPiecesNeeded - palletAllocs.reduce((s, p) => s + p.units, 0)), order }
    })
    setAllocations(allocs); setShowPickModal(true)
  }

  const togglePallet = (skuIdx, palletIdx) => {
    const newAllocs = [...allocations]
    newAllocs[skuIdx].pallets[palletIdx].selected = !newAllocs[skuIdx].pallets[palletIdx].selected
    setAllocations(newAllocs)
  }

  const handlePickScan = (barcode) => {
    setShowScanner(false)
    let found = false
    const newAllocs = allocations.map(alloc => ({
      ...alloc,
      pallets: alloc.pallets.map(pallet => {
        if (pallet.palletId === barcode || pallet.palletId === barcode.toUpperCase() || alloc.sku === barcode || alloc.sku === barcode.toUpperCase()) {
          found = true; return { ...pallet, scanned: true, selected: true }
        }
        return pallet
      })
    }))
    if (found) { setAllocations(newAllocs); setScannedPallets(prev => [...prev, barcode]); if (navigator.vibrate) navigator.vibrate([100, 50, 100]) }
  }

  const generatePickTicketPDF = () => {
    const order = allocations[0]?.order || selectedOrder
    const pdf = new jsPDF()
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    let y = 0
    const drawHeader = () => {
      pdf.setFillColor(200, 16, 46); pdf.rect(0, 0, pw, 18, 'F')
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.setFont('helvetica', 'bold')
      pdf.text('Pick Ticket', pw / 2, 12, { align: 'center' })
      pdf.setTextColor(200, 16, 46); pdf.setFontSize(13)
      pdf.text(order?.clientName || '', 14, 28)
      pdf.setFontSize(9); pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal')
      pdf.text('Warehouse: JCT LOGISTICS INC.', 14, 35)
      pdf.setTextColor(200, 16, 46); pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
      pdf.text(`Transaction # : ${order?.orderNumber || order?.id?.slice(-6) || '�'}`, pw - 14, 28, { align: 'right' })
      const st = order?.shipTo
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(27, 42, 74)
      pdf.text('Ship To', 14, 43); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
      if (st?.company) pdf.text(st.company, 14, 49)
      if (st?.address1) pdf.text(st.address1, 14, 55)
      if (st?.city) pdf.text(`${st.city}, ${st.state} ${st.zip}`, 14, 61)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100, 100, 100)
      pdf.text('Reference # :', pw - 80, 43); pdf.text('Entered Date :', pw - 80, 50)
      pdf.text('Carrier :', pw - 80, 57); pdf.text('Tracking # :', pw - 80, 64)
      pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'bold')
      pdf.text(order?.orderNumber || '�', pw - 14, 43, { align: 'right' })
      pdf.text(order?.orderDate || '�', pw - 14, 50, { align: 'right' })
      pdf.text(order?.carrier?.carrier || '�', pw - 14, 57, { align: 'right' })
      pdf.text(order?.carrier?.trackingNumber || '�', pw - 14, 64, { align: 'right' })
      pdf.setDrawColor(200, 16, 46); pdf.setLineWidth(0.5); pdf.line(14, 70, pw - 14, 70); y = 78
    }
    drawHeader()
    pdf.setFillColor(240, 240, 245); pdf.rect(14, y, pw - 28, 8, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(27, 42, 74)
    pdf.text('SKU', 16, y + 5.5); pdf.text('Description', 50, y + 5.5); pdf.text('UOM', 115, y + 5.5)
    pdf.text('Qty Ord', 135, y + 5.5); pdf.text('Cartons', 155, y + 5.5); pdf.text('Pcs/Ctn', pw - 16, y + 5.5, { align: 'right' })
    y += 8
    allocations.forEach(alloc => {
      const sel = alloc.pallets.filter(p => p.selected)
      if (!sel.length) return
      if (y + 14 > ph - 30) { pdf.addPage(); drawHeader() }
      pdf.setFillColor(255, 255, 255); pdf.rect(14, y, pw - 28, 10, 'F')
      pdf.setDrawColor(220, 220, 220); pdf.rect(14, y, pw - 28, 10)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(27, 42, 74)
      pdf.text(alloc.sku, 16, y + 6.5); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5)
      pdf.text((alloc.description || '').substring(0, 38), 50, y + 6.5)
      pdf.text('Each', 115, y + 6.5); pdf.setFont('helvetica', 'bold')
      pdf.text(String(alloc.qtyOrdered), 135, y + 6.5); pdf.text(String(alloc.totalCartons), 155, y + 6.5)
      pdf.text(String(alloc.piecesPerCarton), pw - 16, y + 6.5, { align: 'right' }); y += 10
      sel.forEach(pallet => {
        if (y + 8 > ph - 30) { pdf.addPage(); drawHeader() }
        if (pallet.scanned) { pdf.setFillColor(240, 255, 240) } else { pdf.setFillColor(250, 250, 252) }
        pdf.rect(14, y, pw - 28, 8, 'F'); pdf.setDrawColor(235, 235, 235); pdf.rect(14, y, pw - 28, 8)
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(80, 80, 80)
        pdf.text('  Details:', 16, y + 5)
        if (pallet.location !== '�') pdf.text(`Loc: ${pallet.location}`, 38, y + 5)
        pdf.text(`Pallet: ${pallet.palletId}`, 75, y + 5); pdf.text(`Qty (Each): ${pallet.units}`, 115, y + 5)
        pdf.text(`Cartons: ${pallet.cartons}`, 155, y + 5)
        if (pallet.scanned) { pdf.setTextColor(22, 163, 74); pdf.text('✓ Scanned', pw - 16, y + 5, { align: 'right' }) }
        y += 8
      })
    })
    y += 4
    const tp = allocations.reduce((s, a) => s + a.pallets.filter(p => p.selected).reduce((ss, p) => ss + p.units, 0), 0)
    const tc = allocations.reduce((s, a) => s + a.pallets.filter(p => p.selected).reduce((ss, p) => ss + p.cartons, 0), 0)
    pdf.setFillColor(240, 240, 245); pdf.rect(14, y, pw - 28, 9, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(27, 42, 74)
    pdf.text('Totals:', 16, y + 6); pdf.text(String(tp), 135, y + 6); pdf.text(String(tc), 155, y + 6); y += 14
    pdf.setDrawColor(200, 16, 46); pdf.line(14, y, pw - 14, y); y += 6
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(27, 42, 74)
    pdf.text('MATERIALS', 14, y); pdf.text('U.O.M. SHIPPED', 80, y); y += 6
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5)
    const mats = ['LABELS:', 'PALLETS:', 'BOXES:', 'Shrink Wrap:  Y  N']
    const uoms = ['UNIT:', 'INNER:', 'CARTON:', 'PALLET:']
    const sigs = ['Picked by:', 'Checked by:', 'Loaded by:', 'Shipped by:']
    mats.forEach((l, i) => { pdf.text(l, 14, y + i * 7); if (i < 3) pdf.line(35, y + i * 7 + 1, 72, y + i * 7 + 1) })
    uoms.forEach((l, i) => { pdf.text(l, 80, y + i * 7); pdf.line(95, y + i * 7 + 1, 130, y + i * 7 + 1) })
    sigs.forEach((l, i) => { pdf.text(l, pw - 70, y + i * 7); pdf.line(pw - 45, y + i * 7 + 1, pw - 14, y + i * 7 + 1) })
    pdf.setFontSize(7); pdf.setTextColor(150, 150, 150)
    pdf.text(`Printed: ${new Date().toLocaleString()}`, 14, ph - 8)
    pdf.save(`PickTicket_${order?.clientName}_${order?.orderNumber || 'Order'}.pdf`)
  }

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

  const inputCls = "w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
  const labelCls = "text-gray-400 text-xs mb-1 block"

  // ═══════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'new' || view === 'edit') {
    const skuList = availableSkusFor(form.clientId)
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView(selectedOrder ? 'detail' : 'list'); setEditOrderId(null) }}
              className="text-gray-400 hover:text-white flex items-center gap-1 text-sm">
              <ArrowLeft size={16} /> {editOrderId ? 'Order' : 'Orders'}
            </button>
            <span className="text-gray-600">/</span>
            <h2 className="text-xl font-semibold text-white">{editOrderId ? 'Edit Order' : 'New Order'}</h2>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setView(selectedOrder ? 'detail' : 'list'); setEditOrderId(null) }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg">Cancel</button>
            <button onClick={handleSubmit} disabled={loading || !form.clientId || !form.orderDate || form.items.length === 0}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
              {loading ? 'Saving...' : editOrderId ? 'Save Changes' : 'Create Order & Allocate Inventory'}
            </button>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-6 gap-4">
            <div>
              <label className={labelCls}>Client *</label>
              <select value={form.clientId} onChange={e => {
                const c = clients.find(x => x.id === e.target.value)
                setForm({ ...form, clientId: e.target.value, clientName: c?.companyName || '', items: [], charges: [] })
                setSkuSearch({})
              }} disabled={!!editOrderId} className={inputCls + ' disabled:opacity-50'}>
                <option value="">Select...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Reference / Order #</label><input value={form.orderNumber} onChange={e => setForm({ ...form, orderNumber: e.target.value })} className={inputCls} placeholder="FBA19DXNF40G" /></div>
            <div><label className={labelCls}>Order Date *</label><input type="date" value={form.orderDate} onChange={e => setForm({ ...form, orderDate: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Earliest Ship Date</label><input type="date" value={form.earliestShipDate} onChange={e => setForm({ ...form, earliestShipDate: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Cancel Date</label><input type="date" value={form.cancelDate} onChange={e => setForm({ ...form, cancelDate: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Notes</label><input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Special instructions..." /></div>
          </div>
        </div>

        <div className="flex gap-2 border-b border-gray-800 mb-4">
          {[
            { id: 'details', label: 'Shipping Destination', icon: Package },
            { id: 'items',   label: 'Order Line Items',     icon: List },
            { id: 'carrier', label: 'Carrier & Routing',    icon: Truck },
            { id: 'charges', label: 'Order Charges',        icon: DollarSign },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              <tab.icon size={14} />{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'details' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Shipping Destination</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelCls}>Company Name</label><input value={form.shipTo.company} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, company: e.target.value } })} className={inputCls} placeholder="Amazon" /></div>
              <div><label className={labelCls}>Recipient Name</label><input value={form.shipTo.recipient} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, recipient: e.target.value } })} className={inputCls} /></div>
              <div><label className={labelCls}>Address 1</label><input value={form.shipTo.address1} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, address1: e.target.value } })} className={inputCls} /></div>
              <div><label className={labelCls}>Address 2</label><input value={form.shipTo.address2} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, address2: e.target.value } })} className={inputCls} /></div>
              <div><label className={labelCls}>City</label><input value={form.shipTo.city} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, city: e.target.value } })} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>State</label><input value={form.shipTo.state} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, state: e.target.value } })} className={inputCls} placeholder="CA" /></div>
                <div><label className={labelCls}>ZIP</label><input value={form.shipTo.zip} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, zip: e.target.value } })} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Phone</label><input value={form.shipTo.phone} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, phone: e.target.value } })} className={inputCls} /></div>
              <div><label className={labelCls}>Email</label><input value={form.shipTo.email} onChange={e => setForm({ ...form, shipTo: { ...form.shipTo, email: e.target.value } })} className={inputCls} /></div>
            </div>
          </div>
        )}

        {activeTab === 'items' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-medium">Order Line Items</h3>
              <div className="flex items-center gap-3">
                {form.clientId && <span className="text-xs text-green-400">{availableSkusFor(form.clientId).length} SKUs available</span>}
                <button onClick={addItem} disabled={!form.clientId}
                  className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg">
                  <Plus size={13} /> Add Item
                </button>
              </div>
            </div>
            {form.items.length === 0 ? (
              <div className="border border-gray-700 border-dashed rounded-lg p-8 text-center">
                <p className="text-gray-500 text-sm">{form.clientId ? 'Click "Add Item" to add SKUs' : 'Select a client first'}</p>
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-12 gap-3 px-2 pb-2 text-gray-500 text-xs border-b border-gray-800 mb-2">
                  <div className="col-span-3">SKU</div><div className="col-span-4">Description</div>
                  <div className="col-span-2">Pieces *</div><div className="col-span-2">Cartons (auto)</div><div className="col-span-1">Avail.</div>
                </div>
                {form.items.map((item, i) => {
                  const liveAvail = item.sku ? (availableSkusFor(form.clientId, i).find(s => s.sku === item.sku)?.totalUnits || 0) : 0
                  const catalog = catalogItems.find(c => c.clientId === form.clientId && c.sku === item.sku)
                  const ppc = Number(catalog?.piecesPerCarton || 0)
                  const cartons = ppc > 0 && item.pieces ? Math.ceil(Number(item.pieces) / ppc) : '�'
                  const over = liveAvail > 0 && Number(item.pieces) > liveAvail
                  return (
                    <div key={i} className="grid grid-cols-12 gap-3 items-center mb-2">
                      <div className="col-span-3 relative">
                        <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden focus-within:border-blue-500">
                          <Search size={11} className="text-gray-500 ml-2 flex-shrink-0" />
                          <input value={skuSearch[i] !== undefined ? skuSearch[i] : item.sku}
                            onChange={e => { setSkuSearch({ ...skuSearch, [i]: e.target.value }); updateItem(i, 'sku', e.target.value.toUpperCase()); setSkuDropdown(i) }}
                            onFocus={() => { if (skuList.length > 0) setSkuDropdown(i) }}
                            onBlur={() => setTimeout(() => setSkuDropdown(null), 150)}
                            className="flex-1 bg-transparent text-white px-2 py-2 text-sm focus:outline-none uppercase" placeholder="Search SKU..." />
                        </div>
                        {skuDropdown === i && getFilteredSkus(i).length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto">
                            {getFilteredSkus(i).map(s => (
                              <button key={s.sku} onMouseDown={() => selectSku(i, s)}
                                className="w-full text-left px-3 py-2.5 hover:bg-gray-700 border-b border-gray-700/50 last:border-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-white text-xs font-mono font-medium">{s.sku}</span>
                                  <span className={`text-xs font-medium ${s.totalUnits > 0 ? 'text-green-400' : 'text-red-400'}`}>{s.totalUnits} avail.</span>
                                </div>
                                <p className="text-gray-400 text-xs mt-0.5 truncate">{s.description}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                        className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" placeholder="Description" />
                      <input type="number" value={item.pieces} onChange={e => updateItem(i, 'pieces', e.target.value)}
                        className={`col-span-2 bg-gray-800 border rounded-lg px-3 py-2 text-sm focus:outline-none ${over ? 'border-red-500 text-red-400' : 'border-gray-700 text-white focus:border-blue-500'}`} placeholder="e.g. 500" />
                      <div className="col-span-2 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-400">
                        {cartons} {ppc > 0 && <span className="text-xs text-gray-600">({ppc}/ctn)</span>}
                      </div>
                      <div className="col-span-1 flex items-center justify-between">
                        <span className={`text-xs font-medium ${liveAvail > 0 ? 'text-green-400' : item.sku ? 'text-red-400' : 'text-gray-600'}`}>
                          {liveAvail || (item.sku ? '0' : '-')}
                        </span>
                        <button onClick={() => removeItem(i)} className="text-gray-600 hover:text-red-400 ml-2"><X size={14} /></button>
                      </div>
                    </div>
                  )
                })}
                {form.items.some(item => item.availableUnits > 0 && Number(item.pieces) > item.availableUnits) && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg px-3 py-2 mt-2">⚠️ One or more items exceed available inventory</div>
                )}
                <div className="border-t border-gray-800 mt-4 pt-3 flex justify-end gap-8 text-sm">
                  <span className="text-gray-400">Total Pieces: <span className="text-white font-medium">{form.items.reduce((s, i) => s + Number(i.pieces || 0), 0)}</span></span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'carrier' && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Carrier Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div><label className={labelCls}>Carrier</label><input value={form.carrier.carrier} onChange={e => setForm({ ...form, carrier: { ...form.carrier, carrier: e.target.value } })} className={inputCls} placeholder="UPS, FedEx..." /></div>
                <div><label className={labelCls}>SCAC</label><input value={form.carrier.scac} onChange={e => setForm({ ...form, carrier: { ...form.carrier, scac: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Service</label><input value={form.carrier.service} onChange={e => setForm({ ...form, carrier: { ...form.carrier, service: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Billing Type</label><select value={form.carrier.billingType} onChange={e => setForm({ ...form, carrier: { ...form.carrier, billingType: e.target.value } })} className={inputCls}><option value="">Select...</option><option>Prepaid</option><option>Collect</option><option>Third Party</option></select></div>
                <div><label className={labelCls}>Account Number</label><input value={form.carrier.accountNumber} onChange={e => setForm({ ...form, carrier: { ...form.carrier, accountNumber: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Tracking Number</label><input value={form.carrier.trackingNumber} onChange={e => setForm({ ...form, carrier: { ...form.carrier, trackingNumber: e.target.value } })} className={inputCls} /></div>
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Routing</h3>
              <div className="grid grid-cols-3 gap-4">
                <div><label className={labelCls}>Load Number</label><input value={form.carrier.loadNumber} onChange={e => setForm({ ...form, carrier: { ...form.carrier, loadNumber: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Bill of Lading #</label><input value={form.carrier.bolNumber} onChange={e => setForm({ ...form, carrier: { ...form.carrier, bolNumber: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Trailer Number</label><input value={form.carrier.trailerNumber} onChange={e => setForm({ ...form, carrier: { ...form.carrier, trailerNumber: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Seal Number</label><input value={form.carrier.sealNumber} onChange={e => setForm({ ...form, carrier: { ...form.carrier, sealNumber: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Door</label><input value={form.carrier.door} onChange={e => setForm({ ...form, carrier: { ...form.carrier, door: e.target.value } })} className={inputCls} /></div>
                <div><label className={labelCls}>Pickup Date / Time</label><input type="datetime-local" value={form.carrier.pickupDate} onChange={e => setForm({ ...form, carrier: { ...form.carrier, pickupDate: e.target.value } })} className={inputCls} /></div>
                <div className="col-span-3 grid grid-cols-2 gap-4">
                  <div><label className={labelCls}>Warehouse Instructions</label><textarea value={form.carrier.warehouseInstructions} onChange={e => setForm({ ...form, carrier: { ...form.carrier, warehouseInstructions: e.target.value } })} rows={3} className={inputCls + ' resize-none'} /></div>
                  <div><label className={labelCls}>Carrier Instructions</label><textarea value={form.carrier.carrierInstructions} onChange={e => setForm({ ...form, carrier: { ...form.carrier, carrierInstructions: e.target.value } })} rows={3} className={inputCls + ' resize-none'} /></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'charges' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Order Charges</h3>
            <TransactionCharges
              charges={(form.charges || []).map((c, i) => ({ ...c, id: c.id || i, status: c.status || 'confirmed' }))}
              onChargesChange={newCharges => setForm({ ...form, charges: newCharges })}
              rateCard={clients.find(c => c.id === form.clientId)?.rateCard || []}
              trigger="on_ship"
              quantities={calcQuantities(form.items, form.clientId)}
              clientName={form.clientName}
            />
          </div>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedOrder) {
    const order = orders.find(o => o.id === selectedOrder.id) || selectedOrder
    const status = statusConfig[order.status] || statusConfig.pending
    const StatusIcon = status.icon

    return (
      <div className="p-6">
        {openTabs.length > 0 && (
          <div className="flex items-center gap-1 mb-4 border-b border-gray-800 pb-0">
            <button onClick={() => setView('list')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-white border-b-2 border-transparent hover:border-gray-600 transition-colors">
              <List size={12} /> Orders
            </button>
            {openTabs.map(tab => (
              <div key={tab.id} onClick={() => switchTab(tab)}
                className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-b-2 transition-colors ${activeTabId === tab.id ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'}`}>
                <Pencil size={10} />
                <span className="max-w-32 truncate">{tab.orderNumber} � {tab.clientName}</span>
                <button onClick={e => closeTab(e, tab.id)} className="text-gray-600 hover:text-red-400 ml-1"><X size={11} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {openTabs.length === 0 && (
              <button onClick={() => setView('list')} className="text-gray-400 hover:text-white flex items-center gap-1 text-sm">
                <ArrowLeft size={16} /> Orders
              </button>
            )}
            <h2 className="text-white font-semibold">{order.transactionId || order.orderNumber || 'Order'}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${status.color}`}>
              <StatusIcon size={10} /> {status.label}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {(order.status === 'pending' || order.status === 'picking') && (
              <button onClick={() => openPickTicket(order)}
                className="flex items-center gap-1.5 text-sm bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-600/20 px-3 py-2 rounded-lg transition-colors">
                <FileText size={14} /> Pick Ticket
              </button>
            )}
            {order.status !== 'shipped' && order.status !== 'cancelled' && (
              <button onClick={() => openEdit(order)}
                className="flex items-center gap-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg transition-colors">
                <Pencil size={14} /> Edit Order
              </button>
            )}
            {(order.status === 'pending' || order.status === 'open') && (
              <button onClick={() => deleteOrder(order)} disabled={loading}
                className="text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <X size={11}/> Delete Order
              </button>
            )}
            {(order.status === 'shipped' || order.status === 'cancelled') && (
              <button onClick={() => revertOrder(order)} disabled={loading}
                className="flex items-center gap-1.5 text-sm bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 border border-yellow-600/20 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                <RotateCcw size={14} /> Reopen Order
              </button>
            )}
            {order.status === 'pending' && (
              <button onClick={() => updateStatus(order, 'picking')}
                className="text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-600/20 px-3 py-2 rounded-lg transition-colors">
                Start Picking
              </button>
            )}
            {order.status === 'picking' && (
              <button onClick={() => updateStatus(order, 'shipped')}
                className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg transition-colors flex items-center gap-1">
                <CheckCircle size={14} /> Ship & Close Order
              </button>
            )}
          </div>
        </div>

        {successMsg && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
            <CheckCircle size={16} /> {successMsg}
          </div>
        )}

        <div className="grid grid-cols-6 gap-3 mb-4">
          {[
            { label: 'Client',        value: order.clientName },
            { label: 'Reference #',   value: order.orderNumber || '�' },
            { label: 'Order Date',    value: order.orderDate },
            { label: 'Ship Date',     value: order.earliestShipDate || '�' },
            { label: 'Cancel Date',   value: order.cancelDate || '�' },
            { label: 'Total Charges', value: `$${Number(order.totalCharges || 0).toFixed(2)}` },
          ].map(f => (
            <div key={f.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500 mb-0.5">{f.label}</p>
              <p className="text-white text-sm font-medium truncate">{f.value}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-b border-gray-800 mb-4">
          {[
            { id: 'details', label: 'Order Contact Details', icon: Package },
            { id: 'items',   label: 'Order Line Items',      icon: List },
            { id: 'carrier', label: 'Carrier and Routing',   icon: Truck },
            { id: 'charges', label: 'Order Charges',         icon: DollarSign },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              <tab.icon size={14} />{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'details' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Shipping Destination</h3>
            {order.shipTo?.company ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {[
                  ['Company', order.shipTo?.company], ['Recipient', order.shipTo?.recipient || '�'],
                  ['Address 1', order.shipTo?.address1 || '�'], ['Address 2', order.shipTo?.address2 || '�'],
                  ['City', order.shipTo?.city || '�'], ['State / ZIP', `${order.shipTo?.state || ''} ${order.shipTo?.zip || ''}`.trim() || '�'],
                  ['Phone', order.shipTo?.phone || '�'], ['Email', order.shipTo?.email || '�'],
                ].map(([label, value]) => (
                  <div key={label}><span className="text-gray-500 text-xs">{label}</span><p className="text-white">{value}</p></div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No shipping destination � edit order to add</p>
            )}
            {order.notes && <div className="mt-4 pt-4 border-t border-gray-800"><span className="text-gray-500 text-xs">Notes</span><p className="text-white text-sm mt-1">{order.notes}</p></div>}
          </div>
        )}

        {activeTab === 'items' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/50">
                  {['SKU', 'Description', 'Qty Ordered', 'Primary Units', 'Cartons', 'Available'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(order.items || []).map((item, i) => {
                  const cat = catalogItems.find(c => c.clientId === order.clientId && c.sku === item.sku)
                  const ppc = Number(cat?.piecesPerCarton || 1)
                  const cartons = ppc > 0 ? Math.ceil(Number(item.pieces || item.quantity || 0) / ppc) : '�'
                  const avail = availableSkusFor(order.clientId).find(s => s.sku === item.sku)
                  return (
                    <tr key={i} className={`border-b border-gray-800/50 ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                      <td className="px-4 py-3 text-white font-mono text-xs font-medium">{item.sku}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{item.description}</td>
                      <td className="px-4 py-3 text-white font-medium">{item.pieces || item.quantity}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">Each</td>
                      <td className="px-4 py-3 text-gray-300">{cartons}</td>
                      <td className="px-4 py-3"><span className={`text-xs font-medium ${(avail?.totalUnits || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>{avail?.totalUnits || 0}</span></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/30">
                  <td colSpan={2} className="px-4 py-3 text-xs text-gray-400 font-medium">Totals</td>
                  <td className="px-4 py-3 text-white font-semibold">{(order.items || []).reduce((s, i) => s + Number(i.pieces || i.quantity || 0), 0)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">Each</td>
                  <td className="px-4 py-3 text-white font-semibold">{(order.items || []).reduce((s, item) => { const cat = catalogItems.find(c => c.clientId === order.clientId && c.sku === item.sku); const ppc = Number(cat?.piecesPerCarton || 1); return s + Math.ceil(Number(item.pieces || item.quantity || 0) / ppc) }, 0)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            {order.status === 'picking' && (
              <>
                <div className="px-4 py-3 border-t border-gray-800 flex gap-2">
                  <input placeholder="Enter tracking number and press Enter..."
                    className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 flex-1"
                    onKeyDown={async e => { if (e.key === 'Enter' && e.target.value) { await updateDoc(doc(db, 'orders', order.id), { 'carrier.trackingNumber': e.target.value }); fetchData() } }} />
                </div>
                <div className="px-4 py-3 bg-yellow-500/5 border-t border-yellow-500/20 text-yellow-400 text-xs">
                  ⚠️ Clicking "Ship & Close Order" will deduct allocated quantities from inventory using FIFO
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'carrier' && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Carrier Information</h3>
              <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                {[['Carrier', order.carrier?.carrier || '�'], ['SCAC', order.carrier?.scac || '�'], ['Service', order.carrier?.service || '�'], ['Billing', order.carrier?.billingType || '�'], ['Account #', order.carrier?.accountNumber || '�'], ['Tracking #', order.carrier?.trackingNumber || '�']].map(([label, value]) => (
                  <div key={label}><span className="text-gray-500 text-xs">{label}</span><p className="text-white">{value}</p></div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-medium mb-4">Routing</h3>
              <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                {[['Load #', order.carrier?.loadNumber || '�'], ['BOL #', order.carrier?.bolNumber || '�'], ['Trailer #', order.carrier?.trailerNumber || '�'], ['Seal #', order.carrier?.sealNumber || '�'], ['Door', order.carrier?.door || '�'], ['Pickup Date', order.carrier?.pickupDate || '�']].map(([label, value]) => (
                  <div key={label}><span className="text-gray-500 text-xs">{label}</span><p className="text-white">{value}</p></div>
                ))}
                {order.carrier?.warehouseInstructions && <div className="col-span-3"><span className="text-gray-500 text-xs">Warehouse Instructions</span><p className="text-white mt-1">{order.carrier.warehouseInstructions}</p></div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'charges' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Order Charges</h3>
            <TransactionCharges
              charges={(order.charges || []).map((c, i) => ({ ...c, id: c.id || i, status: c.status || 'confirmed' }))}
              onChargesChange={async newCharges => {
                const total = newCharges.reduce((s, c) => s + Number(c.total || 0), 0)
                await updateDoc(doc(db, 'orders', order.id), { charges: newCharges, totalCharges: total })
                fetchData()
              }}
              rateCard={clients.find(c => c.id === order.clientId)?.rateCard || []}
              trigger="on_ship"
              quantities={calcQuantities(order.items || [], order.clientId)}
              clientName={order.clientName}
              readOnly={order.status === 'shipped' || order.status === 'cancelled'}
            />
          </div>
        )}

        {showPickModal && (
          <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                <div>
                  <h3 className="text-white font-semibold">Pick Ticket</h3>
                  <p className="text-gray-500 text-xs mt-0.5">
                    FIFO allocated · {allocations.reduce((s, a) => s + a.pallets.filter(p => p.selected).length, 0)} pallets
                    {scannedPallets.length > 0 && <span className="text-green-400 ml-2">· {scannedPallets.length} scanned</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowScanner(true)}
                    className="flex items-center gap-1.5 text-sm bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-600/20 px-3 py-1.5 rounded-lg transition-colors">
                    📷 Scan Pallet
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={manualMode} onChange={e => setManualMode(e.target.checked)} className="w-3.5 h-3.5 accent-purple-500" />
                    <span className="text-gray-400 text-xs">Manual selection</span>
                  </label>
                  <button onClick={() => setShowPickModal(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
                </div>
              </div>
              <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                {allocations.map((alloc, skuIdx) => {
                  const selectedPieces = alloc.pallets.filter(p => p.selected).reduce((s, p) => s + p.units, 0)
                  const selectedCartons = alloc.pallets.filter(p => p.selected).reduce((s, p) => s + p.cartons, 0)
                  return (
                    <div key={alloc.sku} className="border border-gray-800 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-800/40">
                        <div>
                          <span className="text-white font-mono text-sm font-medium">{alloc.sku}</span>
                          <span className="text-gray-400 text-xs ml-3">{alloc.description}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-gray-400">Ordered: <span className="text-white font-medium">{alloc.qtyOrdered} pcs</span></span>
                          <span className="text-gray-400">Allocated: <span className={`font-medium ${selectedPieces >= alloc.qtyOrdered ? 'text-green-400' : 'text-yellow-400'}`}>{selectedPieces} pcs</span></span>
                          <span className="text-gray-400">Cartons: <span className="text-white font-medium">{selectedCartons}</span></span>
                          {alloc.shortfall > 0 && <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Short {alloc.shortfall}</span>}
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-800 text-gray-500">
                            {manualMode && <th className="px-4 py-2 w-8"></th>}
                            <th className="text-left px-4 py-2 font-medium">Pallet ID</th>
                            <th className="text-left px-4 py-2 font-medium">Location</th>
                            <th className="text-left px-4 py-2 font-medium">Received</th>
                            <th className="text-left px-4 py-2 font-medium">Pieces</th>
                            <th className="text-left px-4 py-2 font-medium">Cartons</th>
                            <th className="text-left px-4 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {alloc.pallets.map((pallet, palletIdx) => (
                            <tr key={palletIdx}
                              className={`border-b border-gray-800/50 ${!pallet.selected ? 'opacity-40' : ''} ${manualMode ? 'cursor-pointer hover:bg-gray-800/30' : ''} ${pallet.scanned ? 'bg-green-500/5' : ''}`}
                              onClick={() => manualMode && togglePallet(skuIdx, palletIdx)}>
                              {manualMode && (
                                <td className="px-4 py-2">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${pallet.selected ? 'bg-purple-600 border-purple-600' : 'border-gray-600'}`}>
                                    {pallet.selected && <Check size={10} className="text-white" />}
                                  </div>
                                </td>
                              )}
                              <td className="px-4 py-2 text-blue-400 font-mono">
                                <div className="flex items-center gap-2">{pallet.palletId}{pallet.scanned && <span className="text-green-400 text-xs font-normal">✓ Scanned</span>}</div>
                              </td>
                              <td className="px-4 py-2 text-white font-medium">{pallet.location}</td>
                              <td className="px-4 py-2 text-gray-400">{pallet.receivedDate || '�'}</td>
                              <td className="px-4 py-2 text-white">{pallet.units}</td>
                              <td className="px-4 py-2 text-gray-300">{pallet.cartons}</td>
                              <td className="px-4 py-2">{pallet.scanned ? <span className="text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full">Scanned</span> : <span className="text-xs text-gray-500">Pending</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
              <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
                <div className="flex gap-6 text-xs">
                  <span className="text-gray-400">Pieces: <span className="text-white font-semibold">{allocations.reduce((s, a) => s + a.pallets.filter(p => p.selected).reduce((ss, p) => ss + p.units, 0), 0)}</span></span>
                  <span className="text-gray-400">Cartons: <span className="text-white font-semibold">{allocations.reduce((s, a) => s + a.pallets.filter(p => p.selected).reduce((ss, p) => ss + p.cartons, 0), 0)}</span></span>
                  <span className="text-gray-400">Pallets: <span className="text-white font-semibold">{allocations.reduce((s, a) => s + a.pallets.filter(p => p.selected).length, 0)}</span></span>
                  {scannedPallets.length > 0 && <span className="text-green-400">✓ {scannedPallets.length} scanned</span>}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowPickModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Close</button>
                  <button onClick={generatePickTicketPDF} className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg">
                    <FileText size={14} /> Generate PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showScanner && (
          <BarcodeScanner title="Scan Pallet to Confirm Pick" onScan={handlePickScan} onClose={() => setShowScanner(false)} />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="p-6">
      {openTabs.length > 0 && (
        <div className="flex items-center gap-1 mb-4 border-b border-gray-800 pb-0">
          <span className="text-xs text-gray-500 px-2">Open:</span>
          {openTabs.map(tab => (
            <div key={tab.id} onClick={() => switchTab(tab)}
              className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-b-2 border-transparent text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
              <Pencil size={10} />
              <span className="max-w-32 truncate">{tab.orderNumber} � {tab.clientName}</span>
              <button onClick={e => closeTab(e, tab.id)} className="text-gray-600 hover:text-red-400 ml-1"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Orders</h2>
          <p className="text-sm text-gray-500 mt-0.5">{orders.length} total orders</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkUpload(true)} className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            Bulk Upload
          </button>
        <button onClick={openNew} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus size={16} /> New Order
        </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[{ label: 'Pending', value: counts.pending, color: 'text-yellow-400' }, { label: 'Picking', value: counts.picking, color: 'text-blue-400' }, { label: 'Shipped', value: counts.shipped, color: 'text-green-400' }].map(card => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mb-4">
        <input type="text" placeholder="Search client or order #..." value={search} onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 w-64" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500">
          <option value="">All statuses</option>
          {Object.entries(statusConfig).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
        </select>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-800/50">
              {['#', 'Transaction ID', 'Create Date', 'Customer', 'Reference #', 'Ship To', 'SKUs', 'Pieces', 'Charges', 'Status'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-gray-400 font-medium text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12"><ShoppingCart size={32} className="text-gray-700 mx-auto mb-3" /><p className="text-gray-500 text-sm">No orders found</p></td></tr>
            ) : filtered.map((order, i) => {
              const status = statusConfig[order.status] || statusConfig.pending
              const StatusIcon = status.icon
              const isOpen = openTabs.find(t => t.id === order.id)
              return (
                <tr key={order.id} onClick={() => openTab(order)}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/10'} ${isOpen ? 'bg-blue-500/5' : ''}`}>
                  <td className="px-4 py-3 text-gray-500 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 text-blue-400 text-xs font-mono">{order.transactionId || "-"}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{order.orderDate || new Date(order.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-white font-medium">{order.clientName}</td>
                  <td className="px-4 py-3 text-blue-400 text-xs font-mono">{order.orderNumber || '�'}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs max-w-xs truncate">{order.shipTo?.company || order.shipTo?.address1 || '�'}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{order.items?.length || 0}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{order.totalUnits || 0}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">${Number(order.totalCharges || 0).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit ${status.color}`}>
                      <StatusIcon size={10} /> {status.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {showBulkUpload && (
        <BulkUpload type="orders" onClose={() => setShowBulkUpload(false)} onSuccess={fetchData} />
      )}
    </div>
  )
}
