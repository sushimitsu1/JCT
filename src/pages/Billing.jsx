import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, query, orderBy, where } from 'firebase/firestore'
import { db } from '../firebase'
import {
  DollarSign, FileText, Plus, X, Download,
  CheckCircle, RefreshCw, ChevronDown
} from 'lucide-react'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import BillingWizard from '../components/BillingWizard'

const months = ['January','February','March','April','May','June','July','August','September','October','November','December']

const generateInvoiceNumber = () => {
  const now = new Date()
  return `INV-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${Math.floor(Math.random()*9000)+1000}`
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500'

const categoryBadge = (cat) => {
  const map = {
    storage:        'bg-purple-500/10 text-purple-400 border-purple-500/20',
    receiving:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
    outbound:       'bg-orange-500/10 text-orange-400 border-orange-500/20',
    labeling:       'bg-pink-500/10 text-pink-400 border-pink-500/20',
    handling:       'bg-teal-500/10 text-teal-400 border-teal-500/20',
    freight_prepaid:'bg-sky-500/10 text-sky-400 border-sky-500/20',
    freight_3rd:    'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    special:        'bg-red-500/10 text-red-400 border-red-500/20',
    materials:      'bg-amber-500/10 text-amber-400 border-amber-500/20',
    manual:         'bg-gray-500/10 text-gray-400 border-gray-500/20',
  }
  return map[cat] || map.manual
}

export default function Billing() {
  const [invoices, setInvoices]         = useState([])
  const [clients, setClients]           = useState([])
  const [inventory, setInventory]       = useState([])
  const [catalogItems, setCatalogItems] = useState([])
  const [receipts, setReceipts]         = useState([])
  const [orders, setOrders]             = useState([])
  const [showModal, setShowModal]       = useState(false)
  const [selectedClient, setSelectedClient] = useState('')
  const [selectedMonth, setSelectedMonth]   = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear]     = useState(new Date().getFullYear())
  const [autoLines, setAutoLines]       = useState([])
  const [wizardLines, setWizardLines]   = useState([])
  const [invoiceTab, setInvoiceTab]     = useState('auto')  // 'auto' | 'wizard'
  const [loading, setLoading]           = useState(false)
  const [calculating, setCalculating]   = useState(false)
  const [expandedId, setExpandedId]     = useState(null)
  const [success, setSuccess]           = useState('')
  const [calcSummary, setCalcSummary]   = useState(null)

  const fetchData = async () => {
    const [invSnap, clientsSnap, invoicesSnap, catalogSnap, receiptsSnap, ordersSnap] =
      await Promise.all([
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'clients')),
        getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'items')),
        getDocs(collection(db, 'receipts')),
        getDocs(collection(db, 'orders')),
      ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setCatalogItems(catalogSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setReceipts(receiptsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setOrders(ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  // ─── BILLING ENGINE ──────────────────────────────────────────────
  const calculateBilling = async (clientId, month, year) => {
    if (!clientId) return
    setCalculating(true)
    const client = clients.find(c => c.id === clientId)
    if (!client) { setCalculating(false); return }

    const mon = month ?? selectedMonth
    const yr  = year  ?? selectedYear
    const lines = []
    const freeDays = Number(client.freeDays || 0)
    const splitDay = Number(client.splitPeriodDay || 15)

    // ── 1. STORAGE ───────────────────────────────────────────────
    const clientInventory = inventory.filter(i =>
      i.clientId === clientId && (i.status || 'available') === 'available'
    )

    const catalogBySku = {}
    catalogItems.filter(i => i.clientId === clientId)
      .forEach(item => { catalogBySku[item.sku] = item })

    const skuGroups = {}
    clientInventory.forEach(inv => {
      const sku = inv.sku
      if (!skuGroups[sku]) skuGroups[sku] = {
        sku, description: inv.description || '',
        pallets: 0, units: 0,
        catalogItem: catalogBySku[sku] || null,
        receivedDate: inv.receivedDate || inv.createdAt || null
      }
      skuGroups[sku].pallets += Number(inv.pallets || 1)
      skuGroups[sku].units   += Number(inv.qty || inv.units || inv.quantity || 0)
    })

    let skusWithCatalog = 0, skusWithoutCatalog = 0

    Object.values(skuGroups).forEach(group => {
      const catalog = group.catalogItem
      const useSkuRate = client.storageType === 'per_sku' && catalog?.storageRate
      let charge = 0, rate, qty, unit, rateType

      // Determine base rate — check split period
      const receivedDate = group.receivedDate ? new Date(group.receivedDate) : null
      const receivedDay  = receivedDate ? receivedDate.getDate() : null
      let usingSplit = false

      if (useSkuRate) {
        rateType = catalog.storageRateType || 'per_pallet'
        rate = Number(catalog.storageRate)
        skusWithCatalog++
        if (rateType === 'per_pallet') { qty = group.pallets; unit = 'pallet'; charge = group.pallets * rate }
        else if (rateType === 'per_unit') { qty = group.units; unit = 'unit'; charge = group.units * rate }
        else if (rateType === 'per_sqft') {
          const sqft = catalog.length && catalog.width ? (Number(catalog.length) * Number(catalog.width)) / 144 : 4
          qty = Math.ceil(group.pallets * sqft); unit = 'sq ft'; charge = qty * rate
        }
        if (catalog.minMonthlyCharge && charge < Number(catalog.minMonthlyCharge))
          charge = Number(catalog.minMonthlyCharge)
      } else {
        qty = group.pallets; unit = 'pallet'; rateType = 'per_pallet'
        // Split period logic
        if (client.splitRate1st && client.splitRate2nd && receivedDay) {
          usingSplit = true
          rate = receivedDay <= splitDay
            ? Number(client.splitRate1st)
            : Number(client.splitRate2nd)
        } else {
          rate = Number(client.billingRate || 25)
        }
        charge = group.pallets * rate
        skusWithoutCatalog++
      }

      // Free days: skip charge if within free days window
      if (freeDays > 0 && receivedDate) {
        const today = new Date()
        const daysSinceReceived = Math.floor((today - receivedDate) / (1000 * 60 * 60 * 24))
        if (daysSinceReceived < freeDays) {
          charge = 0
        }
      }

      const glCode = client.glStorage || ''
      lines.push({
        sku: group.sku,
        description: `Storage — ${group.sku}${group.description ? ` (${group.description})` : ''}${usingSplit ? ` [Split ${receivedDay <= splitDay ? '1st' : '2nd'} half]` : ''} — ${months[mon]} ${yr}`,
        quantity: qty, unit, rate,
        amount: Number(charge.toFixed(2)),
        rateType, pallets: group.pallets, units: group.units,
        category: 'storage', glCode
      })
    })

    // ── 2. RECEIVING FEES ────────────────────────────────────────
    if (client.chargeReceivingFee && client.receivingFeeRate) {
      const feeRate = Number(client.receivingFeeRate)
      const feeType = client.receivingFeeType || 'per_pallet'
      const monthReceipts = receipts.filter(r => {
        if (r.clientId !== clientId) return false
        const d = new Date(r.receivedDate || r.createdAt)
        return d.getMonth() === mon && d.getFullYear() === yr
      })
      if (monthReceipts.length > 0) {
        let recQty = 0, recUnit = ''
        if (feeType === 'per_receipt')   { recQty = monthReceipts.length; recUnit = 'receipt' }
        else if (feeType === 'per_pallet') { recQty = monthReceipts.reduce((s, r) => s + Number(r.totalPallets || 0), 0); recUnit = 'pallet' }
        else if (feeType === 'per_unit')   { recQty = monthReceipts.reduce((s, r) => s + Number(r.totalUnits || 0), 0); recUnit = 'unit' }
        if (recQty > 0) {
          lines.push({
            description: `Receiving — ${months[mon]} ${yr} (${monthReceipts.length} receipt${monthReceipts.length > 1 ? 's' : ''})`,
            quantity: recQty, unit: recUnit, rate: feeRate,
            amount: Number((recQty * feeRate).toFixed(2)),
            category: 'receiving', glCode: client.glReceiving || ''
          })
        }
      }
    }

    // ── 3. OUTBOUND FEES ─────────────────────────────────────────
    if (client.chargeOutboundFee && client.outboundFeeRate) {
      const feeRate = Number(client.outboundFeeRate)
      const feeType = client.outboundFeeType || 'per_pallet'
      const monthOrders = orders.filter(o => {
        if (o.clientId !== clientId || o.status !== 'shipped') return false
        const d = new Date(o.shippedDate || o.updatedAt || o.createdAt)
        return d.getMonth() === mon && d.getFullYear() === yr
      })
      if (monthOrders.length > 0) {
        let outQty = 0, outUnit = ''
        if (feeType === 'per_order') { outQty = monthOrders.length; outUnit = 'order' }
        else if (feeType === 'per_pallet') {
          outQty = monthOrders.reduce((s, o) => s + (o.lineItems?.reduce((ps, l) => ps + Number(l.pallets || 1), 0) || 0), 0)
          outUnit = 'pallet'
        } else if (feeType === 'per_unit') {
          outQty = monthOrders.reduce((s, o) => s + (o.lineItems?.reduce((us, l) => us + Number(l.quantity || l.qty || 0), 0) || 0), 0)
          outUnit = 'unit'
        }
        if (outQty > 0) {
          lines.push({
            description: `Outbound handling — ${months[mon]} ${yr} (${monthOrders.length} order${monthOrders.length > 1 ? 's' : ''})`,
            quantity: outQty, unit: outUnit, rate: feeRate,
            amount: Number((outQty * feeRate).toFixed(2)),
            category: 'outbound', glCode: client.glOutbound || ''
          })
        }
      }
    }

    setCalcSummary({
      totalPallets: clientInventory.reduce((s, i) => s + Number(i.pallets || 1), 0),
      skusWithCatalog, skusWithoutCatalog,
      skuCount: Object.keys(skuGroups).length,
      freeDays, hasSplit: !!(client.splitRate1st && client.splitRate2nd)
    })

    setAutoLines(lines)
    setCalculating(false)
  }

  const handleClientChange = async (clientId) => {
    setSelectedClient(clientId)
    setCalcSummary(null); setAutoLines([]); setWizardLines([])
    if (clientId) await calculateBilling(clientId, selectedMonth, selectedYear)
  }

  const updateAutoLine = (i, field, value) => {
    const items = [...autoLines]
    items[i] = { ...items[i], [field]: value }
    if (field === 'quantity' || field === 'rate')
      items[i].amount = Number((Number(items[i].quantity || 0) * Number(items[i].rate || 0)).toFixed(2))
    if (field === 'amount') items[i].amount = Number(value)
    setAutoLines(items)
  }

  const removeAutoLine = (i) => setAutoLines(autoLines.filter((_, idx) => idx !== i))
  const addAutoLine = () => setAutoLines([...autoLines, { description: '', quantity: 1, unit: '', rate: 0, amount: 0, category: 'manual', glCode: '' }])

  const allLines = [...autoLines, ...wizardLines]
  const total = allLines.reduce((s, l) => s + Number(l.amount || 0), 0)

  // ─── SAVE INVOICE ────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedClient || allLines.length === 0) return
    setLoading(true); setSuccess('')
    const client = clients.find(c => c.id === selectedClient)
    const invoiceNumber = generateInvoiceNumber()
    try {
      const invoiceData = {
        invoiceNumber,
        clientId: selectedClient,
        clientName: client?.companyName,
        clientEmail: client?.email || '',
        clientPhone: client?.phone || '',
        month: selectedMonth, year: selectedYear,
        period: `${months[selectedMonth]} ${selectedYear}`,
        lineItems: allLines, total,
        status: 'pending',
        createdAt: new Date().toISOString()
      }
      await addDoc(collection(db, 'invoices'), invoiceData)
      setSuccess(`Invoice ${invoiceNumber} saved for ${client?.companyName}`)
      setShowModal(false); setSelectedClient(''); setAutoLines([]); setWizardLines([]); setCalcSummary(null)
      fetchData()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const markAsPaid = async (e, id) => {
    e.stopPropagation()
    await updateDoc(doc(db, 'invoices', id), { status: 'paid', paidAt: new Date().toISOString() })
    fetchData()
  }

  // ─── PDF EXPORT ──────────────────────────────────────────────────
  const exportPDF = (invoice) => {
    const pdf = new jsPDF()
    const pw = pdf.internal.pageSize.getWidth()
    pdf.setFillColor(17,24,39); pdf.rect(0,0,pw,45,'F')
    pdf.setTextColor(255,255,255); pdf.setFontSize(20); pdf.setFont('helvetica','bold')
    pdf.text('JCT Logistics',14,20)
    pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(156,163,175)
    pdf.text('Warehouse Management & 3PL Services',14,28)
    pdf.text('Ontario, California',14,35)
    pdf.setTextColor(255,255,255); pdf.setFontSize(22); pdf.setFont('helvetica','bold')
    pdf.text('INVOICE',pw-14,20,{align:'right'})
    pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(156,163,175)
    pdf.text(invoice.invoiceNumber||'',pw-14,28,{align:'right'})
    pdf.text(`Period: ${invoice.period}`,pw-14,35,{align:'right'})
    pdf.setTextColor(17,24,39); pdf.setFontSize(9); pdf.setFont('helvetica','bold')
    pdf.text('BILL TO',14,58)
    pdf.setFont('helvetica','normal'); pdf.setFontSize(11); pdf.setTextColor(17,24,39)
    pdf.text(invoice.clientName||'',14,66)
    pdf.setFontSize(9); pdf.setTextColor(75,85,99)
    if(invoice.clientEmail) pdf.text(invoice.clientEmail,14,73)
    if(invoice.clientPhone) pdf.text(invoice.clientPhone,14,79)
    pdf.setFillColor(249,250,251); pdf.roundedRect(pw-80,52,66,32,2,2,'F')
    pdf.setFontSize(8); pdf.setTextColor(107,114,128)
    pdf.text('Invoice Date',pw-76,60); pdf.text('Status',pw-76,70); pdf.text('Due Date',pw-76,80)
    pdf.setTextColor(17,24,39); pdf.setFont('helvetica','bold')
    pdf.text(new Date().toLocaleDateString(),pw-30,60,{align:'right'})
    pdf.text(invoice.status?.toUpperCase()||'PENDING',pw-30,70,{align:'right'})
    pdf.text('Upon Receipt',pw-30,80,{align:'right'})
    let y=96
    pdf.setFillColor(17,24,39); pdf.rect(14,y,pw-28,8,'F')
    pdf.setTextColor(255,255,255); pdf.setFontSize(8); pdf.setFont('helvetica','bold')
    pdf.text('Description',17,y+5.5); pdf.text('Qty',108,y+5.5); pdf.text('Unit',120,y+5.5)
    pdf.text('Rate',135,y+5.5); pdf.text('GL',152,y+5.5); pdf.text('Amount',pw-17,y+5.5,{align:'right'})
    y+=8
    invoice.lineItems?.forEach((item,i)=>{
      if(i%2===0){pdf.setFillColor(249,250,251);pdf.rect(14,y,pw-28,8,'F')}
      pdf.setTextColor(55,65,81); pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5)
      pdf.text(String(item.description||'').substring(0,50),17,y+5.5)
      pdf.text(String(item.quantity||''),108,y+5.5)
      pdf.text(String(item.unit||''),120,y+5.5)
      pdf.text(`$${Number(item.rate).toFixed(2)}`,135,y+5.5)
      pdf.text(String(item.glCode||''),152,y+5.5)
      pdf.text(`$${Number(item.amount).toFixed(2)}`,pw-17,y+5.5,{align:'right'})
      y+=8
    })
    y+=6
    pdf.setFillColor(17,24,39); pdf.roundedRect(pw-80,y,66,18,2,2,'F')
    pdf.setTextColor(156,163,175); pdf.setFontSize(8); pdf.setFont('helvetica','normal')
    pdf.text('TOTAL DUE',pw-76,y+7)
    pdf.setTextColor(255,255,255); pdf.setFontSize(13); pdf.setFont('helvetica','bold')
    pdf.text(`$${Number(invoice.total).toLocaleString('en-US',{minimumFractionDigits:2})}`,pw-16,y+12,{align:'right'})
    const fy=pdf.internal.pageSize.getHeight()-16
    pdf.setDrawColor(229,231,235); pdf.line(14,fy-4,pw-14,fy-4)
    pdf.setFontSize(8); pdf.setFont('helvetica','normal'); pdf.setTextColor(156,163,175)
    pdf.text('Thank you for your business.',pw/2,fy,{align:'center'})
    pdf.save(`${invoice.invoiceNumber}_${invoice.clientName}_${invoice.period}.pdf`)
  }

  const exportExcel = (invoice) => {
    const rows = invoice.lineItems.map(item => ({
      Category: item.category||'',
      'GL Account': item.glCode||'',
      Description: item.description,
      Quantity: item.quantity,
      Unit: item.unit,
      'Rate ($)': item.rate,
      'Amount ($)': item.amount
    }))
    rows.push({ Description: 'TOTAL', 'Amount ($)': invoice.total })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice')
    XLSX.writeFile(wb, `${invoice.invoiceNumber}_${invoice.clientName}_${invoice.period}.xlsx`)
  }

  const totalRevenue = invoices.reduce((s,i) => s + Number(i.total||0), 0)
  const pendingCount = invoices.filter(i => i.status==='pending').length
  const paidCount    = invoices.filter(i => i.status==='paid').length
  const selectedClientObj = clients.find(c => c.id === selectedClient)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.length} invoices · {pendingCount} pending</p>
        </div>
        <button onClick={() => { setShowModal(true); setSelectedClient(''); setAutoLines([]); setWizardLines([]); setSuccess(''); setCalcSummary(null); setInvoiceTab('auto') }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus size={16}/> New Invoice
        </button>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle size={16}/> {success}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Invoiced', value: `$${totalRevenue.toLocaleString()}`, color: 'text-white' },
          { label: 'Pending',        value: pendingCount,  color: 'text-yellow-400' },
          { label: 'Paid',           value: paidCount,     color: 'text-green-400' },
          { label: 'Active Clients', value: clients.length, color: 'text-white' },
        ].map(card => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Invoice list */}
      <div className="space-y-3">
        {invoices.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <FileText size={32} className="text-gray-600 mx-auto mb-3"/>
            <p className="text-gray-500 text-sm">No invoices yet — click New Invoice to generate one</p>
          </div>
        ) : invoices.map(inv => (
          <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
              onClick={() => setExpandedId(expandedId===inv.id ? null : inv.id)}>
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 bg-green-600/10 border border-green-600/20 rounded-lg flex items-center justify-center">
                  <DollarSign size={16} className="text-green-400"/>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{inv.clientName}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{inv.invoiceNumber||''}{inv.invoiceNumber?' · ':''}{inv.period} · {inv.lineItems?.length} line items</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${inv.status==='paid' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}`}>{inv.status}</span>
                <p className="text-white font-semibold text-sm">${Number(inv.total).toLocaleString()}</p>
                {inv.status==='pending' && (
                  <button onClick={e => markAsPaid(e,inv.id)}
                    className="text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 px-2 py-1 rounded transition-colors flex items-center gap-1">
                    <CheckCircle size={11}/> Mark Paid
                  </button>
                )}
                <button onClick={e=>{e.stopPropagation();exportPDF(inv)}} className="text-gray-400 hover:text-red-400 p-1" title="PDF"><FileText size={15}/></button>
                <button onClick={e=>{e.stopPropagation();exportExcel(inv)}} className="text-gray-400 hover:text-green-400 p-1" title="Excel"><Download size={15}/></button>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedId===inv.id?'rotate-180':''}`}/>
              </div>
            </div>
            {expandedId===inv.id && (
              <div className="border-t border-gray-800 px-5 py-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left pb-2 font-medium">Category</th>
                      <th className="text-left pb-2 font-medium">GL</th>
                      <th className="text-left pb-2 font-medium">Description</th>
                      <th className="text-left pb-2 font-medium">Qty</th>
                      <th className="text-left pb-2 font-medium">Unit</th>
                      <th className="text-left pb-2 font-medium">Rate</th>
                      <th className="text-right pb-2 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {inv.lineItems?.map((item,i) => (
                      <tr key={i}>
                        <td className="py-2"><span className={`text-xs px-2 py-0.5 rounded-full border ${categoryBadge(item.category)}`}>{item.category||'other'}</span></td>
                        <td className="py-2 text-yellow-400 font-mono text-xs">{item.glCode||'—'}</td>
                        <td className="py-2 text-gray-300 text-xs">{item.description}</td>
                        <td className="py-2 text-gray-300">{item.quantity}</td>
                        <td className="py-2 text-gray-400">{item.unit}</td>
                        <td className="py-2 text-gray-400">${item.rate}</td>
                        <td className="py-2 text-white text-right font-medium">${Number(item.amount).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700">
                      <td colSpan={6} className="pt-3 text-gray-400 text-xs font-medium">TOTAL</td>
                      <td className="pt-3 text-white font-semibold text-right">${Number(inv.total).toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
                {inv.paidAt && <p className="text-green-400 text-xs mt-3">Paid on {new Date(inv.paidAt).toLocaleDateString()}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ─── INVOICE MODAL ─── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-4xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">New Invoice</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={18}/></button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Client + Period */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                  <select value={selectedClient} onChange={e => handleClientChange(e.target.value)} className={inputCls}>
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Month</label>
                  <select value={selectedMonth}
                    onChange={e => { setSelectedMonth(Number(e.target.value)); setAutoLines([]); setCalcSummary(null) }}
                    className={inputCls}>
                    {months.map((m,i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Year</label>
                  <input type="number" value={selectedYear}
                    onChange={e => { setSelectedYear(Number(e.target.value)); setAutoLines([]); setCalcSummary(null) }}
                    className={inputCls}/>
                </div>
              </div>

              {/* Client billing profile summary */}
              {selectedClientObj && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-3 grid grid-cols-5 gap-3 text-xs">
                  <div>
                    <p className="text-gray-500 mb-0.5">Storage</p>
                    <p className="text-white font-medium">
                      {selectedClientObj.storageType === 'per_sku' ? 'Per SKU' : `$${selectedClientObj.billingRate||'—'}/pallet`}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">Free Days</p>
                    <p className="text-white font-medium">{selectedClientObj.freeDays || '0'} days</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">Split Period</p>
                    <p className="text-white font-medium">
                      {selectedClientObj.splitRate1st
                        ? `Day ${selectedClientObj.splitPeriodDay}: $${selectedClientObj.splitRate1st}/$${selectedClientObj.splitRate2nd}`
                        : 'None'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">Receiving</p>
                    <p className="text-white font-medium">
                      {selectedClientObj.chargeReceivingFee ? `$${selectedClientObj.receivingFeeRate}/${selectedClientObj.receivingFeeType?.replace('per_','')}` : 'None'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">Outbound</p>
                    <p className="text-white font-medium">
                      {selectedClientObj.chargeOutboundFee ? `$${selectedClientObj.outboundFeeRate}/${selectedClientObj.outboundFeeType?.replace('per_','')}` : 'None'}
                    </p>
                  </div>
                </div>
              )}

              {/* Invoice tabs */}
              {selectedClient && (
                <div className="flex gap-0 border-b border-gray-800">
                  {[['auto','Auto-Calculate'],['wizard','Billing Wizard']].map(([id,label]) => (
                    <button key={id} onClick={() => setInvoiceTab(id)}
                      className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                        invoiceTab===id ? 'text-blue-400 border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'
                      }`}>
                      {label}
                      {id==='auto' && autoLines.length > 0 && (
                        <span className="ml-2 text-xs text-green-400">${autoLines.reduce((s,l)=>s+Number(l.amount||0),0).toFixed(0)}</span>
                      )}
                      {id==='wizard' && wizardLines.length > 0 && (
                        <span className="ml-2 text-xs text-green-400">${wizardLines.reduce((s,l)=>s+Number(l.amount||0),0).toFixed(0)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* AUTO-CALCULATE TAB */}
              {invoiceTab === 'auto' && (
                <>
                  {calcSummary && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 flex items-center justify-between">
                      <div className="text-xs text-blue-400 space-x-3">
                        <span className="font-medium">{calcSummary.totalPallets} pallets</span>
                        <span>· {calcSummary.skuCount} SKUs</span>
                        {calcSummary.freeDays > 0 && <span className="text-yellow-400">· {calcSummary.freeDays} free days applied</span>}
                        {calcSummary.hasSplit && <span className="text-purple-400">· Split period active</span>}
                        {calcSummary.skusWithCatalog > 0 && <span className="text-green-400">· {calcSummary.skusWithCatalog} from catalog</span>}
                        {calcSummary.skusWithoutCatalog > 0 && <span className="text-orange-400">· {calcSummary.skusWithoutCatalog} default rate</span>}
                      </div>
                      <button onClick={() => calculateBilling(selectedClient, selectedMonth, selectedYear)}
                        className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-xs">
                        <RefreshCw size={12}/> Recalculate
                      </button>
                    </div>
                  )}

                  {calculating && (
                    <div className="text-center py-4 text-gray-400 text-sm flex items-center justify-center gap-2">
                      <RefreshCw size={14} className="animate-spin"/> Calculating from live inventory & orders...
                    </div>
                  )}

                  {autoLines.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-gray-400 text-xs">Auto-calculated lines <span className="text-gray-600">(editable)</span></label>
                        <button onClick={addAutoLine} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                          <Plus size={12}/> Add line
                        </button>
                      </div>
                      <div className="grid grid-cols-12 gap-2 mb-1 px-1 text-gray-500 text-xs">
                        <div className="col-span-4">Description</div>
                        <div className="col-span-1">Qty</div>
                        <div className="col-span-1">Unit</div>
                        <div className="col-span-2">Rate ($)</div>
                        <div className="col-span-1">GL</div>
                        <div className="col-span-2">Amount</div>
                        <div className="col-span-1"></div>
                      </div>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {autoLines.map((item,i) => (
                          <div key={i} className={`grid grid-cols-12 gap-2 items-center rounded-lg px-2 py-1.5 border ${
                            item.category==='storage'   ? 'bg-purple-500/5 border-purple-500/10' :
                            item.category==='receiving' ? 'bg-blue-500/5 border-blue-500/10' :
                            item.category==='outbound'  ? 'bg-orange-500/5 border-orange-500/10' :
                            'bg-gray-800/30 border-transparent'
                          }`}>
                            <input value={item.description} onChange={e=>updateAutoLine(i,'description',e.target.value)}
                              className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"/>
                            <input type="number" value={item.quantity} onChange={e=>updateAutoLine(i,'quantity',e.target.value)}
                              className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"/>
                            <input value={item.unit} onChange={e=>updateAutoLine(i,'unit',e.target.value)}
                              className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"/>
                            <input type="number" value={item.rate} onChange={e=>updateAutoLine(i,'rate',e.target.value)}
                              className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"/>
                            <input value={item.glCode||''} onChange={e=>updateAutoLine(i,'glCode',e.target.value)}
                              className="col-span-1 bg-gray-800 border border-gray-700 text-yellow-400 font-mono rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" placeholder="GL#"/>
                            <div className="col-span-2 text-white text-xs font-medium pr-1">${Number(item.amount).toFixed(2)}</div>
                            <button onClick={()=>removeAutoLine(i)} className="col-span-1 text-gray-600 hover:text-red-400 flex justify-center"><X size={13}/></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!selectedClient && (
                    <p className="text-gray-500 text-sm text-center py-6">Select a client to auto-calculate billing</p>
                  )}
                </>
              )}

              {/* BILLING WIZARD TAB */}
              {invoiceTab === 'wizard' && selectedClient && (
                <BillingWizard
                  client={selectedClientObj}
                  wizardLines={wizardLines}
                  setWizardLines={setWizardLines}
                  month={selectedMonth}
                  year={selectedYear}
                />
              )}

              {/* Combined total */}
              {allLines.length > 0 && (
                <div className="flex justify-between items-center pt-3 border-t border-gray-800">
                  <div className="text-xs text-gray-500 space-x-3">
                    {autoLines.length > 0 && <span>Auto: <span className="text-white">${autoLines.reduce((s,l)=>s+Number(l.amount||0),0).toFixed(2)}</span></span>}
                    {wizardLines.length > 0 && <span>Wizard: <span className="text-white">${wizardLines.reduce((s,l)=>s+Number(l.amount||0),0).toFixed(2)}</span></span>}
                    <span className="text-gray-600">{allLines.length} total lines</span>
                  </div>
                  <p className="text-white font-semibold text-base">
                    Invoice Total: ${total.toLocaleString('en-US',{minimumFractionDigits:2})}
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={loading || !selectedClient || allLines.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                {loading ? 'Saving...' : 'Save Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}