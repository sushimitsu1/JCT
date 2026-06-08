import { useState } from 'react'
import { X, Download, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { generateRateSheetPDF } from '../lib/rateSheetPDF'

// Section definitions — must match ServiceRatesEditor + rateSheetPDF
const SECTIONS = [
  {
    id: 'outbound', label: 'Outbound Services',
    fields: [
      { key: 'ecomOutboundFee',       label: 'E-commerce Outbound Processing Fee', defaultValue: 1.50 },
      { key: 'ecomAdditionalUnit',    label: 'Handling Price Per Additional Unit', defaultValue: 0.50 },
      { key: 'outboundProcessing',    label: 'Outbound Processing Fee',             defaultValue: 5.00 },
      { key: 'handlingPerCase',       label: 'Handling Price Per Case',             defaultValue: 2.00 },
      { key: 'palletLoading',         label: 'Pallet Loading',                      defaultValue: 15.00 },
      { key: 'pickByPallet',          label: 'Pick by Pallet',                      defaultValue: 8.00 },
      { key: 'labeling',              label: 'Labeling',                            defaultValue: 0.50 },
      { key: 'photo',                 label: 'Photo',                               defaultValue: 1.00 },
      { key: 'measurementUnit',       label: 'Measurement (unit or carton)',        defaultValue: 2.00 },
      { key: 'measurementPallet',     label: 'Measurement (pallet)',                defaultValue: 5.00 },
      { key: 'additionalDocuments',   label: 'Additional Documents',                defaultValue: 5.00 },
      { key: 'hourlyLabor',           label: 'Hourly Labor',                        defaultValue: 75.00 },
    ]
  },
  {
    id: 'fcl', label: 'FCL Unloading',
    fields: [
      { key: 'fcl20GP', label: '20GP container', defaultValue: 300 },
      { key: 'fcl40GP', label: '40GP container', defaultValue: 400 },
      { key: 'fcl40HQ', label: '40HQ container', defaultValue: 450 },
      { key: 'fcl45GP', label: '45GP container', defaultValue: 550 },
    ]
  },
  {
    id: 'overweight', label: 'Carton Overweight (per container)',
    fields: [
      { key: 'overweight3049',  label: '30–49 lbs/ctn',  defaultValue: 50 },
      { key: 'overweight5080',  label: '50–80 lbs/ctn',  defaultValue: 100 },
      { key: 'overweight80plus',label: 'Over 80 lbs/ctn', defaultValue: 150 },
    ]
  },
  {
    id: 'palletizing', label: 'Palletizing & Sorting',
    fields: [
      { key: 'palletizingFee',  label: 'Palletizing (per pallet)', defaultValue: 25 },
      { key: 'sortingPerSku',   label: 'Sorting (per SKU)',        defaultValue: 15 },
      { key: 'sortingTier1000', label: 'Sorting ≥1000 ctns',       defaultValue: 75 },
      { key: 'sortingTier1200', label: 'Sorting ≥1200 ctns',       defaultValue: 100 },
      { key: 'sortingTier1500', label: 'Sorting ≥1500 ctns',       defaultValue: 150 },
      { key: 'sortingTier2000', label: 'Sorting ≥2000 ctns',       defaultValue: 250 },
      { key: 'labelFee',        label: 'Label (per label)',        defaultValue: 0.5 },
      { key: 'labelRemoval',    label: 'Label Removal',            defaultValue: 0.5 },
    ]
  },
  {
    id: 'lcl', label: 'LCL Service',
    fields: [
      { key: 'lclReceiving',          label: 'Receiving / Unloading (per pallet)', defaultValue: 15 },
      { key: 'repackagingPerCarton',  label: 'Repackaging (per carton)',           defaultValue: 2 },
      { key: 'repackagingPerPallet',  label: 'Repackaging (per pallet)',           defaultValue: 15 },
      { key: 'looseCartonUnder50',    label: 'Loose Carton (<50 lbs)',             defaultValue: 5 },
      { key: 'looseCartonOver50',     label: 'Loose Carton (≥50 lbs)',             defaultValue: 10 },
    ]
  },
  {
    id: 'storage', label: 'Storage (per pallet/month)',
    fields: [
      { key: 'storageStackable', label: 'Standard Stackable',         defaultValue: 28 },
      { key: 'storageOversized', label: 'Non-Stackable / Oversized',  defaultValue: 0 },
    ]
  },
  {
    id: 'documents', label: 'Documents',
    fields: [
      { key: 'bolFee', label: 'Bill of Lading', defaultValue: 10 },
    ]
  },
]

const DEFAULT_RATES = SECTIONS.flatMap(s => s.fields).reduce(
  (acc, f) => ({ ...acc, [f.key]: f.defaultValue }), {}
)

export default function RateCardGenerator({ onClose }) {
  const [prospectName, setProspectName] = useState('')
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [meta, setMeta] = useState({ quoteValidUntil: '', notes: '' })
  const [expanded, setExpanded] = useState(new Set(['outbound']))

  const updateRate = (k, v) => setRates(p => ({ ...p, [k]: v === '' ? '' : Number(v) }))
  const toggle = (id) => setExpanded(p => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const download = () => {
    const name = prospectName.trim() || 'Prospect'
    generateRateSheetPDF(name, rates, meta)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col"
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-purple-400" />
            <div>
              <h3 className="text-base font-semibold text-white">Generate Rate Card</h3>
              <p className="text-xs text-gray-400">Standalone — for prospects before onboarding</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Prospect name */}
        <div className="px-5 py-3 border-b border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-300 font-medium block mb-1">Prospect / Company Name</label>
            <input value={prospectName} onChange={(e) => setProspectName(e.target.value)}
              placeholder="e.g. Acme Logistics LLC"
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-300 font-medium block mb-1">Quote Valid Until</label>
            <input type="date" value={meta.quoteValidUntil}
              onChange={(e) => setMeta(p => ({ ...p, quoteValidUntil: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500" />
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {SECTIONS.map(section => {
            const isOpen = expanded.has(section.id)
            return (
              <div key={section.id} className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
                <button onClick={() => toggle(section.id)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-800/40">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                    <span className="text-sm font-semibold text-white">{section.label}</span>
                    <span className="text-xs text-gray-500">({section.fields.length})</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-800 p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {section.fields.map(f => (
                      <div key={f.key} className="flex items-center gap-2">
                        <label className="text-xs text-gray-300 flex-1">{f.label}</label>
                        <div className="relative w-24">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                          <input type="number" step="0.01" value={rates[f.key] ?? ''}
                            onChange={(e) => updateRate(f.key, e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 text-white text-sm pl-5 pr-2 py-1 rounded focus:outline-none focus:border-blue-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex justify-between items-center">
          <p className="text-xs text-gray-500">Tip: send the PDF to the prospect, then onboard them with the signed copy.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-gray-300 hover:text-white px-3 py-1.5">Close</button>
            <button onClick={download}
              className="bg-purple-600 hover:bg-purple-500 text-white text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <Download size={14} /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
