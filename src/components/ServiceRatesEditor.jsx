import { useState, useEffect } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Save, Check, Download, ChevronDown, ChevronRight, DollarSign } from 'lucide-react'
import { generateRateSheetPDF } from '../lib/rateSheetPDF'
import { syncServiceRatesToRateCard } from '../lib/serviceRatesSync'

// ─── Field definitions ─────────────────────────────────────
// Each section: { id, label, fields: [{ key, label, unit?, description?, defaultValue?, type? }] }
const SECTIONS = [
  {
    id: 'outbound',
    label: 'Outbound Services',
    fields: [
      { key: 'ecomOutboundFee',       label: 'E-commerce Outbound Processing Fee', defaultValue: 1.50, description: 'Order fee for E-commerce orders (includes first item pick, pack, 1st label and ship)' },
      { key: 'ecomAdditionalUnit',    label: 'Handling Price Per Additional Unit', defaultValue: 0.50, description: 'Cost to pick an additional unit' },
      { key: 'outboundProcessing',    label: 'Outbound Processing Fee',             defaultValue: 5.00, description: 'Cost to process each outbound order' },
      { key: 'handlingPerCase',       label: 'Handling Price Per Case',             defaultValue: 2.00, description: 'Cost to pick a master carton' },
      { key: 'palletLoading',         label: 'Pallet Loading',                      defaultValue: 15.00, description: 'Cost to load an outbound pallet' },
      { key: 'pickByPallet',          label: 'Pick by Pallet',                      defaultValue: 8.00, description: 'Cost to pick a full pallet' },
      { key: 'labeling',              label: 'Labeling',                            defaultValue: 0.50, description: 'Cost per label (shipping, carton, item, FBA)' },
      { key: 'photo',                 label: 'Photo',                               defaultValue: 1.00, description: 'Cost per photo' },
      { key: 'measurementUnit',       label: 'Measurement (unit or carton)',        defaultValue: 2.00, description: 'Cost to measure one unit or master carton' },
      { key: 'measurementPallet',     label: 'Measurement (pallet)',                defaultValue: 5.00, description: 'Cost to measure per pallet' },
      { key: 'additionalDocuments',   label: 'Additional Documents',                defaultValue: 5.00, description: 'Commercial invoices, packing lists, etc.' },
      { key: 'hourlyLabor',           label: 'Hourly Labor',                        defaultValue: 75.00, description: 'Per hour' },
    ]
  },
  {
    id: 'fcl',
    label: 'FCL Service — Unloading (Loose-in)',
    fields: [
      { key: 'fcl20GP', label: '20GP container', defaultValue: 300 },
      { key: 'fcl40GP', label: '40GP container', defaultValue: 400 },
      { key: 'fcl40HQ', label: '40HQ container', defaultValue: 450 },
      { key: 'fcl45GP', label: '45GP container', defaultValue: 550 },
    ]
  },
  {
    id: 'overweight',
    label: 'Carton Overweight Charge (per container)',
    fields: [
      { key: 'overweight3049',  label: '30–49 lbs/ctn',  defaultValue: 50 },
      { key: 'overweight5080',  label: '50–80 lbs/ctn',  defaultValue: 100 },
      { key: 'overweight80plus',label: 'Over 80 lbs/ctn', defaultValue: 150 },
    ]
  },
  {
    id: 'palletizing',
    label: 'Palletizing & Sorting',
    fields: [
      { key: 'palletizingFee',  label: 'Palletizing Fee (per pallet)', defaultValue: 25.00, description: 'Standard pallet 48"×40"×72", <1000 lb' },
      { key: 'sortingPerSku',   label: 'Sorting Fee (per item/SKU)',   defaultValue: 15.00 },
      { key: 'sortingTier1000', label: 'Sorting ≥1000 ctns',           defaultValue: 75.00 },
      { key: 'sortingTier1200', label: 'Sorting ≥1200 ctns',           defaultValue: 100.00 },
      { key: 'sortingTier1500', label: 'Sorting ≥1500 ctns',           defaultValue: 150.00 },
      { key: 'sortingTier2000', label: 'Sorting ≥2000 ctns',           defaultValue: 250.00 },
      { key: 'labelFee',        label: 'Label (per label)',            defaultValue: 0.50 },
      { key: 'labelRemoval',    label: 'Label Removal (per label)',    defaultValue: 0.50 },
    ]
  },
  {
    id: 'lcl',
    label: 'LCL Service',
    fields: [
      { key: 'lclReceiving',          label: 'Receiving / Unloading (per pallet)', defaultValue: 15.00 },
      { key: 'repackagingPerCarton',  label: 'Repackaging (per carton/box)',       defaultValue: 2.00 },
      { key: 'repackagingPerPallet',  label: 'Repackaging (per pallet)',           defaultValue: 15.00, description: 'For re-stack, re-work, enhanced shrink wrap' },
      { key: 'looseCartonUnder50',    label: 'Loose Carton Receiving (<50 lbs/ctn)', defaultValue: 5.00 },
      { key: 'looseCartonOver50',     label: 'Loose Carton Receiving (≥50 lbs/ctn)', defaultValue: 10.00 },
    ]
  },
  {
    id: 'storage',
    label: 'Storage (per pallet/month)',
    fields: [
      { key: 'storageStackable',  label: 'Standard Stackable',         defaultValue: 28.00, description: '½ month initial storage if pallet received after 15th; recurring based on snapshot on 1st of month' },
      { key: 'storageOversized',  label: 'Non-Stackable / Oversized',  defaultValue: 0, description: 'Set to 0 if billed by quote' },
    ]
  },
  {
    id: 'documents',
    label: 'Documents',
    fields: [
      { key: 'bolFee', label: 'Bill of Lading (if generated by JCT)', defaultValue: 10.00 },
    ]
  },
]

