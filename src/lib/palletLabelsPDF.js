import jsPDF from 'jspdf'
import QRCode from 'qrcode'

// 4x6 inch thermal label (portrait)
const W = 4   // inches
const H = 6
const MARGIN = 0.2

const fmtDate = (v) => {
  if (!v) return ''
  const d = v?.toDate ? v.toDate() : new Date(v)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

const qrDataURL = async (text) => {
  return QRCode.toDataURL(String(text), {
    errorCorrectionLevel: 'M',
    width: 500,         // px — high res so it stays sharp on print
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

/**
 * Generate a multi-page PDF, one 4x6 label per pallet, with QR code.
 * Async because QR rendering returns a promise.
 */
export async function generatePalletLabelsPDF(pallets, filename = 'JCT-Pallet-Labels.pdf') {
  if (!pallets || pallets.length === 0) {
    alert('No pallets to label.')
    return
  }

  // Pre-render all QR codes in parallel
  const qrUrls = await Promise.all(pallets.map(p => qrDataURL(p.palletId)))

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: [W, H],
  })

  pallets.forEach((p, i) => {
    if (i > 0) pdf.addPage([W, H], 'portrait')

    // ─── JCT header bar (red) ───────────────────────────
    pdf.setFillColor(200, 16, 46)
    pdf.rect(0, 0, W, 0.5, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.text('JCT LOGISTICS INC.', W / 2, 0.33, { align: 'center' })

    // ─── Client name ────────────────────────────────────
    pdf.setTextColor(60, 60, 60)
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.text(String(p.clientName || '').slice(0, 36), W / 2, 0.78, { align: 'center' })

    // ─── QR code (centered, ~2.2 in square) ─────────────
    try {
      const qrSize = 2.2
      pdf.addImage(qrUrls[i], 'PNG', (W - qrSize) / 2, 0.95, qrSize, qrSize)
    } catch (e) {
      console.error('QR render failed', e)
    }

    // ─── Pallet ID (big text under QR) ──────────────────
    pdf.setTextColor(0, 0, 0)
    pdf.setFont('courier', 'bold')
    pdf.setFontSize(28)
    pdf.text(`#${p.palletId}`, W / 2, 3.55, { align: 'center' })

    // ─── Separator line ─────────────────────────────────
    pdf.setDrawColor(180, 180, 180)
    pdf.setLineWidth(0.01)
    pdf.line(MARGIN, 3.8, W - MARGIN, 3.8)

    // ─── SKU + units ────────────────────────────────────
    pdf.setTextColor(120, 120, 120)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('SKU', MARGIN, 4.0)

    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text(String(p.sku || '-').slice(0, 22), MARGIN, 4.3)

    pdf.setTextColor(120, 120, 120)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('UNITS', W - MARGIN, 4.0, { align: 'right' })

    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text(String(p.units || 0), W - MARGIN, 4.3, { align: 'right' })

    // ─── Description (wrap, max 2 lines) ────────────────
    pdf.setTextColor(120, 120, 120)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('DESCRIPTION', MARGIN, 4.55)

    pdf.setTextColor(40, 40, 40)
    pdf.setFontSize(10)
    const descLines = pdf.splitTextToSize(String(p.description || ''), W - 2 * MARGIN)
    pdf.text(descLines.slice(0, 2), MARGIN, 4.78)

    // ─── Location ───────────────────────────────────────
    pdf.setTextColor(120, 120, 120)
    pdf.setFontSize(8)
    pdf.text('LOCATION', MARGIN, 5.2)

    pdf.setTextColor(0, 0, 0)
    pdf.setFont('courier', 'bold')
    pdf.setFontSize(16)
    pdf.text(String(p.location || '-'), MARGIN, 5.5)

    // ─── Received date ──────────────────────────────────
    pdf.setTextColor(120, 120, 120)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('RECEIVED', W - MARGIN, 5.2, { align: 'right' })

    pdf.setTextColor(0, 0, 0)
    pdf.setFontSize(11)
    pdf.text(fmtDate(p.receivedDate), W - MARGIN, 5.5, { align: 'right' })

    // ─── Footer ─────────────────────────────────────────
    pdf.setDrawColor(180, 180, 180)
    pdf.line(MARGIN, 5.7, W - MARGIN, 5.7)

    pdf.setTextColor(120, 120, 120)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    if (p.receiptId) {
      pdf.text(`Receipt: ${p.receiptId}`, MARGIN, 5.88)
    }
    pdf.text(`${i + 1} of ${pallets.length}`, W - MARGIN, 5.88, { align: 'right' })
  })

  pdf.save(filename)
}
