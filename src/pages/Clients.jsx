import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, Pencil, Trash2, Phone, Mail, ChevronDown, ChevronUp } from 'lucide-react'

const emptyForm = {
  // Basic
  companyName: '', contactName: '', email: '', phone: '', startDate: '', notes: '',

  // Storage
  storageType: 'per_pallet',
  billingRate: '',
  freeDays: '',
  splitPeriodDay: '15',
  splitRate1st: '',
  splitRate2nd: '',

  // Receiving
  chargeReceivingFee: false,
  receivingFeeType: 'per_pallet',
  receivingFeeRate: '',

  // Outbound
  chargeOutboundFee: false,
  outboundFeeType: 'per_pallet',
  outboundFeeRate: '',

  // Labeling
  chargeLabelingFee: false,
  labelingFeeRate: '',

  // Special charges defaults
  specialLaborRate: '',

  // Materials defaults
  materialsPalletRate: '',
  materialsLabelRate: '',
  materialsBoxSmallRate: '',
  materialsBoxMedRate: '',
  materialsBoxLgRate: '',

  // GL Accounts
  glStorage: '',
  glHandling: '',
  glReceiving: '',
  glOutbound: '',
  glFreightPrepaid: '',
  glFreight3rd: '',
  glSpecial: '',
  glMaterials: '',
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500'
const labelCls = 'text-gray-400 text-xs mb-1 block'

export default function Clients() {
  const [clients, setClients] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [modalTab, setModalTab] = useState('basic')

  const fetchClients = async () => {
    const snap = await getDocs(collection(db, 'clients'))
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    data.sort((a, b) => a.companyName.localeCompare(b.companyName))
    setClients(data)
  }

  useEffect(() => { fetchClients() }, [])

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async () => {
    if (!form.companyName.trim()) return
    setLoading(true)
    try {
      if (editId) {
        await updateDoc(doc(db, 'clients', editId), form)
      } else {
        await addDoc(collection(db, 'clients'), { ...form, createdAt: new Date().toISOString() })
      }
      setForm(emptyForm); setEditId(null); setShowModal(false)
      fetchClients()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const handleEdit = (client) => {
    setForm({ ...emptyForm, ...client })
    setEditId(client.id); setModalTab('basic'); setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this client?')) return
    await deleteDoc(doc(db, 'clients', id)); fetchClients()
  }

  const filtered = clients.filter(c =>
    c.companyName?.toLowerCase().includes(search.toLowerCase()) ||
    c.contactName?.toLowerCase().includes(search.toLowerCase())
  )

  const FeeSection = ({ title, enabledKey, children }) => (
    <div className="border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white text-sm font-medium">{title}</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form[enabledKey]}
            onChange={e => set(enabledKey, e.target.checked)}
            className="w-4 h-4 accent-blue-500" />
          <span className="text-gray-400 text-xs">Enable</span>
        </label>
      </div>
      {form[enabledKey] && children}
    </div>
  )

  const MODAL_TABS = ['basic', 'storage', 'fees', 'rates', 'gl']
  const MODAL_TAB_LABELS = {
    basic: 'Basic Info', storage: 'Storage', fees: 'Fees',
    rates: 'Default Rates', gl: 'GL Accounts'
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Clients</h2>
          <p className="text-sm text-gray-500 mt-0.5">{clients.length} total clients</p>
        </div>
        <button onClick={() => { setForm(emptyForm); setEditId(null); setModalTab('basic'); setShowModal(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus size={16} /> Add Client
        </button>
      </div>

      <input type="text" placeholder="Search clients..." value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-sm bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:border-blue-500" />

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Company</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Contact</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Email / Phone</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Storage</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Fees</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Since</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-500 py-12">No clients yet</td></tr>
            ) : filtered.map((client, i) => (
              <>
                <tr key={client.id}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                  <td className="px-4 py-3 text-white font-medium">{client.companyName}</td>
                  <td className="px-4 py-3 text-gray-300">{client.contactName}</td>
                  <td className="px-4 py-3 text-gray-300">
                    <div className="flex flex-col gap-0.5">
                      {client.email && <a href={`mailto:${client.email}`} className="flex items-center gap-1 hover:text-blue-400 text-xs"><Mail size={11}/>{client.email}</a>}
                      {client.phone && <span className="flex items-center gap-1 text-xs"><Phone size={11}/>{client.phone}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-purple-500/10 text-purple-400 border-purple-500/20 w-fit">
                        {client.storageType === 'per_sku' ? 'Per SKU' : `$${client.billingRate || '—'}/pallet`}
                      </span>
                      {client.freeDays > 0 && (
                        <span className="text-xs text-gray-500">{client.freeDays} free days</span>
                      )}
                      {client.splitRate1st && (
                        <span className="text-xs text-gray-500">Split: ${client.splitRate1st}/${ client.splitRate2nd}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {client.chargeReceivingFee && <span className="text-xs text-blue-400">Recv: ${client.receivingFeeRate}/{client.receivingFeeType?.replace('per_','')}</span>}
                      {client.chargeOutboundFee && <span className="text-xs text-orange-400">Out: ${client.outboundFeeRate}/{client.outboundFeeType?.replace('per_','')}</span>}
                      {client.chargeLabelingFee && <span className="text-xs text-pink-400">Label: ${client.labelingFeeRate}/unit</span>}
                      {!client.chargeReceivingFee && !client.chargeOutboundFee && !client.chargeLabelingFee && (
                        <span className="text-gray-600 text-xs">Storage only</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{client.startDate}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setExpandedId(expandedId === client.id ? null : client.id)}
                        className="text-gray-400 hover:text-white p-1 rounded transition-colors">
                        {expandedId === client.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                      </button>
                      <button onClick={() => handleEdit(client)} className="text-gray-400 hover:text-white p-1 rounded transition-colors"><Pencil size={14}/></button>
                      <button onClick={() => handleDelete(client.id)} className="text-gray-400 hover:text-red-400 p-1 rounded transition-colors"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
                {expandedId === client.id && (
                  <tr key={`${client.id}-exp`} className="bg-gray-800/30">
                    <td colSpan={7} className="px-6 py-4">
                      <div className="grid grid-cols-4 gap-4 text-xs mb-3">
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide">Storage</p>
                          <p className="text-white">{client.storageType === 'per_sku' ? 'Per SKU (catalog)' : `$${client.billingRate||'—'}/pallet/mo`}</p>
                          {client.freeDays > 0 && <p className="text-gray-400">{client.freeDays} free days</p>}
                          {client.splitRate1st && <p className="text-gray-400">Split day {client.splitPeriodDay}: ${client.splitRate1st} / ${client.splitRate2nd}</p>}
                        </div>
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide">Fees</p>
                          <p className="text-white">{client.chargeReceivingFee ? `Recv $${client.receivingFeeRate}/${client.receivingFeeType?.replace('per_','')}` : 'No receiving fee'}</p>
                          <p className="text-white">{client.chargeOutboundFee ? `Out $${client.outboundFeeRate}/${client.outboundFeeType?.replace('per_','')}` : 'No outbound fee'}</p>
                          <p className="text-white">{client.chargeLabelingFee ? `Label $${client.labelingFeeRate}/unit` : 'No labeling fee'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide">Default Rates</p>
                          {client.specialLaborRate && <p className="text-white">Labor: ${client.specialLaborRate}/hr</p>}
                          {client.materialsPalletRate && <p className="text-white">Pallet: ${client.materialsPalletRate}</p>}
                          {client.materialsLabelRate && <p className="text-white">Label: ${client.materialsLabelRate}</p>}
                        </div>
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide">GL Accounts</p>
                          {client.glStorage && <p className="text-yellow-400 font-mono">Storage: {client.glStorage}</p>}
                          {client.glHandling && <p className="text-yellow-400 font-mono">Handling: {client.glHandling}</p>}
                          {client.glReceiving && <p className="text-yellow-400 font-mono">Receiving: {client.glReceiving}</p>}
                          {client.glOutbound && <p className="text-yellow-400 font-mono">Outbound: {client.glOutbound}</p>}
                          {!client.glStorage && !client.glHandling && !client.glReceiving && <p className="text-gray-600">None configured</p>}
                        </div>
                      </div>
                      {client.notes && <p className="text-gray-400 text-xs border-t border-gray-700 pt-3">{client.notes}</p>}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 overflow-y-auto py-8">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">{editId ? 'Edit Client' : 'Add New Client'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={18}/></button>
            </div>

            {/* Modal tabs */}
            <div className="flex gap-0 border-b border-gray-800 px-6">
              {MODAL_TABS.map(t => (
                <button key={t} onClick={() => setModalTab(t)}
                  className={`px-4 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
                    modalTab === t ? 'text-blue-400 border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'
                  }`}>
                  {MODAL_TAB_LABELS[t]}
                </button>
              ))}
            </div>

            <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">

              {/* Basic Info */}
              {modalTab === 'basic' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className={labelCls}>Company Name *</label>
                    <input value={form.companyName} onChange={e => set('companyName', e.target.value)} className={inputCls} placeholder="ABC Company"/>
                  </div>
                  <div>
                    <label className={labelCls}>Contact Name</label>
                    <input value={form.contactName} onChange={e => set('contactName', e.target.value)} className={inputCls} placeholder="John Smith"/>
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} placeholder="(909) 555-0000"/>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Email</label>
                    <input value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} placeholder="contact@company.com"/>
                  </div>
                  <div>
                    <label className={labelCls}>Start Date</label>
                    <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className={inputCls}/>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Notes</label>
                    <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Special instructions..."/>
                  </div>
                </div>
              )}

              {/* Storage */}
              {modalTab === 'storage' && (
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Billing Method</label>
                    <select value={form.storageType} onChange={e => set('storageType', e.target.value)} className={inputCls}>
                      <option value="per_pallet">Per pallet / month (flat rate)</option>
                      <option value="per_sku">Per SKU (rates set in Items catalog)</option>
                    </select>
                  </div>
                  {form.storageType === 'per_pallet' && (
                    <div>
                      <label className={labelCls}>Standard Rate ($ per pallet / month)</label>
                      <input type="number" value={form.billingRate} onChange={e => set('billingRate', e.target.value)} className={inputCls} placeholder="25.00"/>
                    </div>
                  )}

                  <div className="border border-gray-700 rounded-xl p-4 space-y-3">
                    <p className="text-white text-sm font-medium">Free Days</p>
                    <div>
                      <label className={labelCls}>Free days before storage starts (0 = charge from day 1)</label>
                      <input type="number" value={form.freeDays} onChange={e => set('freeDays', e.target.value)} className={inputCls} placeholder="0"/>
                    </div>
                  </div>

                  <div className="border border-gray-700 rounded-xl p-4 space-y-3">
                    <p className="text-white text-sm font-medium">Split Period Storage</p>
                    <p className="text-gray-500 text-xs">Charge a different rate depending on which half of the month inventory is received.</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={labelCls}>Split Day</label>
                        <input type="number" value={form.splitPeriodDay} onChange={e => set('splitPeriodDay', e.target.value)} className={inputCls} placeholder="15"/>
                      </div>
                      <div>
                        <label className={labelCls}>1st Half Rate ($/pallet)</label>
                        <input type="number" value={form.splitRate1st} onChange={e => set('splitRate1st', e.target.value)} className={inputCls} placeholder="25.00"/>
                      </div>
                      <div>
                        <label className={labelCls}>2nd Half Rate ($/pallet)</label>
                        <input type="number" value={form.splitRate2nd} onChange={e => set('splitRate2nd', e.target.value)} className={inputCls} placeholder="12.50"/>
                      </div>
                    </div>
                    <p className="text-gray-600 text-xs">Leave blank to use standard rate for all receipts.</p>
                  </div>
                </div>
              )}

              {/* Fees */}
              {modalTab === 'fees' && (
                <div className="space-y-4">
                  <FeeSection title="Receiving Fee" enabledKey="chargeReceivingFee">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Fee Type</label>
                        <select value={form.receivingFeeType} onChange={e => set('receivingFeeType', e.target.value)} className={inputCls}>
                          <option value="per_pallet">Per pallet received</option>
                          <option value="per_unit">Per unit received</option>
                          <option value="per_receipt">Per receipt (flat)</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Rate ($)</label>
                        <input type="number" value={form.receivingFeeRate} onChange={e => set('receivingFeeRate', e.target.value)} className={inputCls} placeholder="10.00"/>
                      </div>
                    </div>
                  </FeeSection>

                  <FeeSection title="Outbound / Handling Fee" enabledKey="chargeOutboundFee">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Fee Type</label>
                        <select value={form.outboundFeeType} onChange={e => set('outboundFeeType', e.target.value)} className={inputCls}>
                          <option value="per_pallet">Per pallet shipped</option>
                          <option value="per_unit">Per unit shipped</option>
                          <option value="per_order">Per order (flat fee)</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Rate ($)</label>
                        <input type="number" value={form.outboundFeeRate} onChange={e => set('outboundFeeRate', e.target.value)} className={inputCls} placeholder="15.00"/>
                      </div>
                    </div>
                  </FeeSection>

                  <FeeSection title="Labeling / Special Projects" enabledKey="chargeLabelingFee">
                    <div>
                      <label className={labelCls}>Default Rate ($ per unit)</label>
                      <input type="number" value={form.labelingFeeRate} onChange={e => set('labelingFeeRate', e.target.value)} className={inputCls} placeholder="0.50"/>
                    </div>
                  </FeeSection>
                </div>
              )}

              {/* Default Rates */}
              {modalTab === 'rates' && (
                <div className="space-y-4">
                  <p className="text-gray-400 text-xs">These rates auto-fill when adding charges in the Billing Wizard.</p>

                  <div className="border border-gray-700 rounded-xl p-4 space-y-3">
                    <p className="text-white text-sm font-medium">Special Charges</p>
                    <div>
                      <label className={labelCls}>Labor Rate ($ / hour)</label>
                      <input type="number" value={form.specialLaborRate} onChange={e => set('specialLaborRate', e.target.value)} className={inputCls} placeholder="45.00"/>
                    </div>
                  </div>

                  <div className="border border-gray-700 rounded-xl p-4 space-y-3">
                    <p className="text-white text-sm font-medium">Materials</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Pallet ($ each)</label>
                        <input type="number" value={form.materialsPalletRate} onChange={e => set('materialsPalletRate', e.target.value)} className={inputCls} placeholder="10.00"/>
                      </div>
                      <div>
                        <label className={labelCls}>Label ($ each)</label>
                        <input type="number" value={form.materialsLabelRate} onChange={e => set('materialsLabelRate', e.target.value)} className={inputCls} placeholder="0.25"/>
                      </div>
                      <div>
                        <label className={labelCls}>Box Small ($ each)</label>
                        <input type="number" value={form.materialsBoxSmallRate} onChange={e => set('materialsBoxSmallRate', e.target.value)} className={inputCls} placeholder="1.25"/>
                      </div>
                      <div>
                        <label className={labelCls}>Box Medium ($ each)</label>
                        <input type="number" value={form.materialsBoxMedRate} onChange={e => set('materialsBoxMedRate', e.target.value)} className={inputCls} placeholder="2.00"/>
                      </div>
                      <div>
                        <label className={labelCls}>Box Large ($ each)</label>
                        <input type="number" value={form.materialsBoxLgRate} onChange={e => set('materialsBoxLgRate', e.target.value)} className={inputCls} placeholder="3.00"/>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* GL Accounts */}
              {modalTab === 'gl' && (
                <div className="space-y-4">
                  <p className="text-gray-400 text-xs">GL account numbers appear on invoice line items and Excel exports for accounting integration.</p>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      ['glStorage',       'Storage'],
                      ['glHandling',      'Handling'],
                      ['glReceiving',     'Receiving'],
                      ['glOutbound',      'Outbound / Shipping'],
                      ['glFreightPrepaid','Freight Prepaid'],
                      ['glFreight3rd',    'Freight 3rd Party'],
                      ['glSpecial',       'Special Charges'],
                      ['glMaterials',     'Materials'],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label className={labelCls}>{label}</label>
                        <input value={form[key]} onChange={e => set(key, e.target.value)}
                          className={inputCls} placeholder="e.g. 4010"/>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSubmit} disabled={loading || !form.companyName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                {loading ? 'Saving...' : editId ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}