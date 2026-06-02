import { useState } from 'react'
import { Plus, X, ChevronDown } from 'lucide-react'

const WIZARD_TABS = ['Handling', 'Storage', 'Freight Prepaid', 'Freight 3rd Party', 'Special Charges', 'Materials']

const inputCls = 'bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500'

// Preset charge templates per tab
const PRESETS = {
  Handling: [
    { label: 'Receiving Handling', unit: 'pallet' },
    { label: 'Shipping Handling', unit: 'pallet' },
    { label: 'Container Unload', unit: 'container' },
    { label: 'Sort & Segregate', unit: 'hour' },
  ],
  Storage: [
    { label: 'Recurring Storage', unit: 'pallet' },
    { label: 'Split Period Storage (1st Half)', unit: 'pallet' },
    { label: 'Split Period Storage (2nd Half)', unit: 'pallet' },
    { label: 'Overflow Storage', unit: 'pallet' },
  ],
  'Freight Prepaid': [
    { label: 'Local Truck', unit: 'shipment' },
    { label: 'Drayage', unit: 'container' },
    { label: 'Long Haul', unit: 'shipment' },
    { label: 'Fuel Surcharge', unit: 'shipment' },
  ],
  'Freight 3rd Party': [
    { label: 'UPS Ground', unit: 'package' },
    { label: 'FedEx Ground', unit: 'package' },
    { label: 'LTL Freight', unit: 'shipment' },
    { label: 'Courier', unit: 'shipment' },
  ],
  'Special Charges': [
    { label: 'Labor', unit: 'hour' },
    { label: 'Routing', unit: 'order' },
    { label: 'ASN Fee', unit: 'order' },
    { label: 'Restocking', unit: 'pallet' },
    { label: 'Cancellation Fee', unit: 'order' },
    { label: 'Repack / Rework', unit: 'hour' },
  ],
  Materials: [
    { label: 'Pallet', unit: 'pallet' },
    { label: 'Label', unit: 'label' },
    { label: 'Box — Small', unit: 'box' },
    { label: 'Box — Medium', unit: 'box' },
    { label: 'Box — Large', unit: 'box' },
    { label: 'Stretch Wrap', unit: 'roll' },
  ],
}

const CATEGORY_MAP = {
  'Handling':         'handling',
  'Storage':          'storage',
  'Freight Prepaid':  'freight_prepaid',
  'Freight 3rd Party':'freight_3rd',
  'Special Charges':  'special',
  'Materials':        'materials',
}

