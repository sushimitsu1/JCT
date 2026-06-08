import { PDFDocument } from 'pdf-lib'

// Known rate field keys (must match rateSheetPDF.js fieldName scheme: rate_{key})
const KNOWN_KEYS = new Set([
  // Outbound
  'ecomOutboundFee', 'ecomAdditionalUnit', 'outboundProcessing', 'handlingPerCase',
  'palletLoading', 'pickByPallet', 'labeling', 'photo',
  'measurementUnit', 'measurementPallet', 'additionalDocuments', 'hourlyLabor',
  // FCL
  'fcl20GP', 'fcl40GP', 'fcl40HQ', 'fcl45GP',
  // Overweight
  'overweight3049', 'overweight5080', 'overweight80plus',
  // Palletizing & sorting
  'palletizingFee', 'sortingPerSku',
  'sortingTier1000', 'sortingTier1200', 'sortingTier1500', 'sortingTier2000',
  'labelFee', 'labelRemoval',
  // LCL
  'lclReceiving', 'repackagingPerCarton', 'repackagingPerPallet',
  'looseCartonUnder50', 'looseCartonOver50',
  // Storage
  'storageStackable', 'storageOversized',
  // Documents
  'bolFee',
])

const parseNumber = (raw) => {
  if (raw == null) return null
  const cleaned = String(raw).replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/**
 * Parse a rate sheet PDF and extract rate field values.
 * @param {File} file - the uploaded PDF File object
 * @returns {Promise<{rates: Object, found: string[], missing: string[], unknown: string[]}>}
 */
export async function parseRateSheetPDF(file) {
  const bytes = await file.arrayBuffer()
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdfDoc.getForm()
  const fields = form.getFields()

  const rates = {}
  const found = []
  const unknown = []

  fields.forEach(field => {
    const name = field.getName()
    if (!name.startsWith('rate_')) {
      unknown.push(name); return
    }
    const key = name.substring(5)
    if (!KNOWN_KEYS.has(key)) { unknown.push(name); return }

    // pdf-lib text fields expose getText()
    let raw = ''
    try { raw = field.getText() || '' } catch { raw = '' }

    const num = parseNumber(raw)
    if (num !== null) {
      rates[key] = num
      found.push(key)
    }
  })

  const missing = [...KNOWN_KEYS].filter(k => !(k in rates))

  return { rates, found, missing, unknown }
}
