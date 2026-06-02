import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Plus, X, Pencil, Trash2, Phone, Mail, ChevronDown, ChevronUp } from 'lucide-react'

const emptyForm = {
  companyName: '', contactName: '', email: '', phone: '', startDate: '', notes: '',
  storageType: 'per_pallet',
  billingRate: '',
  freeDays: '',
  splitPeriodDay: '15',
  splitRate1st: '',
  splitRate2nd: '',
  chargeReceivingFee: false,
  receivingFeeType: 'per_pallet',
  receivingFeeRate: '',
  chargeOutboundFee: false,
  outboundFeeType: 'per_pallet',
  outboundFeeRate: '',
  chargeLabelingFee: false,
  labelingFeeRate: '',
  specialLaborRate: '',
  materialsPalletRate: '',
  materialsLabelRate: '',
  materialsBoxSmallRate: '',
  materialsBoxMedRate: '',
  materialsBoxLgRate: '',
  glStorage: '',
  glHandling: '',
  glReceiving: '',
  glOutbound: '',
  glFreightPrepaid: '',
  glFreight3rd: '',
  glSpecial: '',
  glMaterials: '',
  rateCard: [],
}

const inp = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
const inpSm = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500'
const labelCls = 'text-gray-400 text-xs mb-1 block'

const MODAL_TABS = ['basic', 'storage', 'fees', 'rates', 'gl', 'ratecard']
const MODAL_TAB_LABELS = {
  basic: 'Basic Info', storage: 'Storage', fees: 'Fees',
  rates: 'Default Rates', gl: 'GL Accounts', ratecard: 'Rate Card',
}

