import jsPDF from 'jspdf'

// ─── Layout config ──────────────────────────────────────────
const PAGE_W = 210  // mm (A4)
const PAGE_H = 297
const MARGIN = 12
const RED = [200, 16, 46]
const NAVY = [27, 42, 74]
const GRAY = [120, 120, 120]
const LIGHT = [240, 240, 240]

// ─── Page header ────────────────────────────────────────────
const drawHeader = (pdf, clientName, subtitle) => {
  // Red banner
  pdf.setFillColor(...RED); pdf.rect(0, 0, PAGE_W, 14, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
  pdf.text('JCT LOGISTICS INC. — Service Rate Sheet', PAGE_W / 2, 9, { align: 'center' })

  // Below banner: contact
  pdf.setTextColor(...NAVY); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
  pdf.text('TEL: 909-986-0886', MARGIN, 19)
  pdf.text('SERVICE@JCTLOGISTICSINC.COM', PAGE_W - MARGIN, 19, { align: 'right' })

  // Client + subtitle
  pdf.setFontSize(11); pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(...RED)
  pdf.text(`Client: ${clientName}`, MARGIN, 27)
  pdf.setTextColor(...NAVY); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  pdf.text(subtitle, PAGE_W - MARGIN, 27, { align: 'right' })
}

// ─── Add a fillable rate row ────────────────────────────────
// Returns the y coordinate AFTER this row.
const drawRateRow = (pdf, y, label, fieldName, currentValue, description, rowHeight = 8) => {
  const labelW = 70
  const rateW = 25
  const descX = MARGIN + labelW + rateW + 4

  // Row border
  pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.2)
  pdf.line(MARGIN, y + rowHeight, PAGE_W - MARGIN, y + rowHeight)

  // Label
  pdf.setTextColor(...NAVY); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  const labelLines = pdf.splitTextToSize(label, labelW - 2)
  pdf.text(labelLines, MARGIN, y + 5)

  // Fillable rate field
  const tf = new pdf.AcroFormTextField()
  tf.Rect = [MARGIN + labelW, y + 1.5, rateW, rowHeight - 3]
  tf.fieldName = fieldName
  tf.value = currentValue && currentValue !== 0 ? `$${Number(currentValue).toFixed(2)}` : ''
  tf.fontSize = 9
  tf.maxFontSize = 9
  tf.borderColor = '#cccccc'
  pdf.addField(tf)

  // Description (gray italic)
  if (description) {
    pdf.setTextColor(...GRAY); pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8)
    const descLines = pdf.splitTextToSize(description, PAGE_W - descX - MARGIN)
    pdf.text(descLines, descX, y + 5)
  }

  return y + rowHeight + 1
}

// ─── Section header ─────────────────────────────────────────
const drawSection = (pdf, y, title) => {
  pdf.setFillColor(...NAVY); pdf.rect(MARGIN, y, PAGE_W - 2 * MARGIN, 7, 'F')
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10)
  pdf.text(title, MARGIN + 3, y + 5)
  return y + 10
}

// ─── Footer with signature block ────────────────────────────
const drawFooter = (pdf, meta, pageNum, pageTotal) => {
  const y = PAGE_H - 30

  // Quote validity
  pdf.setTextColor(...GRAY); pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8)
  pdf.text('Rates are based on this scope of work. In the event the actual project deviates, rates are subject to change.',
    PAGE_W / 2, y - 6, { align: 'center' })

  // Signature block on last page only
  if (pageNum === pageTotal) {
    pdf.setTextColor(...NAVY); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
    pdf.text(`Quote valid until: ${meta.quoteValidUntil || '___________'}`, MARGIN, y)

    pdf.setDrawColor(...NAVY); pdf.setLineWidth(0.3)
    const sigY = y + 12
    const sigW = 55
    pdf.line(MARGIN, sigY, MARGIN + sigW, sigY); pdf.text('Accepted by (Name/Title)', MARGIN, sigY + 4)
    pdf.line(MARGIN + sigW + 5, sigY, MARGIN + sigW * 2 + 5, sigY); pdf.text('Company', MARGIN + sigW + 5, sigY + 4)
    pdf.line(MARGIN + sigW * 2 + 10, sigY, PAGE_W - MARGIN, sigY); pdf.text('Date / Signature', MARGIN + sigW * 2 + 10, sigY + 4)
  }

  // Page number
  pdf.setFontSize(8); pdf.setTextColor(...GRAY); pdf.setFont('helvetica', 'normal')
  pdf.text(`Page ${pageNum} of ${pageTotal}`, PAGE_W - MARGIN, PAGE_H - 5, { align: 'right' })
}

