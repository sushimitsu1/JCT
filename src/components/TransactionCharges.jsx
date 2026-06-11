import { useState } from 'react'
import { CheckCircle, X, Plus, ChevronDown, RefreshCw, Filter } from 'lucide-react'

const CATEGORY_COLORS = {
  Handling:        'bg-teal-500/10 text-teal-400 border-teal-500/20',
  Storage:         'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Freight Prepaid':'bg-sky-500/10 text-sky-400 border-sky-500/20',
  'Freight 3rd Party':'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  Special:         'bg-red-500/10 text-red-400 border-red-500/20',
  Materials:       'bg-amber-500/10 text-amber-400 border-amber-500/20',
  Receiving:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Outbound:        'bg-orange-500/10 text-orange-400 border-orange-500/20',
}

const inputCls = 'bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500'

// ──────────────────────────────────────────────────────────────────────
// RECEIPT-TYPE → sourceKey ALLOW-LIST
// Returns the list of rate card sourceKeys that should auto-load for a
// given receipt context. Storage rows are handled separately (any row
// with category === 'Storage' loads regardless of receipt type).
// Return null = no filter (legacy / non-receive contexts).
// ──────────────────────────────────────────────────────────────────────
const sourceKeysForReceipt = (receiptType, containerSize, parcelIncludePalletizing, parcelWeightClass) => {
  if (!receiptType) return null
  const keys = []
  if (receiptType === 'fcl_loose') {
    const sizeKey = {
      "20'GP": 'fcl20GP',
      "40'GP": 'fcl40GP',
      "40'HQ": 'fcl40HQ',
      "45'HQ": 'fcl45GP',   // 45HQ container uses the fcl45GP rate row
    }[containerSize]
    if (sizeKey) keys.push(sizeKey)
    keys.push('palletizingFee')
  } else if (receiptType === 'fcl_palletized' || receiptType === 'lcl') {
    keys.push('lclReceiving')
  } else if (receiptType === 'parcel') {
    // Pick loose carton fee based on weight class — if any number in the class is >= 50, use Over50
    const nums = (String(parcelWeightClass || '').match(/\d+/g) || []).map(Number)
    if (parcelWeightClass) {
      const isOver50 = nums.some(n => n >= 50)
      keys.push(isOver50 ? 'looseCartonOver50' : 'looseCartonUnder50')
    }
    if (parcelIncludePalletizing) keys.push('palletizingFee')
  }
  return keys
}

const monthMultiplier = (arrivalDate, splitPeriodDay) => {
  if (!arrivalDate) return 1
  const day = new Date(arrivalDate).getDate()
  const split = Number(splitPeriodDay) || 15
  return day >= split ? 0.5 : 1
}

const filterSummary = (receiptType, containerSize) => {
  const label = { fcl_loose: 'FCL Loose', fcl_palletized: 'FCL Palletized', lcl: 'LCL', parcel: 'Parcel' }[receiptType]
  if (!label) return null
  if (receiptType === 'fcl_loose') return containerSize ? `${label} · ${containerSize}` : label
  return label
}

