import jsPDF from 'jspdf'
import * as XLSX from 'xlsx'

// ─── Internal helpers ───────────────────────────────────────
const fmtDate = (d) => {
  if (!d) return '-'
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString()
}
const fmtDateTime = (d) => {
  if (!d) return '-'
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? '-' : dt.toLocaleString()
}

const drawHeader = (pdf, title) => {
  const pw = pdf.internal.pageSize.getWidth()
  pdf.setFillColor(200, 16, 46); pdf.rect(0, 0, pw, 18, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.setFont('helvetica', 'bold')
  pdf.text(title, pw / 2, 12, { align: 'center' })
}

const drawSignatures = (pdf, labels = ['Received by', 'Checked by', 'Date']) => {
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const y = ph - 25
  pdf.setDrawColor(27, 42, 74)
  pdf.setTextColor(27, 42, 74)
  pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
  const w = (pw - 28) / labels.length
  labels.forEach((label, i) => {
    const x = 14 + i * w
    pdf.line(x, y, x + w - 10, y)
    pdf.text(label, x, y + 4)
  })
}

// ─── PDF: RECEIPT ────────────────────────────────────────────
const buildReceiptPDF = (txn, inventory) => {
  const r = txn.source || {}
  const palletDocs = inventory.filter(i => i.receiptId === txn.sourceId)
  const pdf = new jsPDF()
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()

  drawHeader(pdf, 'Receiving Report')

  pdf.setTextColor(200, 16, 46); pdf.setFontSize(13)
  pdf.text(txn.clientName || '', 14, 28)
  pdf.setFontSize(9); pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal')
  pdf.text('Warehouse: JCT LOGISTICS INC.', 14, 35)
  pdf.text(`Date: ${fmtDate(new Date())}`, 14, 41)

  pdf.setTextColor(200, 16, 46); pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
  pdf.text(`Transaction # : ${txn.refNumber}`, pw - 14, 28, { align: 'right' })
  pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  pdf.text(`Reference: ${r.referenceId || '-'}`, pw - 14, 35, { align: 'right' })
  pdf.text(`Arrival: ${r.arrivalDate ? fmtDate(r.arrivalDate) : '-'}`, pw - 14, 41, { align: 'right' })

  let y = 52
  pdf.setDrawColor(220, 220, 220); pdf.line(14, y - 2, pw - 14, y - 2)
  pdf.setFontSize(9); pdf.setTextColor(27, 42, 74)
  const totalUnits = palletDocs.reduce((s, p) => s + Number(p.units || 0), 0)
  pdf.text(`Total Pallets: ${palletDocs.length}`, 14, y + 4)
  pdf.text(`Total Units: ${totalUnits}`, 80, y + 4)
  pdf.text(`Status: ${(r.status || 'pending').toUpperCase()}`, pw - 14, y + 4, { align: 'right' })
  y += 12

  pdf.setFillColor(27, 42, 74); pdf.rect(14, y, pw - 28, 7, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
  pdf.text('PALLET', 17, y + 5)
  pdf.text('SKU', 55, y + 5)
  pdf.text('DESCRIPTION', 90, y + 5)
  pdf.text('UNITS', 140, y + 5)
  pdf.text('LOCATION', 158, y + 5)
  pdf.text('COND', pw - 18, y + 5, { align: 'right' })
  y += 11

  pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)

  const skuGroups = new Map()
  palletDocs.forEach(p => {
    const key = p.sku || '(no sku)'
    if (!skuGroups.has(key)) skuGroups.set(key, { sku: key, description: p.description || '', pallets: [] })
    skuGroups.get(key).pallets.push(p)
  })

  for (const group of skuGroups.values()) {
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
      pdf.setFont('helvetica', 'bold')
      pdf.text(String(p.units || 0), 140, y)
      pdf.setFont('helvetica', 'normal')
      pdf.text((p.location || '-').slice(0, 14), 158, y)
      pdf.text(p.condition || 'A', pw - 18, y, { align: 'right' })
      pdf.setDrawColor(235, 235, 235); pdf.line(14, y + 2, pw - 14, y + 2)
      y += 6
    }
    y += 2
  }

  drawSignatures(pdf, ['Received by', 'Checked by', 'Date'])
  return pdf
}