const ALL_FIELDS = SECTIONS.flatMap(s => s.fields)
const DEFAULT_RATES = ALL_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: f.defaultValue }), {})

// ─── Component ─────────────────────────────────────────────
export default function ServiceRatesEditor({ clientId, clientName, onClose }) {
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [meta, setMeta] = useState({ quoteValidUntil: '', acceptedBy: '', acceptedDate: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set(SECTIONS.map(s => s.id)))

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db, 'clients', clientId))
        if (cancelled) return
        const data = snap.exists() ? snap.data() : {}
        const sr = data.serviceRates || {}
        setRates({ ...DEFAULT_RATES, ...sr })
        setMeta({
          quoteValidUntil: sr.quoteValidUntil || '',
          acceptedBy: sr.acceptedBy || '',
          acceptedDate: sr.acceptedDate || '',
          notes: sr.notes || '',
        })
      } catch (e) {
        console.error('Failed to load service rates', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [clientId])

  const updateRate = (key, value) => {
    setRates(prev => ({ ...prev, [key]: value === '' ? '' : Number(value) }))
    setSavedAt(null)
  }
  const updateMeta = (key, value) => {
    setMeta(prev => ({ ...prev, [key]: value }))
    setSavedAt(null)
  }

  const toggleSection = (id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      // Normalize empty strings to 0 on save
      const normalized = Object.fromEntries(
        Object.entries(rates).map(([k, v]) => [k, v === '' ? 0 : Number(v) || 0])
      )
      const sr = { ...normalized, ...meta, updatedAt: new Date().toISOString() }
      await updateDoc(doc(db, 'clients', clientId), {
        serviceRates: sr,
        rateCard: syncServiceRatesToRateCard(sr),
      })
      setSavedAt(new Date())
    } catch (e) {
      console.error('Save failed', e)
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-gray-500 text-sm">Loading rates…</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <DollarSign size={16} className="text-green-400" /> Service Rates
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">{clientName} — fees billed to this client across all services</p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <Check size={12} /> Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button onClick={save} disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Save size={14} /> {saving ? 'Saving…' : 'Save Rates'}
          </button>
        </div>
      </div>

      {/* Sections */}
      {SECTIONS.map(section => {
        const isOpen = expanded.has(section.id)
        return (
          <div key={section.id} className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
            <button onClick={() => toggleSection(section.id)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/40 transition-colors">
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="text-sm font-semibold text-white">{section.label}</span>
                <span className="text-xs text-gray-500">({section.fields.length} fields)</span>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-gray-800 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {section.fields.map(field => (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label className="text-xs text-gray-300 font-medium">{field.label}</label>
                    {field.description && <p className="text-[11px] text-gray-500">{field.description}</p>}
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={rates[field.key] ?? ''}
                        onChange={(e) => updateRate(field.key, e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 text-white text-sm pl-6 pr-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Quote metadata */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Quote Metadata</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-300 font-medium block mb-1">Quote Valid Until</label>
            <input
              type="date"
              value={meta.quoteValidUntil}
              onChange={(e) => updateMeta('quoteValidUntil', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-300 font-medium block mb-1">Accepted By (Name/Title)</label>
            <input
              type="text"
              value={meta.acceptedBy}
              onChange={(e) => updateMeta('acceptedBy', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-300 font-medium block mb-1">Acceptance Date</label>
            <input
              type="date"
              value={meta.acceptedDate}
              onChange={(e) => updateMeta('acceptedDate', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs text-gray-300 font-medium block mb-1">Internal Notes</label>
          <textarea
            value={meta.notes}
            onChange={(e) => updateMeta('notes', e.target.value)}
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Footer actions */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 flex items-center justify-end gap-2">
        <button onClick={() => generateRateSheetPDF(clientName, rates, meta)}
          className="bg-purple-600 hover:bg-purple-500 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5">
          <Download size={14} /> Download Fillable PDF
        </button>
        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5">
          <Save size={14} /> {saving ? 'Saving…' : 'Save Rates'}
        </button>
      </div>
    </div>
  )
}
