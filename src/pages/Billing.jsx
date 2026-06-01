import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, query, orderBy, where } from 'firebase/firestore'
import { db } from '../firebase'
import { DollarSign, FileText, Plus, X, Download, CheckCircle, RefreshCw, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import { sendInvoiceEmail } from '../email'

const months = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

const generateInvoiceNumber = () => {
  const now = new Date()
  return `INV-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${Math.floor(Math.random()*9000)+1000}`
}

const RATE_TYPE_LABELS = {
  per_pallet:  'pallet',
  per_unit:    'unit',
  per_sqft:    'sq ft',
  per_receipt: 'receipt',
}

export default function Billing() {
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [inventory, setInventory] = useState([])
  const [catalogItems, setCatalogItems] = useState([])
  const [receipts, setReceipts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [selectedClient, setSelectedClient] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [success, setSuccess] = useState('')
  const [calcSummary, setCalcSummary] = useState(null)

  const fetchData = async () => {
    const [invSnap, clientsSnap, invoicesSnap, catalogSnap, receiptsSnap] = await Promise.all([
      getDocs(collection(db, 'inventory')),
      getDocs(collection(db, 'clients')),
      getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'items')),
      getDocs(collection(db, 'receipts'))
    ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setCatalogItems(catalogSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setReceipts(receiptsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  // ─── BILLING ENGINE ───────────────────────────────────────────────
  const calculateBilling = async (clientId) => {
    if (!clientId) return
    setCalculating(true)

    const client = clients.find(c => c.id === clientId)
    if (!client) return

    // 1. Get available inventory for this client
    const clientInventory = inventory.filter(i =>
      i.clientId === clientId && (i.status || 'available') === 'available'
    )

    // 2. Get SKU catalog for this client
    const clientCatalog = catalogItems.filter(i => i.clientId === clientId)
    const catalogBySku = {}
    clientCatalog.forEach(item => { catalogBySku[item.sku] = item })

    // 3. Group inventory by SKU
    const skuGroups = {}
    clientInventory.forEach(inv => {
      const sku = inv.sku
      if (!skuGroups[sku]) {
        skuGroups[sku] = {
          sku,
          description: inv.description || '',
          pallets: 0,
          units: 0,
          catalogItem: catalogBySku[sku] || null
        }
      }
      skuGroups[sku].pallets += 1
      skuGroups[sku].units += Number(inv.units || inv.quantity || 0)
    })

    // 4. Calculate storage charge per SKU
    const lines = []
    let skusWithCatalog = 0
    let skusWithoutCatalog = 0

    Object.values(skuGroups).forEach(group => {
      const catalog = group.catalogItem
      let charge = 0
      let rateType = 'per_pallet'
      let rate = Number(client.billingRate || 25)
      let qty = group.pallets
      let unit = 'pallet'
      let usedCatalog = false

      if (catalog && catalog.storageRate) {
        rateType = catalog.storageRateType || 'per_pallet'
        rate = Number(catalog.storageRate)
        usedCatalog = true
        skusWithCatalog++

        if (rateType === 'per_pallet') {
          qty = group.pallets
          unit = 'pallet'
          charge = group.pallets * rate
        } else if (rateType === 'per_unit') {
          qty = group.units
          unit = 'unit'
          charge = group.units * rate
        } else if (rateType === 'per_sqft') {
          // Calculate sqft from dimensions if available
          const sqft = catalog.length && catalog.width
            ? (Number(catalog.length) * Number(catalog.width)) / 144
            : 4 // default 4 sqft per pallet
          qty = Math.ceil(group.pallets * sqft)
          unit = 'sq ft'
          charge = qty * rate
        }

        // Apply minimum monthly charge
        if (catalog.minMonthlyCharge && charge < Number(catalog.minMonthlyCharge)) {
          charge = Number(catalog.minMonthlyCharge)
        }
      } else {
        // Fallback to client default rate (per pallet)
        qty = group.pallets
        charge = group.pallets * rate
        skusWithoutCatalog++
      }

      lines.push({
        sku: group.sku,
        description: `Storage — ${group.sku}${group.description ? ` (${group.description})` : ''} — ${months[selectedMonth]} ${selectedYear}`,
        quantity: qty,
        unit,
        rate,
        amount: Number(charge.toFixed(2)),
        rateType,
        pallets: group.pallets,
        units: group.units,
        usedCatalog,
        isStorage: true
      })
    })

    // 5. Add receiving fees if enabled for this client
    if (client.chargeReceivingFee && client.receivingFeeRate) {
      const feeRate = Number(client.receivingFeeRate)
      const feeType = client.receivingFeeType || 'per_pallet'

      // Get receipts for this client in the selected month/year
      const monthReceipts = receipts.filter(r => {
        if (r.clientId !== clientId) return false
        const d = new Date(r.receivedDate || r.createdAt)
        return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear
      })

      if (monthReceipts.length > 0) {
        let recQty = 0
        let recUnit = ''

        if (feeType === 'per_receipt') {
          recQty = monthReceipts.length
          recUnit = 'receipt'
        } else if (feeType === 'per_pallet') {
          recQty = monthReceipts.reduce((sum, r) => sum + Number(r.totalPallets || 0), 0)
          recUnit = 'pallet'
        } else if (feeType === 'per_unit') {
          recQty = monthReceipts.reduce((sum, r) => sum + Number(r.totalUnits || 0), 0)
          recUnit = 'unit'
        }

        if (recQty > 0) {
          lines.push({
            description: `Receiving fee — ${months[selectedMonth]} ${selectedYear} (${monthReceipts.length} receipt${monthReceipts.length > 1 ? 's' : ''})`,
            quantity: recQty,
            unit: recUnit,
            rate: feeRate,
            amount: Number((recQty * feeRate).toFixed(2)),
            isReceiving: true
          })
        }
      }
    }

    setCalcSummary({
      totalPallets: clientInventory.length,
      skusWithCatalog,
      skusWithoutCatalog,
      skuCount: Object.keys(skuGroups).length
    })

    setLineItems(lines)
    setCalculating(false)
  }

  const handleClientChange = async (clientId) => {
    setSelectedClient(clientId)
    setCalcSummary(null)
    setLineItems([])
    if (clientId) await calculateBilling(clientId)
  }

  const updateLineItem = (i, field, value) => {
    const items = [...lineItems]
    items[i] = { ...items[i], [field]: value }
    if (field === 'quantity' || field === 'rate') {
      items[i].amount = Number((Number(items[i].quantity || 0) * Number(items[i].rate || 0)).toFixed(2))
    }
    if (field === 'amount') items[i].amount = Number(value)
    setLineItems(items)
  }

  const addLineItem = () => setLineItems([...lineItems, {
    description: '', quantity: 1, unit: '', rate: 0, amount: 0
  }])
  const removeLineItem = (i) => setLineItems(lineItems.filter((_, idx) => idx !== i))
  const total = lineItems.reduce((sum, i) => sum + Number(i.amount || 0), 0)

  // ─── SAVE INVOICE ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedClient) return
    setLoading(true)
    setSuccess('')
    const client = clients.find(c => c.id === selectedClient)
    const invoiceNumber = generateInvoiceNumber()
    try {
      const invoiceData = {
        invoiceNumber,
        clientId: selectedClient,
        clientName: client?.companyName,
        clientEmail: client?.email || '',
        clientPhone: client?.phone || '',
        month: selectedMonth,
        year: selectedYear,
        period: `${months[selectedMonth]} ${selectedYear}`,
        lineItems,
        total,
        status: 'pending',
        createdAt: new Date().toISOString()
      }
      await addDoc(collection(db, 'invoices'), invoiceData)
      if (client?.email) {
        const sent = await sendInvoiceEmail(invoiceData)
        setSuccess(sent
          ? `Invoice saved and emailed to ${client.email}`
          : 'Invoice saved — email could not be sent'
        )
      } else {
        setSuccess('Invoice saved — no email on file for this client')
      }
      setShowModal(false)
      setSelectedClient('')
      setLineItems([])
      setCalcSummary(null)
      fetchData()
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  // ─── MARK AS PAID ─────────────────────────────────────────────────
  const markAsPaid = async (e, id) => {
    e.stopPropagation()
    await updateDoc(doc(db, 'invoices', id), {
      status: 'paid',
      paidAt: new Date().toISOString()
    })
    fetchData()
  }

  // ─── PDF EXPORT ───────────────────────────────────────────────────
  const exportPDF = (invoice) => {
    const pdf = new jsPDF()
    const pageWidth = pdf.internal.pageSize.getWidth()

    pdf.setFillColor(17, 24, 39)
    pdf.rect(0, 0, pageWidth, 45, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(20)
    pdf.setFont('helvetica', 'bold')
    pdf.text('JCT Logistics', 14, 20)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(156, 163, 175)
    pdf.text('Warehouse Management & 3PL Services', 14, 28)
    pdf.text('Ontario, California', 14, 35)
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(22)
    pdf.setFont('helvetica', 'bold')
    pdf.text('INVOICE', pageWidth - 14, 20, { align: 'right' })
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(156, 163, 175)
    pdf.text(invoice.invoiceNumber || '', pageWidth - 14, 28, { align: 'right' })
    pdf.text(`Period: ${invoice.period}`, pageWidth - 14, 35, { align: 'right' })

    pdf.setTextColor(17, 24, 39)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'bold')
    pdf.text('BILL TO', 14, 58)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.setTextColor(17, 24, 39)
    pdf.text(invoice.clientName || '', 14, 66)
    pdf.setFontSize(9)
    pdf.setTextColor(75, 85, 99)
    if (invoice.clientEmail) pdf.text(invoice.clientEmail, 14, 73)
    if (invoice.clientPhone) pdf.text(invoice.clientPhone, 14, 79)

    pdf.setFillColor(249, 250, 251)
    pdf.roundedRect(pageWidth - 80, 52, 66, 32, 2, 2, 'F')
    pdf.setFontSize(8)
    pdf.setTextColor(107, 114, 128)
    pdf.text('Invoice Date', pageWidth - 76, 60)
    pdf.text('Status', pageWidth - 76, 70)
    pdf.text('Due Date', pageWidth - 76, 80)
    pdf.setTextColor(17, 24, 39)
    pdf.setFont('helvetica', 'bold')
    pdf.text(new Date().toLocaleDateString(), pageWidth - 30, 60, { align: 'right' })
    pdf.text(invoice.status?.toUpperCase() || 'PENDING', pageWidth - 30, 70, { align: 'right' })
    pdf.text('Upon Receipt', pageWidth - 30, 80, { align: 'right' })

    let y = 96
    pdf.setFillColor(17, 24, 39)
    pdf.rect(14, y, pageWidth - 28, 8, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Description', 17, y + 5.5)
    pdf.text('Qty', 120, y + 5.5)
    pdf.text('Unit', 135, y + 5.5)
    pdf.text('Rate', 152, y + 5.5)
    pdf.text('Amount', pageWidth - 17, y + 5.5, { align: 'right' })
    y += 8

    invoice.lineItems?.forEach((item, i) => {
      if (i % 2 === 0) {
        pdf.setFillColor(249, 250, 251)
        pdf.rect(14, y, pageWidth - 28, 8, 'F')
      }
      pdf.setTextColor(55, 65, 81)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      const desc = String(item.description || '').substring(0, 55)
      pdf.text(desc, 17, y + 5.5)
      pdf.text(String(item.quantity || ''), 120, y + 5.5)
      pdf.text(String(item.unit || ''), 135, y + 5.5)
      pdf.text(`$${Number(item.rate).toFixed(2)}`, 152, y + 5.5)
      pdf.text(`$${Number(item.amount).toFixed(2)}`, pageWidth - 17, y + 5.5, { align: 'right' })
      y += 8
    })

    y += 6
    pdf.setFillColor(17, 24, 39)
    pdf.roundedRect(pageWidth - 80, y, 66, 18, 2, 2, 'F')
    pdf.setTextColor(156, 163, 175)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text('TOTAL DUE', pageWidth - 76, y + 7)
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(13)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`$${Number(invoice.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth - 16, y + 12, { align: 'right' })

    const footerY = pdf.internal.pageSize.getHeight() - 16
    pdf.setDrawColor(229, 231, 235)
    pdf.line(14, footerY - 4, pageWidth - 14, footerY - 4)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(156, 163, 175)
    pdf.text('Thank you for your business.', pageWidth / 2, footerY, { align: 'center' })
    pdf.save(`${invoice.invoiceNumber}_${invoice.clientName}_${invoice.period}.pdf`)
  }

  // ─── EXCEL EXPORT ─────────────────────────────────────────────────
  const exportExcel = (invoice) => {
    const rows = invoice.lineItems.map(item => ({
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

  const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
  const pendingCount = invoices.filter(i => i.status === 'pending').length
  const paidCount = invoices.filter(i => i.status === 'paid').length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.length} invoices · {pendingCount} pending</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setSelectedClient(''); setLineItems([]); setSuccess(''); setCalcSummary(null) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Invoice
        </button>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Invoiced', value: `$${totalRevenue.toLocaleString()}`, color: 'text-white' },
          { label: 'Pending',        value: pendingCount,                         color: 'text-yellow-400' },
          { label: 'Paid',           value: paidCount,                            color: 'text-green-400' },
          { label: 'Active Clients', value: clients.length,                       color: 'text-white' },
        ].map(card => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Invoices list */}
      <div className="space-y-3">
        {invoices.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <FileText size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No invoices yet — click New Invoice to generate one</p>
          </div>
        ) : invoices.map((inv) => (
          <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
              onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
            >
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 bg-green-600/10 border border-green-600/20 rounded-lg flex items-center justify-center">
                  <DollarSign size={16} className="text-green-400" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{inv.clientName}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {inv.invoiceNumber ? `${inv.invoiceNumber} · ` : ''}{inv.period} · {inv.lineItems?.length} line items
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  inv.status === 'paid'
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                }`}>
                  {inv.status}
                </span>
                <p className="text-white font-semibold text-sm">${Number(inv.total).toLocaleString()}</p>
                {inv.status === 'pending' && (
                  <button
                    onClick={e => markAsPaid(e, inv.id)}
                    className="text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 px-2 py-1 rounded transition-colors flex items-center gap-1"
                  >
                    <CheckCircle size={11} /> Mark Paid
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); exportPDF(inv) }} className="text-gray-400 hover:text-red-400 transition-colors p-1" title="PDF">
                  <FileText size={15} />
                </button>
                <button onClick={e => { e.stopPropagation(); exportExcel(inv) }} className="text-gray-400 hover:text-green-400 transition-colors p-1" title="Excel">
                  <Download size={15} />
                </button>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedId === inv.id ? 'rotate-180' : ''}`} />
              </div>
            </div>

            {expandedId === inv.id && (
              <div className="border-t border-gray-800 px-5 py-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left pb-2 font-medium">Description</th>
                      <th className="text-left pb-2 font-medium">Qty</th>
                      <th className="text-left pb-2 font-medium">Unit</th>
                      <th className="text-left pb-2 font-medium">Rate</th>
                      <th className="text-right pb-2 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {inv.lineItems?.map((item, i) => (
                      <tr key={i}>
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
                      <td colSpan={4} className="pt-3 text-gray-400 text-xs font-medium">TOTAL</td>
                      <td className="pt-3 text-white font-semibold text-right">${Number(inv.total).toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
                {inv.paidAt && (
                  <p className="text-green-400 text-xs mt-3">Paid on {new Date(inv.paidAt).toLocaleDateString()}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ─── Modal ─── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">New Invoice</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Client + Period */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                  <select
                    value={selectedClient}
                    onChange={e => handleClientChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Month</label>
                  <select
                    value={selectedMonth}
                    onChange={e => { setSelectedMonth(Number(e.target.value)); setLineItems([]); setCalcSummary(null) }}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Year</label>
                  <input
                    type="number"
                    value={selectedYear}
                    onChange={e => { setSelectedYear(Number(e.target.value)); setLineItems([]); setCalcSummary(null) }}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Calculation summary */}
              {calcSummary && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div className="text-xs text-blue-400">
                    <span className="font-medium">{calcSummary.totalPallets} pallets</span> · {calcSummary.skuCount} SKUs ·{' '}
                    <span className="text-green-400">{calcSummary.skusWithCatalog} from catalog</span>
                    {calcSummary.skusWithoutCatalog > 0 && (
                      <span className="text-yellow-400"> · {calcSummary.skusWithoutCatalog} using default rate</span>
                    )}
                  </div>
                  <button
                    onClick={() => calculateBilling(selectedClient)}
                    className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-xs"
                  >
                    <RefreshCw size={12} /> Recalculate
                  </button>
                </div>
              )}

              {/* Calculating spinner */}
              {calculating && (
                <div className="text-center py-4 text-gray-400 text-sm flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  Calculating billing from live inventory...
                </div>
              )}

              {/* Line items */}
              {lineItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-400 text-xs">Line Items <span className="text-gray-600">(editable before saving)</span></label>
                    <button onClick={addLineItem} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                      <Plus size={12} /> Add manual line
                    </button>
                  </div>

                  {/* Column headers */}
                  <div className="grid grid-cols-12 gap-2 mb-1 px-1 text-gray-500 text-xs">
                    <div className="col-span-5">Description</div>
                    <div className="col-span-2">Qty</div>
                    <div className="col-span-1">Unit</div>
                    <div className="col-span-2">Rate ($)</div>
                    <div className="col-span-1">Amount</div>
                    <div className="col-span-1"></div>
                  </div>

                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {lineItems.map((item, i) => (
                      <div key={i} className={`grid grid-cols-12 gap-2 items-center rounded-lg px-2 py-1.5 ${
                        item.isStorage ? 'bg-gray-800/30' :
                        item.isReceiving ? 'bg-blue-500/5 border border-blue-500/10' : ''
                      }`}>
                        <input
                          value={item.description}
                          onChange={e => updateLineItem(i, 'description', e.target.value)}
                          className="col-span-5 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => updateLineItem(i, 'quantity', e.target.value)}
                          className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                        <input
                          value={item.unit}
                          onChange={e => updateLineItem(i, 'unit', e.target.value)}
                          className="col-span-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                        <input
                          type="number"
                          value={item.rate}
                          onChange={e => updateLineItem(i, 'rate', e.target.value)}
                          className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                        <div className="col-span-1 text-white text-xs font-medium text-right pr-1">
                          ${Number(item.amount).toFixed(0)}
                        </div>
                        <button onClick={() => removeLineItem(i)} className="col-span-1 text-gray-600 hover:text-red-400 flex justify-center">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-800">
                    <p className="text-gray-500 text-xs">{lineItems.length} line items</p>
                    <p className="text-white font-semibold">Total: ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              )}

              {!selectedClient && (
                <p className="text-gray-500 text-sm text-center py-6">
                  Select a client — billing will auto-calculate from their live inventory and SKU catalog
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading || !selectedClient || lineItems.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : 'Save & Send Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}