// Maps each serviceRates key to a rateCard row template.
// rateCard rows: { id, label, category, unit, rate, glCode, trigger }
// trigger: 'on_receive' | 'on_ship' | 'both' | 'manual'
// category: 'Handling' | 'Storage' | 'Freight Prepaid' | 'Freight 3rd Party' | 'Special' | 'Materials'
// unit:     'pallet' | 'unit' | 'carton' | 'order' | 'receipt' | 'hour' | 'label' | 'box'

const RATE_MAP = [
  // ─── Outbound ─────────────────────────────────────────────
  { key: 'ecomOutboundFee',      label: 'E-commerce Outbound Processing', category: 'Handling', unit: 'order',   trigger: 'on_ship' },
  { key: 'ecomAdditionalUnit',   label: 'E-commerce Additional Unit',     category: 'Handling', unit: 'unit',    trigger: 'on_ship' },
  { key: 'outboundProcessing',   label: 'Outbound Processing Fee',        category: 'Handling', unit: 'order',   trigger: 'on_ship' },
  { key: 'handlingPerCase',      label: 'Handling Per Case',              category: 'Handling', unit: 'carton',  trigger: 'on_ship' },
  { key: 'palletLoading',        label: 'Pallet Loading',                 category: 'Handling', unit: 'pallet',  trigger: 'on_ship' },
  { key: 'pickByPallet',         label: 'Pick by Pallet',                 category: 'Handling', unit: 'pallet',  trigger: 'on_ship' },
  { key: 'labeling',             label: 'Labeling',                       category: 'Handling', unit: 'label',   trigger: 'manual' },
  { key: 'photo',                label: 'Photo',                          category: 'Special',  unit: 'unit',    trigger: 'manual' },
  { key: 'measurementUnit',      label: 'Measurement (unit/carton)',      category: 'Special',  unit: 'unit',    trigger: 'manual' },
  { key: 'measurementPallet',    label: 'Measurement (pallet)',           category: 'Special',  unit: 'pallet',  trigger: 'manual' },
  { key: 'additionalDocuments',  label: 'Additional Documents',           category: 'Special',  unit: 'order',   trigger: 'manual' },
  { key: 'hourlyLabor',          label: 'Hourly Labor',                   category: 'Special',  unit: 'hour',    trigger: 'manual' },

  // ─── FCL Unloading ────────────────────────────────────────
  { key: 'fcl20GP', label: 'FCL 20GP Unloading', category: 'Handling', unit: 'receipt', trigger: 'on_receive' },
  { key: 'fcl40GP', label: 'FCL 40GP Unloading', category: 'Handling', unit: 'receipt', trigger: 'on_receive' },
  { key: 'fcl40HQ', label: 'FCL 40HQ Unloading', category: 'Handling', unit: 'receipt', trigger: 'on_receive' },
  { key: 'fcl45GP', label: 'FCL 45GP Unloading', category: 'Handling', unit: 'receipt', trigger: 'on_receive' },

  // ─── Carton Overweight ────────────────────────────────────
  { key: 'overweight3049',   label: 'Carton Overweight 30-49 lbs', category: 'Handling', unit: 'receipt', trigger: 'manual' },
  { key: 'overweight5080',   label: 'Carton Overweight 50-80 lbs', category: 'Handling', unit: 'receipt', trigger: 'manual' },
  { key: 'overweight80plus', label: 'Carton Overweight 80+ lbs',   category: 'Handling', unit: 'receipt', trigger: 'manual' },

  // ─── Palletizing & Sorting ────────────────────────────────
  { key: 'palletizingFee',   label: 'Palletizing',           category: 'Handling', unit: 'pallet',  trigger: 'on_receive' },
  { key: 'sortingPerSku',    label: 'Sorting per SKU',       category: 'Handling', unit: 'unit',    trigger: 'manual' },
  { key: 'sortingTier1000',  label: 'Sorting >=1000 ctns',   category: 'Handling', unit: 'receipt', trigger: 'manual' },
  { key: 'sortingTier1200',  label: 'Sorting >=1200 ctns',   category: 'Handling', unit: 'receipt', trigger: 'manual' },
  { key: 'sortingTier1500',  label: 'Sorting >=1500 ctns',   category: 'Handling', unit: 'receipt', trigger: 'manual' },
  { key: 'sortingTier2000',  label: 'Sorting >=2000 ctns',   category: 'Handling', unit: 'receipt', trigger: 'manual' },
  { key: 'labelFee',         label: 'Label',                 category: 'Handling', unit: 'label',   trigger: 'manual' },
  { key: 'labelRemoval',     label: 'Label Removal',         category: 'Handling', unit: 'label',   trigger: 'manual' },

  // ─── LCL Service ──────────────────────────────────────────
  { key: 'lclReceiving',         label: 'LCL Receiving',           category: 'Handling', unit: 'pallet', trigger: 'on_receive' },
  { key: 'repackagingPerCarton', label: 'Repackaging per Carton',  category: 'Handling', unit: 'carton', trigger: 'manual' },
  { key: 'repackagingPerPallet', label: 'Repackaging per Pallet',  category: 'Handling', unit: 'pallet', trigger: 'manual' },
  { key: 'looseCartonUnder50',   label: 'Loose Carton <50 lbs',    category: 'Handling', unit: 'carton', trigger: 'on_receive' },
  { key: 'looseCartonOver50',    label: 'Loose Carton >=50 lbs',   category: 'Handling', unit: 'carton', trigger: 'on_receive' },

  // ─── Storage ──────────────────────────────────────────────
  { key: 'storageStackable', label: 'Storage - Stackable',          category: 'Storage', unit: 'pallet', trigger: 'manual' },
  { key: 'storageOversized', label: 'Storage - Non-Stack/Oversize', category: 'Storage', unit: 'pallet', trigger: 'manual' },

  // ─── Documents ────────────────────────────────────────────
  { key: 'bolFee', label: 'Bill of Lading', category: 'Special', unit: 'order', trigger: 'on_ship' },
]

/**
 * Generate rateCard rows from serviceRates. Only includes non-zero rates.
 * @param {Object} serviceRates - keyed by serviceRate field name
 * @returns {Array} rateCard rows
 */
export function syncServiceRatesToRateCard(serviceRates = {}) {
  const rows = []
  let idCounter = Date.now()
  RATE_MAP.forEach(m => {
    const rate = Number(serviceRates[m.key] || 0)
    if (rate > 0) {
      rows.push({
        id: idCounter++,
        label: m.label,
        category: m.category,
        unit: m.unit,
        rate: rate.toFixed(2),
        glCode: '',
        trigger: m.trigger,
        sourceKey: m.key,  // for tracing back to service rate field
      })
    }
  })
  return rows
}