export default function TransactionCharges({
  charges,
  onChargesChange,
  rateCard,
  trigger,                    // 'on_receive' | 'on_ship'
  quantities,
  readOnly,
  clientName,
  receiptType,                // 'fcl_loose' | 'fcl_palletized' | 'lcl' | 'parcel'
  containerSize,              // "20'GP" | "40'GP" | "40'HQ" | "45'HQ"
  parcelIncludePalletizing,   // bool — parcel receipts only
  parcelWeightClass,          // string — e.g. '20–70 lbs'
  arrivalDate,                // ISO string — for initial storage half/full month calc
  splitPeriodDay,             // string/number — from client doc (default 15)
}) {
  const [showPresets, setShowPresets] = useState(false)
  const [bypassFilter, setBypassFilter] = useState(false)

  const activeFilter = filterSummary(receiptType, containerSize)
  const filteringActive = !!activeFilter && !bypassFilter

  const loadFromRateCard = () => {
    if (!rateCard?.length) return

    // Step 1: trigger-matched rows
    let applicable = rateCard.filter(r => r.trigger === trigger || r.trigger === 'both')

    // Step 2: receipt-type allow-list
    if (filteringActive && trigger === 'on_receive') {
      const allowed = sourceKeysForReceipt(receiptType, containerSize, parcelIncludePalletizing, parcelWeightClass)
      if (allowed !== null) {
        applicable = applicable.filter(r => allowed.includes(r.sourceKey))
      }
    }

    const calculated = applicable.map(r => {
      const qty = calcQty(r.unit, quantities)
      const amount = Number((qty * Number(r.rate || 0)).toFixed(2))
      return {
        id: Date.now() + Math.random(),
        label: r.label,
        category: r.category,
        unit: r.unit,
        qty,
        rate: Number(r.rate || 0),
        total: amount,
        glCode: r.glCode || '',
        sourceKey: r.sourceKey || '',
        origin: 'Rate Card',
        status: 'pending',
      }
    }).filter(c => c.qty > 0)

    // Step 3: initial storage on every receive (regardless of receipt type)
    if (trigger === 'on_receive') {
      const storageRows = rateCard.filter(r => r.category === 'Storage')
      const mult = monthMultiplier(arrivalDate, splitPeriodDay)
      const palletQty = Number(quantities?.pallets || 0)
      for (const r of storageRows) {
        if (palletQty <= 0) continue
        const baseRate = Number(r.rate || 0)
        if (baseRate <= 0) continue
        const adjustedRate = Number((baseRate * mult).toFixed(4))
        const total = Number((palletQty * adjustedRate).toFixed(2))
        calculated.push({
          id: Date.now() + Math.random() + Number(r.id || 0),
          label: `Initial Storage — ${mult === 0.5 ? '½ Month' : 'Full Month'} (${r.label})`,
          category: 'Storage',
          unit: r.unit || 'pallet',
          qty: palletQty,
          rate: adjustedRate,
          total,
          glCode: r.glCode || '',
          sourceKey: r.sourceKey || '',
          origin: 'Rate Card',
          status: 'pending',
        })
      }
    }

    const confirmed = (charges || []).filter(c => c.status === 'confirmed')
    onChargesChange([...confirmed, ...calculated])
  }

  const calcQty = (unit, qty) => {
    if (!qty) return 1
    switch (unit?.toLowerCase()) {
      case 'pallet':  return Number(qty.pallets || 1)
      case 'unit':
      case 'each':    return Number(qty.units || 0)
      case 'carton':
      case 'case':    return Number(qty.cartons || 0)
      case 'order':
      case 'receipt': return 1
      case 'hour':    return 1
      default:        return 1
    }
  }

  const confirmCharge = (id) => onChargesChange(charges.map(c => c.id === id ? { ...c, status: 'confirmed' } : c))
  const confirmAll = () => onChargesChange(charges.map(c => ({ ...c, status: 'confirmed' })))
  const removeCharge = (id) => onChargesChange(charges.filter(c => c.id !== id))
  const updateCharge = (id, field, value) => {
    onChargesChange(charges.map(c => {
      if (c.id !== id) return c
      const updated = { ...c, [field]: value, status: 'adjusted' }
      if (field === 'qty' || field === 'rate') {
        updated.total = Number((Number(updated.qty || 0) * Number(updated.rate || 0)).toFixed(2))
      }
      if (field === 'total') updated.total = Number(value)
      return updated
    }))
  }
  const addManualCharge = (preset = {}) => {
    onChargesChange([...(charges || []), {
      id: Date.now() + Math.random(),
      label: preset.label || '',
      category: preset.category || 'Handling',
      unit: preset.unit || 'pallet',
      qty: 1,
      rate: Number(preset.rate || 0),
      total: Number(preset.rate || 0),
      glCode: preset.glCode || '',
      sourceKey: preset.sourceKey || '',
      origin: 'Manual',
      status: 'confirmed',
    }])
    setShowPresets(false)
  }

  const pendingCount   = (charges || []).filter(c => c.status === 'pending').length
  const confirmedCount = (charges || []).filter(c => c.status === 'confirmed' || c.status === 'adjusted').length
  const total = (charges || []).reduce((s, c) => s + Number(c.total || 0), 0)
  const hasRateCard = rateCard?.length > 0

  // Add-Charge dropdown: ALL non-storage rows that aren't auto-loaded — i.e. anything
  // the user might want to add manually (overweight, sorting, loose carton, repackaging, labels, etc.)
  const allowedAutoKeys = trigger === 'on_receive'
    ? (sourceKeysForReceipt(receiptType, containerSize, parcelIncludePalletizing, parcelWeightClass) || [])
    : []
  const manualPresets = (rateCard || []).filter(r => {
    if (r.category === 'Storage') return false   // storage is auto-loaded already
    if (trigger === 'on_receive' && (r.trigger === 'on_receive' || r.trigger === 'both') && allowedAutoKeys.includes(r.sourceKey)) {
      return false  // already auto-loaded for this receipt
    }
    return true
  })

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {hasRateCard ? (
              <button onClick={loadFromRateCard}
                className="flex items-center gap-1.5 text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-600/20 px-3 py-1.5 rounded-lg transition-colors">
                <RefreshCw size={13} /> Load from Rate Card
              </button>
            ) : (
              <span className="text-xs text-gray-600 italic">No rate card configured for {clientName || 'this client'} — add charges manually</span>
            )}

            {hasRateCard && trigger === 'on_receive' && activeFilter && (
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border ${
                filteringActive ? 'bg-purple-600/10 text-purple-300 border-purple-500/20' : 'bg-gray-800/40 text-gray-500 border-gray-700/40'
              }`}>
                <Filter size={11}/>
                {filteringActive ? (
                  <>
                    <span>Filtered: {activeFilter}</span>
                    <button onClick={() => setBypassFilter(true)} className="ml-1 text-purple-400 hover:text-white">show all</button>
                  </>
                ) : (
                  <>
                    <span>Showing all on-receive rates</span>
                    <button onClick={() => setBypassFilter(false)} className="ml-1 text-gray-400 hover:text-white">re-enable filter</button>
                  </>
                )}
              </div>
            )}

            {pendingCount > 0 && (
              <button onClick={confirmAll}
                className="flex items-center gap-1.5 text-sm bg-green-600/20 hover:bg-green-600/40 text-green-400 border border-green-600/20 px-3 py-1.5 rounded-lg">
                <CheckCircle size={13} /> Confirm All ({pendingCount})
              </button>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setShowPresets(!showPresets)}
              className="flex items-center gap-1 text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-600/20 px-3 py-1.5 rounded-lg">
              <Plus size={13} /> Add Charge <ChevronDown size={12} className={showPresets ? 'rotate-180' : ''} />
            </button>
            {showPresets && (
              <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 w-72 py-1 max-h-96 overflow-y-auto" style={{backgroundColor:'#111827'}}>
                {manualPresets.map(r => (
                  <button key={r.id || r.label} onClick={() => addManualCharge(r)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 border-b border-gray-700/30 last:border-0">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{r.label}</span>
                      <span className="text-gray-500">${r.rate}/{r.unit}</span>
                    </div>
                    <span className="text-gray-600">{r.category}</span>
                  </button>
                ))}
                <button onClick={() => addManualCharge()}
                  className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-gray-700 border-t border-gray-700 flex items-center gap-1">
                  <Plus size={11} /> Blank line
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {(charges || []).length > 0 && (
        <div className="flex items-center gap-4 text-xs px-1">
          {pendingCount > 0 && (<span className="text-yellow-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />{pendingCount} pending review</span>)}
          {confirmedCount > 0 && (<span className="text-green-400 flex items-center gap-1"><CheckCircle size={11} /> {confirmedCount} confirmed</span>)}
        </div>
      )}

      {(charges || []).length === 0 ? (
        <div className="border border-gray-800 border-dashed rounded-xl py-10 text-center">
          <p className="text-gray-500 text-sm">{hasRateCard ? 'Click "Load from Rate Card" to auto-calculate charges' : 'Add charges manually using the button above'}</p>
        </div>
      ) : (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-800/50 text-gray-500 text-xs border-b border-gray-800">
            <div className="col-span-1">Origin</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-3">Label</div>
            <div className="col-span-1">Qty</div>
            <div className="col-span-1">Unit</div>
            <div className="col-span-1">Rate</div>
            <div className="col-span-1">GL</div>
            <div className="col-span-1">Total</div>
            <div className="col-span-1"></div>
          </div>
          {(charges || []).map((charge) => {
            const isPending = charge.status === 'pending'
            const isConfirmed = charge.status === 'confirmed' || charge.status === 'adjusted'
            return (
              <div key={charge.id} className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-gray-800/50 last:border-0 ${isPending ? 'bg-yellow-500/3' : ''}`}>
                <div className="col-span-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${charge.origin === 'Rate Card' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>{charge.origin === 'Rate Card' ? 'RC' : 'M'}</span>
                </div>
                <div className="col-span-2"><span className={`text-xs px-1.5 py-0.5 rounded-full border ${CATEGORY_COLORS[charge.category] || CATEGORY_COLORS.Handling}`}>{charge.category}</span></div>
                {readOnly ? <div className="col-span-3 text-white text-xs">{charge.label}</div> : <input value={charge.label} onChange={e => updateCharge(charge.id, 'label', e.target.value)} className={`col-span-3 ${inputCls}`} placeholder="Label" />}
                {readOnly ? <div className="col-span-1 text-gray-300 text-xs">{charge.qty}</div> : <input type="number" min="0" value={charge.qty} onChange={e => updateCharge(charge.id, 'qty', e.target.value)} className={`col-span-1 ${inputCls}`} />}
                <div className="col-span-1 text-gray-400 text-xs">{charge.unit}</div>
                {readOnly ? <div className="col-span-1 text-gray-300 text-xs">${charge.rate}</div> : <input type="number" min="0" step="0.01" value={charge.rate} onChange={e => updateCharge(charge.id, 'rate', e.target.value)} className={`col-span-1 ${inputCls}`} />}
                <div className="col-span-1 text-yellow-400 font-mono text-xs">{charge.glCode || '—'}</div>
                <div className={`col-span-1 text-xs font-semibold ${isPending ? 'text-yellow-400' : 'text-white'}`}>${Number(charge.total).toFixed(2)}</div>
                <div className="col-span-1 flex items-center gap-1 justify-end">
                  {!readOnly && isPending && (<button onClick={() => confirmCharge(charge.id)} className="text-green-400 hover:text-green-300" title="Confirm"><CheckCircle size={14} /></button>)}
                  {!readOnly && (<button onClick={() => removeCharge(charge.id)} className="text-gray-600 hover:text-red-400" title="Remove"><X size={13} /></button>)}
                  {isConfirmed && (<CheckCircle size={12} className="text-green-500 flex-shrink-0" />)}
                </div>
              </div>
            )
          })}
          <div className="flex justify-between items-center px-4 py-3 bg-gray-800/30 border-t border-gray-700">
            <span className="text-xs text-gray-500">{(charges || []).length} charge{(charges || []).length !== 1 ? 's' : ''}{pendingCount > 0 && <span className="text-yellow-400 ml-2">· {pendingCount} need confirmation</span>}</span>
            <span className="text-white font-semibold text-sm">Total: ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}
    </div>
  )
}