export default function BillingWizard({ client, wizardLines, setWizardLines, month, year }) {
  const [activeTab, setActiveTab] = useState('Handling')
  const [showPresets, setShowPresets] = useState(false)

  const tabLines = wizardLines.filter(l => l.wizardTab === activeTab)
  const otherLines = wizardLines.filter(l => l.wizardTab !== activeTab)

  const glKey = {
    'Handling':          'glHandling',
    'Storage':           'glStorage',
    'Freight Prepaid':   'glFreightPrepaid',
    'Freight 3rd Party': 'glFreight3rd',
    'Special Charges':   'glSpecial',
    'Materials':         'glMaterials',
  }[activeTab]

  const glCode = client?.[glKey] || ''

  const addLine = (preset = {}) => {
    const newLine = {
      id: Date.now(),
      wizardTab: activeTab,
      category: CATEGORY_MAP[activeTab],
      description: preset.label || '',
      quantity: 1,
      unit: preset.unit || '',
      rate: preset.rate || 0,
      amount: preset.rate || 0,
      glCode,
      note: ''
    }
    setWizardLines([...wizardLines, newLine])
    setShowPresets(false)
  }

  const updateLine = (id, field, value) => {
    setWizardLines(wizardLines.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      if (field === 'quantity' || field === 'rate') {
        updated.amount = Number((Number(updated.quantity || 0) * Number(updated.rate || 0)).toFixed(2))
      }
      if (field === 'amount') updated.amount = Number(value)
      return updated
    }))
  }

  const removeLine = (id) => setWizardLines(wizardLines.filter(l => l.id !== id))

  const tabTotal = (tab) =>
    wizardLines.filter(l => l.wizardTab === tab)
      .reduce((s, l) => s + Number(l.amount || 0), 0)

  const grandTotal = wizardLines.reduce((s, l) => s + Number(l.amount || 0), 0)

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap border-b border-gray-800 pb-0">
        {WIZARD_TABS.map(tab => {
          const t = tabTotal(tab)
          return (
            <button key={tab} onClick={() => { setActiveTab(tab); setShowPresets(false) }}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors relative ${
                activeTab === tab
                  ? 'bg-gray-800 text-white border border-b-0 border-gray-700'
                  : 'text-gray-500 hover:text-gray-300'
              }`}>
              {tab}
              {t > 0 && (
                <span className="ml-1.5 text-xs text-green-400 font-semibold">${t.toFixed(0)}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* GL code banner */}
      <div className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">GL Account:</span>
          <span className="text-xs font-mono text-yellow-400 font-medium">
            {glCode || <span className="text-gray-600 italic">Not set — configure in Client profile</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <Plus size={12} /> Add from presets
            <ChevronDown size={12} className={showPresets ? 'rotate-180' : ''} />
          </button>
          <button onClick={() => addLine()}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
            <Plus size={12} /> Blank line
          </button>
        </div>
      </div>

      {/* Preset picker */}
      {showPresets && (
        <div className="grid grid-cols-3 gap-2 bg-gray-800/30 rounded-xl p-3 border border-gray-700">
          {PRESETS[activeTab]?.map(p => {
            // Try to pull default rate from client profile
            const rateKey = {
              'Pallet':                 'materialsPalletRate',
              'Label':                  'materialsLabelRate',
              'Box — Small':            'materialsBoxSmallRate',
              'Box — Medium':           'materialsBoxMedRate',
              'Box — Large':            'materialsBoxLgRate',
              'Receiving Handling':     'receivingFeeRate',
              'Shipping Handling':      'outboundFeeRate',
              'Recurring Storage':      'billingRate',
              'Labor':                  'specialLaborRate',
            }[p.label]
            const rate = rateKey && client?.[rateKey] ? Number(client[rateKey]) : 0
            return (
              <button key={p.label} onClick={() => addLine({ ...p, rate })}
                className="text-left bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 transition-colors">
                <p className="text-white text-xs font-medium">{p.label}</p>
                <p className="text-gray-500 text-xs">per {p.unit}{rate > 0 ? ` · $${rate}` : ''}</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Line items for this tab */}
      {tabLines.length === 0 ? (
        <div className="text-center py-6 text-gray-600 text-xs">
          No {activeTab.toLowerCase()} charges yet — add from presets or blank line
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-1 text-gray-500 text-xs">
            <div className="col-span-4">Description</div>
            <div className="col-span-1">Qty</div>
            <div className="col-span-1">Unit</div>
            <div className="col-span-2">Rate ($)</div>
            <div className="col-span-2">Amount ($)</div>
            <div className="col-span-1">GL</div>
            <div className="col-span-1"></div>
          </div>

          {tabLines.map(line => (
            <div key={line.id} className="grid grid-cols-12 gap-2 items-center">
              <input value={line.description} onChange={e => updateLine(line.id, 'description', e.target.value)}
                className={`col-span-4 ${inputCls}`} placeholder="Description" />
              <input type="number" value={line.quantity} onChange={e => updateLine(line.id, 'quantity', e.target.value)}
                className={`col-span-1 ${inputCls}`} />
              <input value={line.unit} onChange={e => updateLine(line.id, 'unit', e.target.value)}
                className={`col-span-1 ${inputCls}`} placeholder="pallet" />
              <input type="number" value={line.rate} onChange={e => updateLine(line.id, 'rate', e.target.value)}
                className={`col-span-2 ${inputCls}`} />
              <input type="number" value={line.amount} onChange={e => updateLine(line.id, 'amount', e.target.value)}
                className={`col-span-2 ${inputCls}`} />
              <input value={line.glCode} onChange={e => updateLine(line.id, 'glCode', e.target.value)}
                className={`col-span-1 ${inputCls}`} placeholder="GL#" />
              <button onClick={() => removeLine(line.id)}
                className="col-span-1 text-gray-600 hover:text-red-400 flex justify-center">
                <X size={13} />
              </button>
            </div>
          ))}

          <div className="flex justify-end pt-1">
            <span className="text-xs text-gray-400">
              {activeTab} subtotal: <span className="text-white font-semibold">${tabTotal(activeTab).toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}

      {/* Grand total across all wizard tabs */}
      {grandTotal > 0 && (
        <div className="border-t border-gray-800 pt-3 flex justify-between items-center">
          <div className="flex gap-3 flex-wrap">
            {WIZARD_TABS.map(tab => {
              const t = tabTotal(tab)
              if (t === 0) return null
              return (
                <span key={tab} className="text-xs text-gray-500">
                  {tab}: <span className="text-gray-300">${t.toFixed(2)}</span>
                </span>
              )
            })}
          </div>
          <span className="text-sm font-semibold text-white">
            Wizard Total: ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  )
}