// ─── PDF: ORDER ──────────────────────────────────────────────
const buildOrderPDF = (txn) => {
  const o = txn.source || {}
  const pdf = new jsPDF()
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()

  drawHeader(pdf, 'Pick Ticket / Shipment Report')

  pdf.setTextColor(200, 16, 46); pdf.setFontSize(13)
  pdf.text(txn.clientName || '', 14, 28)
  pdf.setFontSize(9); pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal')
  pdf.text('Warehouse: JCT LOGISTICS INC.', 14, 35)
  pdf.text(`Picker: ${txn.picker || '-'}`, 14, 41)
  pdf.text(`Date: ${fmtDate(new Date())}`, 14, 47)

  pdf.setTextColor(200, 16, 46); pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
  pdf.text(`Order # : ${txn.refNumber}`, pw - 14, 28, { align: 'right' })
  pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  pdf.text(`Status: ${(txn.status || '').toUpperCase()}`, pw - 14, 35, { align: 'right' })
  if (o.shippedAt) pdf.text(`Shipped: ${fmtDateTime(o.shippedAt)}`, pw - 14, 41, { align: 'right' })
  if (o.carrier?.trackingNumber) pdf.text(`Tracking: ${o.carrier.trackingNumber}`, pw - 14, 47, { align: 'right' })

  let y = 58
  pdf.setDrawColor(220, 220, 220); pdf.line(14, y - 2, pw - 14, y - 2)
  pdf.setFontSize(9); pdf.setTextColor(27, 42, 74)
  pdf.text(`Total Pallets: ${txn.pallets}`, 14, y + 4)
  pdf.text(`Total Units: ${txn.units}`, 80, y + 4)
  pdf.text(`Charges: $${Number(txn.amount || 0).toFixed(2)}`, pw - 14, y + 4, { align: 'right' })
  y += 12

  pdf.setFillColor(27, 42, 74); pdf.rect(14, y, pw - 28, 7, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
  pdf.text('PALLET', 17, y + 5)
  pdf.text('SKU', 70, y + 5)
  pdf.text('UNITS', pw - 18, y + 5, { align: 'right' })
  y += 11

  pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  const allocs = o.inventoryAllocations || []
  for (const a of allocs) {
    if (y > ph - 25) { pdf.addPage(); y = 20 }
    pdf.text(a.palletId || '-', 17, y)
    pdf.text(a.sku || '-', 70, y)
    pdf.setFont('helvetica', 'bold')
    pdf.text(String(a.unitsAllocated || 0), pw - 18, y, { align: 'right' })
    pdf.setFont('helvetica', 'normal')
    pdf.setDrawColor(235, 235, 235); pdf.line(14, y + 2, pw - 14, y + 2)
    y += 6
  }

  drawSignatures(pdf, ['Picked by', 'Checked by', 'Shipped by', 'Date'])
  return pdf
}

// ─── PDF: INVOICE ────────────────────────────────────────────
const buildInvoicePDF = (txn) => {
  const inv = txn.source || {}
  const pdf = new jsPDF()
  const pw = pdf.internal.pageSize.getWidth()

  // Dark navy header
  pdf.setFillColor(17, 24, 39); pdf.rect(0, 0, pw, 45, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(20); pdf.setFont('helvetica', 'bold')
  pdf.text('JCT Logistics', 14, 20)
  pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(156, 163, 175)
  pdf.text('Warehouse Management & 3PL Services', 14, 28)
  pdf.text('Ontario, California', 14, 35)
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(22); pdf.setFont('helvetica', 'bold')
  pdf.text('INVOICE', pw - 14, 20, { align: 'right' })
  pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(156, 163, 175)
  pdf.text(txn.refNumber || '', pw - 14, 28, { align: 'right' })
  if (inv.period) pdf.text(`Period: ${inv.period}`, pw - 14, 35, { align: 'right' })

  // Bill-to
  let y = 58
  pdf.setTextColor(27, 42, 74); pdf.setFontSize(10); pdf.setFont('helvetica', 'bold')
  pdf.text('BILL TO', 14, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); y += 6
  pdf.text(txn.clientName || '', 14, y); y += 5
  if (inv.clientEmail) { pdf.text(inv.clientEmail, 14, y); y += 5 }
  if (inv.clientPhone) { pdf.text(inv.clientPhone, 14, y); y += 5 }

  // Date
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10)
  pdf.text('INVOICE DATE', pw - 14, 58, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.text(fmtDate(inv.createdAt || new Date()), pw - 14, 64, { align: 'right' })
  pdf.setFont('helvetica', 'bold')
  pdf.text('STATUS', pw - 14, 72, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.text((inv.status || 'pending').toUpperCase(), pw - 14, 78, { align: 'right' })

  // Line items
  y = Math.max(y, 88)
  pdf.setFillColor(27, 42, 74); pdf.rect(14, y, pw - 28, 7, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
  pdf.text('DESCRIPTION', 17, y + 5)
  pdf.text('QTY', 130, y + 5, { align: 'right' })
  pdf.text('RATE', 155, y + 5, { align: 'right' })
  pdf.text('AMOUNT', pw - 18, y + 5, { align: 'right' })
  y += 11

  pdf.setTextColor(27, 42, 74); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  const lineItems = inv.lineItems || []
  for (const li of lineItems) {
    pdf.text((li.description || li.label || '-').slice(0, 60), 17, y)
    pdf.text(String(li.qty ?? li.quantity ?? ''), 130, y, { align: 'right' })
    pdf.text(li.rate ? `$${Number(li.rate).toFixed(2)}` : '', 155, y, { align: 'right' })
    pdf.text(`$${Number(li.amount || 0).toFixed(2)}`, pw - 18, y, { align: 'right' })
    pdf.setDrawColor(235, 235, 235); pdf.line(14, y + 2, pw - 14, y + 2)
    y += 6
  }

  // Total
  y += 4
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
  pdf.text('TOTAL', 130, y, { align: 'right' })
  pdf.text(`$${Number(inv.total || 0).toFixed(2)}`, pw - 18, y, { align: 'right' })

  return pdf
}

// ─── Public API: PDF ────────────────────────────────────────
export function exportTxnPDF(txn, inventory = []) {
  let pdf
  let filename
  if (txn.type === 'receipt') {
    pdf = buildReceiptPDF(txn, inventory)
    filename = `Receipt-${txn.refNumber}.pdf`
  } else if (txn.type === 'order') {
    pdf = buildOrderPDF(txn)
    filename = `Order-${txn.refNumber}.pdf`
  } else if (txn.type === 'invoice') {
    pdf = buildInvoicePDF(txn)
    filename = `Invoice-${txn.refNumber}.pdf`
  } else {
    return
  }
  pdf.save(filename)
}

// ─── Public API: Excel ───────────────────────────────────────
export function exportTxnExcel(txn, inventory = []) {
  const wb = XLSX.utils.book_new()
  const src = txn.source || {}

  // Sheet 1: Header / summary
  const header = [
    ['JCT Logistics — ' + (txn.typeLabel || 'Transaction')],
    [],
    ['Reference', txn.refNumber],
    ['Type', txn.typeLabel],
    ['Date', fmtDate(txn.date)],
    ['Client', txn.clientName],
    ['Status', txn.status || ''],
  ]
  if (txn.type === 'receipt') {
    header.push(['Total pallets', txn.pallets])
    header.push(['Total units', txn.units])
    if (src.referenceId) header.push(['Reference (PO/etc)', src.referenceId])
    if (src.arrivalDate) header.push(['Arrival date', fmtDate(src.arrivalDate)])
    if (src.poNumber) header.push(['PO #', src.poNumber])
  }
  if (txn.type === 'order') {
    header.push(['Pallets shipped', txn.pallets])
    header.push(['Units shipped', txn.units])
    if (txn.picker) header.push(['Picker', txn.picker])
    if (src.shippedAt) header.push(['Shipped at', fmtDateTime(src.shippedAt)])
    if (src.carrier?.name) header.push(['Carrier', src.carrier.name])
    if (src.carrier?.trackingNumber) header.push(['Tracking', src.carrier.trackingNumber])
    header.push(['Total charges', `$${Number(txn.amount || 0).toFixed(2)}`])
  }
  if (txn.type === 'invoice') {
    if (src.period) header.push(['Period', src.period])
    if (src.invoiceNumber) header.push(['Invoice #', src.invoiceNumber])
    header.push(['Total', `$${Number(src.total || 0).toFixed(2)}`])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(header), 'Summary')

  // Sheet 2: Details
  if (txn.type === 'receipt') {
    const palletDocs = inventory.filter(i => i.receiptId === txn.sourceId)
    const rows = [['Pallet ID', 'SKU', 'Description', 'Units', 'Location', 'Condition', 'Status']]
    palletDocs.forEach(p => rows.push([
      p.palletId || '', p.sku || '', p.description || '',
      Number(p.units || 0), p.location || '', p.condition || 'A', p.status || 'available'
    ]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Pallets')
  }
  if (txn.type === 'order') {
    const rows = [['Pallet ID', 'SKU', 'Units Allocated']]
    ;(src.inventoryAllocations || []).forEach(a => rows.push([
      a.palletId || '', a.sku || '', Number(a.unitsAllocated || 0)
    ]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Allocations')
  }
  if (txn.type === 'invoice') {
    const rows = [['Description', 'Qty', 'Rate', 'Amount']]
    ;(src.lineItems || []).forEach(li => rows.push([
      li.description || li.label || '', li.qty ?? li.quantity ?? '',
      li.rate ? Number(li.rate) : '', Number(li.amount || 0)
    ]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Line Items')
  }

  const prefix = txn.type === 'receipt' ? 'Receipt' : txn.type === 'order' ? 'Order' : 'Invoice'
  XLSX.writeFile(wb, `${prefix}-${txn.refNumber}.xlsx`)
}
