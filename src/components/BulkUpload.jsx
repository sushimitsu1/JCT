import { useState, useRef } from 'react'
import { collection, addDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import * as XLSX from 'xlsx'
import {
  X, Upload, Download, CheckCircle, AlertCircle,
  FileSpreadsheet, RefreshCw, Trash2
} from 'lucide-react'

const generatePalletId = () => {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
  return `${date}-${Math.floor(Math.random()*9000)+1000}`
}

const genTransactionId = (prefix) => {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
  return `${prefix}-${date}-${Math.floor(Math.random()*9000)+1000}`
}

// Template definitions
const TEMPLATES = {
  receipts: {
    title: 'Receipts',
    prefix: 'REC',
    collection: 'receipts',
    columns: [
      'Receipt Group ID', 'Client Name', 'Reference #', 'Arrival Date',
      'Carrier', 'BOL #', 'Tracking #',
      'SKU', 'Description', 'Qty', 'Unit', 'Condition', 'Location', 'Weight'
    ],
    examples: [
      ['RCV-001', 'ACME Corp', 'PO-12345', '2026-01-15', 'FedEx', 'BOL-A1', 'TRK-001', 'WIDGET-001', 'Blue Widget', 50, 'Pallet', 'A', 'A-01', 1200],
      ['RCV-001', 'ACME Corp', 'PO-12345', '2026-01-15', 'FedEx', 'BOL-A1', 'TRK-001', 'WIDGET-002', 'Red Widget', 30, 'Pallet', 'A', 'A-02', 800],
      ['RCV-002', 'Sample Client', 'PO-67890', '2026-01-16', 'UPS', '', '', 'SKU-100', 'Sample Item', 100, 'Case', 'A', 'B-05', 500],
    ],
  },
  orders: {
    title: 'Orders',
    prefix: 'ORD',
    collection: 'orders',
    columns: [
      'Order Group ID', 'Client Name', 'Reference #', 'Order Date', 'Ship Date', 'Cancel Date',
      'Ship Company', 'Ship Address', 'Ship City', 'Ship State', 'Ship Zip',
      'SKU', 'Qty'
    ],
    examples: [
      ['ORD-001', 'ACME Corp', 'PO-12345', '2026-01-15', '2026-01-20', '2026-01-25', 'Amazon FBA', '123 Warehouse Way', 'Seattle', 'WA', '98101', 'WIDGET-001', 25],
      ['ORD-001', 'ACME Corp', 'PO-12345', '2026-01-15', '2026-01-20', '2026-01-25', 'Amazon FBA', '123 Warehouse Way', 'Seattle', 'WA', '98101', 'WIDGET-002', 15],
      ['ORD-002', 'Sample Client', 'PO-67890', '2026-01-16', '2026-01-22', '', 'Target DC', '456 Receive Rd', 'Dallas', 'TX', '75001', 'SKU-100', 50],
    ],
  },
  items: {
    title: 'Items / SKUs',
    prefix: 'ITM',
    collection: 'items',
    columns: [
      'Client Name', 'SKU', 'Description', 'UPC', 'Category', 'Primary Unit',
      'Pieces Per Carton', 'Units Per Pallet', 'Weight', 'Length', 'Width', 'Height',
      'Storage Rate', 'Storage Rate Type', 'Min Monthly Charge', 'Notes'
    ],
    examples: [
      ['ACME Corp', 'WIDGET-001', 'Blue Widget', '012345678901', 'Hardware', 'Pallet', 24, 40, 5, 12, 8, 6, 25, 'per_pallet', 100, 'Fragile'],
      ['ACME Corp', 'WIDGET-002', 'Red Widget', '012345678902', 'Hardware', 'Pallet', 24, 40, 5, 12, 8, 6, 25, 'per_pallet', 100, ''],
      ['Sample Client', 'SKU-100', 'Sample Item', '098765432109', 'General', 'Case', 12, 60, 2, 10, 6, 4, 1.5, 'per_unit', 50, 'Stackable'],
    ],
    locations: {
  title: 'Warehouse Locations',
  prefix: 'LOC',
  collection: 'locations',
  columns: [
    'Label', 'Aisle', 'Bay', 'Level', 'Type', 'Notes', 'Active'
  ],
  examples: [
    ['A-01', 'A', '01', '',   'floor', 'Floor bay near dock', 'true'],
    ['A-48', 'A', '48', '',   'floor', '', 'true'],
    ['A-49-01', 'A', '49', '01', 'rack', 'First rack level', 'true'],
    ['A-49-02', 'A', '49', '02', 'rack', '', 'true'],
  ],
},
  },
}

export default function BulkUpload({ type, onClose, onSuccess }) {
  const config = TEMPLATES[type]
  const fileRef = useRef()
  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [catalogItems, setCatalogItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [success, setSuccess] = useState('')

  // Load clients and catalog once
  const loadValidationData = async () => {
    const [clientsSnap, itemsSnap] = await Promise.all([
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'items')),
    ])
    const c = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const i = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    setClients(c)
    setCatalogItems(i)
    return { clients: c, items: i }
  }

  // Download template as XLSX
  const downloadTemplate = (format) => {
    const header = config.columns
    const data = [header, ...config.examples]
    const ws = XLSX.utils.aoa_to_sheet(data)
    // Set column widths
    ws['!cols'] = header.map(h => ({ wch: Math.max(h.length + 2, 12) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, config.title)
    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws)
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${config.title.replace(/\s/g, '_')}_Template.csv`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      XLSX.writeFile(wb, `${config.title.replace(/\s/g, '_')}_Template.xlsx`)
    }
  }

  // Validate a single row
  const validateRow = (row, allClients, allItems) => {
    const errors = []
    const warnings = []

    // Client name validation
    const clientName = (row['Client Name'] || '').trim()
    const matchedClient = allClients.find(c =>
      c.companyName?.toLowerCase() === clientName.toLowerCase()
    )
    if (!clientName) errors.push('Missing client name')
    else if (!matchedClient) errors.push(`Client "${clientName}" not found`)

    if (type === 'receipts' || type === 'orders') {
      // SKU validation
      const sku = (row['SKU'] || '').trim().toUpperCase()
      if (!sku) errors.push('Missing SKU')
      else if (matchedClient) {
        const skuMatch = allItems.find(i =>
          i.clientId === matchedClient.id && i.sku?.toUpperCase() === sku
        )
        if (!skuMatch) warnings.push(`SKU "${sku}" not in catalog`)
      }

      // Qty validation
      const qty = Number(row['Qty'])
      if (!qty || qty <= 0) errors.push('Qty must be > 0')

      // Date validation
      const dateField = type === 'receipts' ? 'Arrival Date' : 'Order Date'
      if (!row[dateField]) errors.push(`Missing ${dateField}`)

      // Group ID validation
      const groupField = type === 'receipts' ? 'Receipt Group ID' : 'Order Group ID'
      if (!row[groupField]) errors.push(`Missing ${groupField}`)
    }

    if (type === 'items') {
      const sku = (row['SKU'] || '').trim()
      if (!sku) errors.push('Missing SKU')
      if (matchedClient) {
        const duplicate = allItems.find(i =>
          i.clientId === matchedClient.id &&
          i.sku?.toUpperCase() === sku.toUpperCase()
        )
        if (duplicate) warnings.push(`SKU already exists — will skip`)
      if (type === 'locations') {
  const label = (row['Label'] || '').trim()
  const aisle = (row['Aisle'] || '').trim()
  const bay = (row['Bay'] || '').trim()
  if (!label && !aisle) errors.push('Missing Label or Aisle')
  if (!bay) errors.push('Missing Bay')
}
        }
    }

    return {
      errors,
      warnings,
      matchedClient,
      isValid: errors.length === 0,
    }
  }

  // Parse uploaded file
  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setSuccess('')

    const { clients: c, items: i } = await loadValidationData()

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = evt.target.result
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })

        const parsed = json.map((row, idx) => {
          const validation = validateRow(row, c, i)
          return {
            id: idx,
            data: { ...row },
            ...validation,
          }
        })
        setRows(parsed)
      } catch (err) {
        console.error(err)
        alert('Failed to parse file. Make sure it matches the template format.')
      }
      setLoading(false)
    }
    reader.readAsArrayBuffer(file)
  }

  // Update a cell in the preview
  const updateCell = (rowId, field, value) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      const newData = { ...r.data, [field]: value }
      const validation = validateRow(newData, clients, catalogItems)
      return { ...r, data: newData, ...validation }
    }))
  }

  // Delete a row
  const deleteRow = (rowId) => {
    setRows(prev => prev.filter(r => r.id !== rowId))
  }

  // Import all valid rows
  const handleImport = async () => {
    const validRows = rows.filter(r => r.isValid)
    if (validRows.length === 0) return
    setImporting(true)
    setImportProgress(0)

    try {
      if (type === 'items') {
        // Direct insert, one doc per row
        let done = 0
        for (const row of validRows) {
          if (row.warnings.some(w => w.includes('already exists'))) {
            done++
            setImportProgress(done)
            continue
          }
          const d = row.data
          await addDoc(collection(db, 'items'), {
            clientId: row.matchedClient.id,
            clientName: row.matchedClient.companyName,
            sku: String(d['SKU']).toUpperCase(),
            description: d['Description'] || '',
            upc: d['UPC'] || '',
            category: d['Category'] || '',
            primaryUnit: d['Primary Unit'] || 'Pallet',
            piecesPerCarton: Number(d['Pieces Per Carton'] || 0),
            unitsPerPallet: Number(d['Units Per Pallet'] || 0),
            weight: Number(d['Weight'] || 0),
            length: Number(d['Length'] || 0),
            width: Number(d['Width'] || 0),
            height: Number(d['Height'] || 0),
            storageRate: Number(d['Storage Rate'] || 0),
            storageRateType: d['Storage Rate Type'] || 'per_pallet',
            minMonthlyCharge: Number(d['Min Monthly Charge'] || 0),
            notes: d['Notes'] || '',
            createdAt: new Date().toISOString(),
          })
          done++
          setImportProgress(done)
        }
      } else if (type === 'locations') {
        let done = 0
        for (const row of validRows) {
          const d = row.data
          const aisle = (d['Aisle'] || '').toUpperCase()
          const bay = String(d['Bay'] || '')
          const level = d['Level'] ? String(d['Level']) : null
          const label = (d['Label'] || '').trim() || [aisle, bay, level].filter(Boolean).join('-')
          await addDoc(collection(db, 'locations'), {
            label,
            aisle,
            bay,
            level,
            type: (d['Type'] || 'floor').toLowerCase(),
            notes: d['Notes'] || '',
            active: String(d['Active'] || 'true').toLowerCase() !== 'false',
            createdAt: new Date().toISOString(),
            source: 'bulk_upload',
          })
          done++
          setImportProgress(done)
        }
      } else {
        // Group rows by Group ID for receipts/orders
        const groupField = type === 'receipts' ? 'Receipt Group ID' : 'Order Group ID'
        const groups = {}
        validRows.forEach(r => {
          const gid = r.data[groupField]
          if (!groups[gid]) groups[gid] = []
          groups[gid].push(r)
        })

        let done = 0
        for (const [groupId, groupRows] of Object.entries(groups)) {
          const first = groupRows[0]
          const d = first.data
          const client = first.matchedClient

          if (type === 'receipts') {
            const lineItems = groupRows.map(r => ({
              sku: String(r.data['SKU']).toUpperCase(),
              description: r.data['Description'] || '',
              quantity: Number(r.data['Qty'] || 0),
              primaryUnits: r.data['Unit'] || 'Pallet',
              condition: r.data['Condition'] || 'A',
              location: r.data['Location'] || '',
              weight: Number(r.data['Weight'] || 0),
              notes: '',
            }))
            const totalPallets = lineItems.reduce((s, i) => s + Number(i.quantity || 0), 0)
            const totalWeight = lineItems.reduce((s, i) => s + Number(i.weight || 0), 0)

            const receiptDoc = await addDoc(collection(db, 'receipts'), {
              transactionId: genTransactionId('REC'),
              clientId: client.id,
              clientName: client.companyName,
              referenceId: d['Reference #'] || '',
              poNumber: d['Reference #'] || '',
              arrivalDate: d['Arrival Date'] || '',
              carrier: d['Carrier'] || '',
              bolNumber: d['BOL #'] || '',
              trackingNumber: d['Tracking #'] || '',
              lineItems,
              charges: [],
              totalPallets,
              totalUnits: totalPallets,
              totalWeight,
              totalCharges: 0,
              status: 'open',
              createdAt: new Date().toISOString(),
              source: 'bulk_upload',
            })

            // Create inventory pallets
            for (const item of lineItems) {
              const pallets = Number(item.quantity || 1)
              for (let p = 0; p < pallets; p++) {
                await addDoc(collection(db, 'inventory'), {
                  palletId: generatePalletId(),
                  clientId: client.id,
                  clientName: client.companyName,
                  sku: item.sku,
                  description: item.description,
                  units: 1,
                  condition: item.condition,
                  location: item.location,
                  status: 'available',
                  receivedDate: (d['Arrival Date'] || '').split('T')[0],
                  receiptId: receiptDoc.id,
                  weight: item.weight,
                  createdAt: new Date().toISOString(),
                })
              }
            }
          } else if (type === 'orders') {
            const items = groupRows.map(r => ({
              sku: String(r.data['SKU']).toUpperCase(),
              quantity: Number(r.data['Qty'] || 0),
              pieces: Number(r.data['Qty'] || 0),
            }))

            await addDoc(collection(db, 'orders'), {
              transactionId: genTransactionId('ORD'),
              clientId: client.id,
              clientName: client.companyName,
              orderNumber: d['Reference #'] || '',
              orderDate: d['Order Date'] || '',
              earliestShipDate: d['Ship Date'] || '',
              cancelDate: d['Cancel Date'] || '',
              shipTo: {
                company: d['Ship Company'] || '',
                address1: d['Ship Address'] || '',
                city: d['Ship City'] || '',
                state: d['Ship State'] || '',
                zip: String(d['Ship Zip'] || ''),
              },
              carrier: {},
              items,
              charges: [],
              status: 'pending',
              createdAt: new Date().toISOString(),
              source: 'bulk_upload',
            })
          }
          done += groupRows.length
          setImportProgress(done)
        }
      }

      setSuccess(`Successfully imported ${validRows.length} row(s)`)
      setRows([])
      if (onSuccess) onSuccess()
      setTimeout(() => { onClose() }, 1500)
    } catch (err) {
      console.error(err)
      alert('Import failed: ' + err.message)
    }
    setImporting(false)
  }

  const validCount = rows.filter(r => r.isValid).length
  const errorCount = rows.filter(r => !r.isValid).length
  const warnCount = rows.filter(r => r.warnings.length > 0).length

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-7xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold flex items-center gap-2">
              <FileSpreadsheet size={18} /> Bulk Upload — {config.title}
            </h3>
            <p className="text-gray-500 text-xs mt-0.5">
              Download a template, fill it in, then upload to create multiple records at once.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
          <button onClick={() => downloadTemplate('xlsx')}
            className="flex items-center gap-1.5 text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 px-3 py-2 rounded-lg">
            <Download size={14} /> Download Excel Template
          </button>
          <button onClick={() => downloadTemplate('csv')}
            className="flex items-center gap-1.5 text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 px-3 py-2 rounded-lg">
            <Download size={14} /> Download CSV Template
          </button>
          <div className="flex-1"></div>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={handleFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
            <Upload size={14} /> {rows.length > 0 ? 'Replace File' : 'Upload File'}
          </button>
        </div>

        {/* Status banner */}
        {rows.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-800 bg-gray-800/30 flex items-center gap-4 text-xs">
            <span className="text-gray-400">{rows.length} rows parsed</span>
            <span className="text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {validCount} valid
            </span>
            {errorCount > 0 && (
              <span className="text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> {errorCount} errors
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-yellow-400 flex items-center gap-1">
                <AlertCircle size={12} /> {warnCount} warnings
              </span>
            )}
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="mx-6 mt-4 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <CheckCircle size={16} /> {success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" /> Parsing file...
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="text-center py-12">
              <FileSpreadsheet size={48} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 text-sm mb-1">No file uploaded yet</p>
              <p className="text-gray-600 text-xs">Download a template above, fill it in, then upload here.</p>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="border-b border-gray-800">
                  <th className="text-left px-2 py-2 text-gray-500 font-medium w-8">#</th>
                  <th className="text-left px-2 py-2 text-gray-500 font-medium w-24">Status</th>
                  {config.columns.map(col => (
                    <th key={col} className="text-left px-2 py-2 text-gray-500 font-medium whitespace-nowrap">{col}</th>
                  ))}
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.id} className={`border-b border-gray-800/50 ${
                    !r.isValid ? 'bg-red-500/5' :
                    r.warnings.length > 0 ? 'bg-yellow-500/5' :
                    'hover:bg-gray-800/30'
                  }`}>
                    <td className="px-2 py-1.5 text-gray-500">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      {r.isValid ? (
                        r.warnings.length > 0 ? (
                          <span title={r.warnings.join('\n')} className="text-yellow-400 flex items-center gap-1">
                            <AlertCircle size={11} /> Warn
                          </span>
                        ) : (
                          <span className="text-green-400 flex items-center gap-1">
                            <CheckCircle size={11} /> OK
                          </span>
                        )
                      ) : (
                        <span title={r.errors.join('\n')} className="text-red-400 flex items-center gap-1">
                          <AlertCircle size={11} /> Error
                        </span>
                      )}
                    </td>
                    {config.columns.map(col => (
                      <td key={col} className="px-1 py-1">
                        <input
                          value={r.data[col] ?? ''}
                          onChange={e => updateCell(r.id, col, e.target.value)}
                          className={`w-full bg-gray-800/50 border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 ${
                            !r.isValid && (
                              (col === 'Client Name' && r.errors.some(e => e.includes('Client'))) ||
                              (col === 'SKU' && r.errors.some(e => e.includes('SKU'))) ||
                              (col === 'Qty' && r.errors.some(e => e.includes('Qty')))
                            ) ? 'border-red-500/50' : 'border-gray-700'
                          }`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <button onClick={() => deleteRow(r.id)} className="text-gray-600 hover:text-red-400">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && errorCount > 0 && (
            <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-xs text-red-300">
              <p className="font-medium mb-1">Errors must be fixed before import:</p>
              <ul className="space-y-0.5 list-disc list-inside text-red-400/80">
                {rows.filter(r => !r.isValid).slice(0, 5).map(r => (
                  <li key={r.id}>Row {rows.indexOf(r) + 1}: {r.errors.join(', ')}</li>
                ))}
                {errorCount > 5 && <li>...and {errorCount - 5} more</li>}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <div className="text-xs text-gray-500">
            {importing && `Importing... ${importProgress}/${validCount}`}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              Cancel
            </button>
            <button onClick={handleImport}
              disabled={importing || validCount === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">
              {importing ? (
                <><RefreshCw size={14} className="animate-spin" /> Importing...</>
              ) : (
                <><Upload size={14} /> Import {validCount} {validCount === 1 ? 'row' : 'rows'}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