const modalStyle = { backgroundColor: '#0f172a', color: '#f1f5f9' }
const borderStyle = { borderColor: '#1e293b' }

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
    <div style={{ ...modalStyle, border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
      <div className="flex items-center justify-between mb-2">
        <p style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 500 }}>{title}</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form[enabledKey]}
            onChange={e => set(enabledKey, e.target.checked)}
            className="w-4 h-4 accent-blue-500" />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Enable</span>
        </label>
      </div>
      {form[enabledKey] && children}
    </div>
  )

  const updateRateCard = (i, field, value) => {
    const rc = [...form.rateCard]
    rc[i] = { ...rc[i], [field]: value }
    set('rateCard', rc)
  }

  return (
    <div className="p-6">
      {/* Header */}
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

      {/* Search */}
      <input type="text" placeholder="Search clients..." value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-sm bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:border-blue-500" />

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Company</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Contact</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Email / Phone</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Storage</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Rate Card</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Fees</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Since</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-500 py-12">No clients yet</td></tr>
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
                      {client.freeDays > 0 && <span className="text-xs text-gray-500">{client.freeDays} free days</span>}
                      {client.splitRate1st && <span className="text-xs text-gray-500">Split: ${client.splitRate1st}/${client.splitRate2nd}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {(client.rateCard || []).length > 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/10 text-green-400 border-green-500/20">
                        {client.rateCard.length} charge{client.rateCard.length !== 1 ? 's' : ''}
                      </span>
                    ) : <span className="text-gray-600 text-xs">None</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {client.chargeReceivingFee && <span className="text-xs text-blue-400">Recv: ${client.receivingFeeRate}/{client.receivingFeeType?.replace('per_','')}</span>}
                      {client.chargeOutboundFee && <span className="text-xs text-orange-400">Out: ${client.outboundFeeRate}/{client.outboundFeeType?.replace('per_','')}</span>}
                      {client.chargeLabelingFee && <span className="text-xs text-pink-400">Label: ${client.labelingFeeRate}/unit</span>}
                      {!client.chargeReceivingFee && !client.chargeOutboundFee && !client.chargeLabelingFee && <span className="text-gray-600 text-xs">Storage only</span>}
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
                    <td colSpan={8} className="px-6 py-4">
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
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide">Rate Card</p>
                          {(client.rateCard || []).length === 0
                            ? <p className="text-gray-600">Not configured</p>
                            : (client.rateCard || []).slice(0, 4).map((r, i) => (
                              <p key={i} className="text-white">{r.label}: <span className="text-gray-400">${r.rate}/{r.unit}</span></p>
                            ))
                          }
                          {(client.rateCard || []).length > 4 && <p className="text-gray-500">+{client.rateCard.length - 4} more</p>}
                        </div>
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide">GL Accounts</p>
                          {client.glStorage && <p className="text-yellow-400 font-mono">Storage: {client.glStorage}</p>}
                          {client.glHandling && <p className="text-yellow-400 font-mono">Handling: {client.glHandling}</p>}
                          {client.glReceiving && <p className="text-yellow-400 font-mono">Receiving: {client.glReceiving}</p>}
                          {client.glOutbound && <p className="text-yellow-400 font-mono">Outbound: {client.glOutbound}</p>}
                          {!client.glStorage && !client.glHandling && <p className="text-gray-600">None configured</p>}
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

      {/* ─── MODAL ─── */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:'16px', overflowY:'auto' }}>
          <div style={{ ...modalStyle, borderRadius:16, border:'1px solid #1e293b', width:'100%', maxWidth:900, maxHeight:'90vh', display:'flex', flexDirection:'column' }}>

            {/* Modal header */}
            <div style={{ ...modalStyle, ...borderStyle, borderBottom:'1px solid #1e293b', padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', borderRadius:'16px 16px 0 0' }}>
              <h3 style={{ color:'#f1f5f9', fontWeight:600, fontSize:16 }}>{editId ? 'Edit Client' : 'Add New Client'}</h3>
              <button onClick={() => setShowModal(false)} style={{ color:'#64748b', cursor:'pointer', background:'none', border:'none', fontSize:20 }}>✕</button>
            </div>

            {/* Tab bar */}
            <div style={{ ...modalStyle, borderBottom:'1px solid #1e293b', display:'flex', padding:'0 24px', overflowX:'auto' }}>
              {MODAL_TABS.map(t => (
                <button key={t} onClick={() => setModalTab(t)}
                  style={{
                    padding:'12px 16px', fontSize:12, fontWeight:500, cursor:'pointer',
                    background:'none', border:'none', borderBottom: modalTab === t ? '2px solid #3b82f6' : '2px solid transparent',
                    color: modalTab === t ? '#60a5fa' : '#64748b', whiteSpace:'nowrap'
                  }}>
                  {MODAL_TAB_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ ...modalStyle, padding:'24px', overflowY:'auto', flex:1 }}>

              {/* Basic Info */}
              {modalTab === 'basic' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label className={labelCls}>Company Name *</label>
                    <input value={form.companyName} onChange={e => set('companyName', e.target.value)} className={inp} placeholder="ABC Company"/>
                  </div>
                  <div>
                    <label className={labelCls}>Contact Name</label>
                    <input value={form.contactName} onChange={e => set('contactName', e.target.value)} className={inp} placeholder="John Smith"/>
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inp} placeholder="(909) 555-0000"/>
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label className={labelCls}>Email</label>
                    <input value={form.email} onChange={e => set('email', e.target.value)} className={inp} placeholder="contact@company.com"/>
                  </div>
                  <div>
                    <label className={labelCls}>Start Date</label>
                    <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className={inp}/>
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label className={labelCls}>Notes</label>
                    <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inp} style={{ resize:'none' }} placeholder="Special instructions..."/>
                  </div>
                </div>
              )}

              {/* Storage */}
              {modalTab === 'storage' && (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <div>
                    <label className={labelCls}>Billing Method</label>
                    <select value={form.storageType} onChange={e => set('storageType', e.target.value)} className={inp}>
                      <option value="per_pallet">Per pallet / month (flat rate)</option>
                      <option value="per_sku">Per SKU (rates set in Items catalog)</option>
                    </select>
                  </div>
                  {form.storageType === 'per_pallet' && (
                    <div>
                      <label className={labelCls}>Standard Rate ($ per pallet / month)</label>
                      <input type="number" value={form.billingRate} onChange={e => set('billingRate', e.target.value)} className={inp} placeholder="25.00"/>
                    </div>
                  )}
                  <div style={{ border:'1px solid #1e293b', borderRadius:12, padding:16 }}>
                    <p style={{ color:'#f1f5f9', fontSize:14, fontWeight:500, marginBottom:12 }}>Free Days</p>
                    <label className={labelCls}>Free days before storage starts (0 = charge from day 1)</label>
                    <input type="number" value={form.freeDays} onChange={e => set('freeDays', e.target.value)} className={inp} placeholder="0"/>
                  </div>
                  <div style={{ border:'1px solid #1e293b', borderRadius:12, padding:16 }}>
                    <p style={{ color:'#f1f5f9', fontSize:14, fontWeight:500, marginBottom:8 }}>Split Period Storage</p>
                    <p style={{ color:'#64748b', fontSize:12, marginBottom:12 }}>Charge a different rate depending on which half of the month inventory is received.</p>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                      <div><label className={labelCls}>Split Day</label><input type="number" value={form.splitPeriodDay} onChange={e => set('splitPeriodDay', e.target.value)} className={inp} placeholder="15"/></div>
                      <div><label className={labelCls}>1st Half Rate ($/pallet)</label><input type="number" value={form.splitRate1st} onChange={e => set('splitRate1st', e.target.value)} className={inp} placeholder="25.00"/></div>
                      <div><label className={labelCls}>2nd Half Rate ($/pallet)</label><input type="number" value={form.splitRate2nd} onChange={e => set('splitRate2nd', e.target.value)} className={inp} placeholder="12.50"/></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Fees */}
              {modalTab === 'fees' && (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <FeeSection title="Receiving Fee" enabledKey="chargeReceivingFee">
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
                      <div>
                        <label className={labelCls}>Fee Type</label>
                        <select value={form.receivingFeeType} onChange={e => set('receivingFeeType', e.target.value)} className={inp}>
                          <option value="per_pallet">Per pallet received</option>
                          <option value="per_unit">Per unit received</option>
                          <option value="per_receipt">Per receipt (flat)</option>
                        </select>
                      </div>
                      <div><label className={labelCls}>Rate ($)</label><input type="number" value={form.receivingFeeRate} onChange={e => set('receivingFeeRate', e.target.value)} className={inp} placeholder="10.00"/></div>
                    </div>
                  </FeeSection>
                  <FeeSection title="Outbound / Handling Fee" enabledKey="chargeOutboundFee">
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
                      <div>
                        <label className={labelCls}>Fee Type</label>
                        <select value={form.outboundFeeType} onChange={e => set('outboundFeeType', e.target.value)} className={inp}>
                          <option value="per_pallet">Per pallet shipped</option>
                          <option value="per_unit">Per unit shipped</option>
                          <option value="per_order">Per order (flat fee)</option>
                        </select>
                      </div>
                      <div><label className={labelCls}>Rate ($)</label><input type="number" value={form.outboundFeeRate} onChange={e => set('outboundFeeRate', e.target.value)} className={inp} placeholder="15.00"/></div>
                    </div>
                  </FeeSection>
                  <FeeSection title="Labeling / Special Projects" enabledKey="chargeLabelingFee">
                    <div style={{ marginTop:12 }}>
                      <label className={labelCls}>Default Rate ($ per unit)</label>
                      <input type="number" value={form.labelingFeeRate} onChange={e => set('labelingFeeRate', e.target.value)} className={inp} placeholder="0.50"/>
                    </div>
                  </FeeSection>
                </div>
              )}

              {/* Default Rates */}
              {modalTab === 'rates' && (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <p style={{ color:'#64748b', fontSize:12 }}>These rates auto-fill when adding charges in the Billing Wizard.</p>
                  <div style={{ border:'1px solid #1e293b', borderRadius:12, padding:16 }}>
                    <p style={{ color:'#f1f5f9', fontSize:14, fontWeight:500, marginBottom:12 }}>Special Charges</p>
                    <label className={labelCls}>Labor Rate ($ / hour)</label>
                    <input type="number" value={form.specialLaborRate} onChange={e => set('specialLaborRate', e.target.value)} className={inp} placeholder="45.00"/>
                  </div>
                  <div style={{ border:'1px solid #1e293b', borderRadius:12, padding:16 }}>
                    <p style={{ color:'#f1f5f9', fontSize:14, fontWeight:500, marginBottom:12 }}>Materials</p>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                      <div><label className={labelCls}>Pallet ($ each)</label><input type="number" value={form.materialsPalletRate} onChange={e => set('materialsPalletRate', e.target.value)} className={inp} placeholder="10.00"/></div>
                      <div><label className={labelCls}>Label ($ each)</label><input type="number" value={form.materialsLabelRate} onChange={e => set('materialsLabelRate', e.target.value)} className={inp} placeholder="0.25"/></div>
                      <div><label className={labelCls}>Box Small ($ each)</label><input type="number" value={form.materialsBoxSmallRate} onChange={e => set('materialsBoxSmallRate', e.target.value)} className={inp} placeholder="1.25"/></div>
                      <div><label className={labelCls}>Box Medium ($ each)</label><input type="number" value={form.materialsBoxMedRate} onChange={e => set('materialsBoxMedRate', e.target.value)} className={inp} placeholder="2.00"/></div>
                      <div><label className={labelCls}>Box Large ($ each)</label><input type="number" value={form.materialsBoxLgRate} onChange={e => set('materialsBoxLgRate', e.target.value)} className={inp} placeholder="3.00"/></div>
                    </div>
                  </div>
                </div>
              )}

              {/* GL Accounts */}
              {modalTab === 'gl' && (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <p style={{ color:'#64748b', fontSize:12 }}>GL account numbers appear on invoice line items and Excel exports for accounting integration.</p>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    {[
                      ['glStorage','Storage'],['glHandling','Handling'],['glReceiving','Receiving'],
                      ['glOutbound','Outbound / Shipping'],['glFreightPrepaid','Freight Prepaid'],
                      ['glFreight3rd','Freight 3rd Party'],['glSpecial','Special Charges'],['glMaterials','Materials'],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label className={labelCls}>{label}</label>
                        <input value={form[key]} onChange={e => set(key, e.target.value)} className={inp} placeholder="e.g. 4010"/>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rate Card */}
              {modalTab === 'ratecard' && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <p style={{ color:'#64748b', fontSize:12 }}>
                    Define every agreed service and rate. "On receive" and "On ship" charges auto-calculate when confirmed. "Manual only" charges appear in the Add Charge menu.
                  </p>

                  {/* Table header */}
                  <div style={{ display:'grid', gridTemplateColumns:'2fr 1.2fr 1fr 1fr 0.8fr 1.2fr 28px', gap:8, padding:'0 4px' }}>
                    {['Label','Category','Unit','Rate ($)','GL Acct','Trigger',''].map(h => (
                      <div key={h} style={{ color:'#64748b', fontSize:11, fontWeight:500 }}>{h}</div>
                    ))}
                  </div>

                  {/* Rows */}
                  <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:320, overflowY:'auto' }}>
                    {(form.rateCard || []).length === 0 && (
                      <p style={{ color:'#475569', fontSize:12, textAlign:'center', padding:'24px 0' }}>
                        No rate card rows yet — click Add Row below
                      </p>
                    )}
                    {(form.rateCard || []).map((row, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 1.2fr 1fr 1fr 0.8fr 1.2fr 28px', gap:8, alignItems:'center' }}>
                        <input value={row.label} onChange={e => updateRateCard(i,'label',e.target.value)}
                          className={inpSm} placeholder="e.g. Pick & Pack"/>
                        <select value={row.category} onChange={e => updateRateCard(i,'category',e.target.value)} className={inpSm}>
                          <option>Handling</option><option>Storage</option><option>Freight Prepaid</option>
                          <option>Freight 3rd Party</option><option>Special</option><option>Materials</option>
                        </select>
                        <select value={row.unit} onChange={e => updateRateCard(i,'unit',e.target.value)} className={inpSm}>
                          <option>pallet</option><option>unit</option><option>carton</option>
                          <option>order</option><option>receipt</option><option>hour</option>
                          <option>label</option><option>box</option>
                        </select>
                        <input type="text" inputMode="decimal" value={row.rate} onChange={e => updateRateCard(i,'rate',e.target.value)}
                          className={inpSm} placeholder="0.00"/>
                        <input value={row.glCode||''} onChange={e => updateRateCard(i,'glCode',e.target.value)}
                          className={inpSm} placeholder="4010"/>
                        <select value={row.trigger} onChange={e => updateRateCard(i,'trigger',e.target.value)} className={inpSm}>
                          <option value="on_receive">On receive</option>
                          <option value="on_ship">On ship</option>
                          <option value="both">Both</option>
                          <option value="manual">Manual only</option>
                        </select>
                        <button onClick={() => set('rateCard', form.rateCard.filter((_,idx)=>idx!==i))}
                          style={{ color:'#475569', background:'none', border:'none', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => set('rateCard', [...(form.rateCard||[]), { id:Date.now(), label:'', category:'Handling', unit:'pallet', rate:'', glCode:'', trigger:'on_ship' }])}
                    style={{ border:'1px dashed #3b82f6', borderRadius:8, padding:'8px 16px', color:'#60a5fa', background:'none', cursor:'pointer', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                    + Add Rate Card Row
                  </button>
                </div>
              )}

            </div>

            {/* Footer */}
            <div style={{ ...modalStyle, borderTop:'1px solid #1e293b', padding:'16px 24px', display:'flex', justifyContent:'flex-end', gap:12, borderRadius:'0 0 16px 16px' }}>
              <button onClick={() => setShowModal(false)}
                style={{ padding:'8px 16px', fontSize:14, color:'#94a3b8', background:'none', border:'none', cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={loading || !form.companyName.trim()}
                style={{ padding:'8px 20px', fontSize:14, backgroundColor:'#2563eb', color:'white', border:'none', borderRadius:8, cursor:'pointer', opacity: (loading || !form.companyName.trim()) ? 0.5 : 1 }}>
                {loading ? 'Saving...' : editId ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}