// ─── Field definitions per section (must match ServiceRatesEditor keys) ─
const PAGE1 = [
  { title: 'OUTBOUND SERVICES', rows: [
    { key: 'ecomOutboundFee',     label: 'E-commerce Outbound Processing Fee', desc: 'First item pick, pack, 1st label and ship' },
    { key: 'ecomAdditionalUnit',  label: 'Handling Price Per Additional Unit', desc: 'Each additional unit picked' },
    { key: 'outboundProcessing',  label: 'Outbound Processing Fee',            desc: 'Process each outbound order' },
    { key: 'handlingPerCase',     label: 'Handling Price Per Case',            desc: 'Pick a master carton' },
    { key: 'palletLoading',       label: 'Pallet Loading',                     desc: 'Load an outbound pallet' },
    { key: 'pickByPallet',        label: 'Pick by Pallet',                     desc: 'Pick a full pallet' },
    { key: 'labeling',            label: 'Labeling',                           desc: 'Shipping, carton, item, or FBA label' },
    { key: 'photo',               label: 'Photo',                              desc: 'Per photo' },
    { key: 'measurementUnit',     label: 'Measurement (unit or carton)',       desc: 'Measure one unit or master carton' },
    { key: 'measurementPallet',   label: 'Measurement (pallet)',               desc: 'Measure per pallet' },
    { key: 'additionalDocuments', label: 'Additional Documents',               desc: 'Commercial invoices, packing lists' },
    { key: 'hourlyLabor',         label: 'Hourly Labor',                       desc: 'Per hour' },
  ]},
]

const PAGE2 = [
  { title: 'FCL SERVICE — UNLOADING (LOOSE-IN)', rows: [
    { key: 'fcl20GP', label: '20GP container', desc: '' },
    { key: 'fcl40GP', label: '40GP container', desc: '' },
    { key: 'fcl40HQ', label: '40HQ container', desc: '' },
    { key: 'fcl45GP', label: '45GP container', desc: '' },
  ]},
  { title: 'CARTON OVERWEIGHT CHARGE (per container)', rows: [
    { key: 'overweight3049',   label: '30-49 lbs/ctn',  desc: '' },
    { key: 'overweight5080',   label: '50-80 lbs/ctn',  desc: '' },
    { key: 'overweight80plus', label: 'Over 80 lbs/ctn', desc: '' },
  ]},
  { title: 'PALLETIZING & SORTING', rows: [
    { key: 'palletizingFee',  label: 'Palletizing Fee (per pallet)', desc: '48"x40"x72", <1000 lb standard' },
    { key: 'sortingPerSku',   label: 'Sorting Fee (per item/SKU)',   desc: '' },
    { key: 'sortingTier1000', label: 'Sorting >=1000 ctns',          desc: '' },
    { key: 'sortingTier1200', label: 'Sorting >=1200 ctns',          desc: '' },
    { key: 'sortingTier1500', label: 'Sorting >=1500 ctns',          desc: '' },
    { key: 'sortingTier2000', label: 'Sorting >=2000 ctns',          desc: '' },
    { key: 'labelFee',        label: 'Label (per label)',            desc: '' },
    { key: 'labelRemoval',    label: 'Label Removal (per label)',    desc: '' },
  ]},
]

const PAGE3 = [
  { title: 'LCL SERVICE', rows: [
    { key: 'lclReceiving',         label: 'Receiving / Unloading (per pallet)', desc: '' },
    { key: 'repackagingPerCarton', label: 'Repackaging (per carton)',           desc: '' },
    { key: 'repackagingPerPallet', label: 'Repackaging (per pallet)',           desc: 'Re-stack, re-work, enhanced shrink wrap' },
    { key: 'looseCartonUnder50',   label: 'Loose Carton (<50 lbs/ctn)',         desc: '' },
    { key: 'looseCartonOver50',    label: 'Loose Carton (>=50 lbs/ctn)',        desc: '' },
  ]},
  { title: 'STORAGE (per pallet / month)', rows: [
    { key: 'storageStackable', label: 'Standard Stackable',           desc: '1/2 month initial if received after 15th' },
    { key: 'storageOversized', label: 'Non-Stackable / Oversized',    desc: 'Leave blank if billed by quote' },
  ]},
  { title: 'DOCUMENTS', rows: [
    { key: 'bolFee', label: 'Bill of Lading (per BOL)', desc: 'If generated by JCT' },
  ]},
]

const drawPage = (pdf, sections, rates, clientName, subtitle, pageNum, pageTotal, meta) => {
  drawHeader(pdf, clientName, subtitle)
  let y = 33
  sections.forEach(section => {
    y = drawSection(pdf, y, section.title)
    section.rows.forEach(row => {
      y = drawRateRow(pdf, y, row.label, `rate_${row.key}`, rates[row.key], row.desc)
    })
    y += 3
  })
  drawFooter(pdf, meta, pageNum, pageTotal)
}

// ─── Public API ─────────────────────────────────────────────
export function generateRateSheetPDF(clientName, rates = {}, meta = {}) {
  const pdf = new jsPDF()
  const total = 3
  drawPage(pdf, PAGE1, rates, clientName, 'Outbound Services', 1, total, meta)
  pdf.addPage()
  drawPage(pdf, PAGE2, rates, clientName, 'Inbound — FCL & Palletizing', 2, total, meta)
  pdf.addPage()
  drawPage(pdf, PAGE3, rates, clientName, 'LCL, Storage & Documents', 3, total, meta)

  const safeName = (clientName || 'client').replace(/[^a-z0-9]/gi, '_')
  pdf.save(`JCT-Rate-Sheet-${safeName}.pdf`)
}
