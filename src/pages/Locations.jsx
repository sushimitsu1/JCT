import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import {
  Plus, X, Pencil, Trash2, MapPin, Search, Zap,
  Eye, EyeOff, Package
} from 'lucide-react'
import BulkUpload from '../components/BulkUpload'

const emptyForm = {
  label: '',
  aisle: '',
  bay: '',
  level: '',
  type: 'floor',
  notes: '',
  active: true,
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500'
const labelCls = 'text-gray-400 text-xs mb-1 block'

export default function Locations() {
  const [locations, setLocations] = useState([])
  const [inventory, setInventory] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterActive, setFilterActive] = useState('active')

  // Generator form
  const [gen, setGen] = useState({
    aisle: 'A',
    bayStart: '01',
    bayEnd: '48',
    type: 'floor',
    levelStart: '',
    levelEnd: '',
  })

  const fetchData = async () => {
    const [locSnap, invSnap] = await Promise.all([
      getDocs(collection(db, 'locations')),
      getDocs(collection(db, 'inventory')),
    ])
    const locs = locSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    locs.sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true }))
    setLocations(locs)
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const buildLabel = (aisle, bay, level) => {
    const parts = [aisle, bay]
    if (level) parts.push(level)
    return parts.filter(Boolean).join('-').toUpperCase()
  }

  const handleSubmit = async () => {
    if (!form.aisle || !form.bay) return
    setLoading(true)
    try {
      const label = form.label || buildLabel(form.aisle, form.bay, form.level)
      const data = {
        ...form,
        label,
        aisle: form.aisle.toUpperCase(),
        bay: String(form.bay),
        level: form.level || null,
      }
      if (editId) {
        await updateDoc(doc(db, 'locations', editId), data)
      } else {
        await addDoc(collection(db, 'locations'), { ...data, createdAt: new Date().toISOString() })
      }
      setForm(emptyForm); setEditId(null); setShowModal(false)
      fetchData()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  const handleEdit = (loc) => {
    setForm({ ...emptyForm, ...loc, level: loc.level || '' })
    setEditId(loc.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this location? This cannot be undone.')) return
    await deleteDoc(doc(db, 'locations', id))
    fetchData()
  }

  const toggleActive = async (loc) => {
    await updateDoc(doc(db, 'locations', loc.id), { active: !loc.active })
    fetchData()
  }

  // Bulk generator — creates a range of locations at once
  const handleGenerate = async () => {
    const start = parseInt(gen.bayStart, 10)
    const end = parseInt(gen.bayEnd, 10)
    if (isNaN(start) || isNaN(end) || end < start) {
      alert('Invalid bay range')
      return
    }
    const aisle = gen.aisle.toUpperCase()
    const isRack = gen.type === 'rack'
    const lvlStart = isRack ? parseInt(gen.levelStart, 10) : null
    const lvlEnd = isRack ? parseInt(gen.levelEnd, 10) : null

    // Find duplicates first
    const existingLabels = new Set(locations.map(l => l.label))
    const toCreate = []
    for (let b = start; b <= end; b++) {
      const bay = String(b).padStart(2, '0')
      if (isRack) {
        for (let lv = lvlStart; lv <= lvlEnd; lv++) {
          const level = String(lv).padStart(2, '0')
          const label = `${aisle}-${bay}-${level}`
          if (!existingLabels.has(label)) {
            toCreate.push({ label, aisle, bay, level, type: 'rack', notes: '', active: true })
          }
        }
      } else {
        const label = `${aisle}-${bay}`
        if (!existingLabels.has(label)) {
          toCreate.push({ label, aisle, bay, level: null, type: 'floor', notes: '', active: true })
        }
      }
    }

    if (toCreate.length === 0) {
      alert('All locations in that range already exist')
      return
    }
    if (!window.confirm(`Create ${toCreate.length} new location(s)?`)) return

    setLoading(true)
    try {
      for (const loc of toCreate) {
        await addDoc(collection(db, 'locations'), { ...loc, createdAt: new Date().toISOString() })
      }
      setShowGenerator(false)
      fetchData()
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  // Count pallets at each location
  const occupancyByLabel = {}
  inventory.forEach(inv => {
    if (inv.location && (inv.status || 'available') === 'available') {
      occupancyByLabel[inv.location] = (occupancyByLabel[inv.location] || 0) + 1
    }
  })

  const filtered = locations.filter(loc => {
    if (filterActive === 'active' && !loc.active) return false
    if (filterActive === 'inactive' && loc.active) return false
    if (filterType && loc.type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      if (!loc.label?.toLowerCase().includes(q) && !loc.aisle?.toLowerCase().includes(q) && !loc.notes?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const stats = {
    total: locations.length,
    active: locations.filter(l => l.active).length,
    floor: locations.filter(l => l.type === 'floor').length,
    rack: locations.filter(l => l.type === 'rack').length,
    occupied: Object.keys(occupancyByLabel).length,
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Warehouse Locations</h2>
          <p className="text-sm text-gray-500 mt-0.5">{stats.total} total · {stats.active} active · {stats.occupied} occupied</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkUpload(true)}
            className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            Bulk Upload
          </button>
          <button onClick={() => setShowGenerator(true)}
            className="flex items-center gap-2 bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 border border-amber-500/20 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <Zap size={16} /> Quick Generator
          </button>
          <button onClick={() => { setForm(emptyForm); setEditId(null); setShowModal(true) }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <Plus size={16} /> Add Location
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'text-white' },
          { label: 'Active', value: stats.active, color: 'text-green-400' },
          { label: 'Floor Bays', value: stats.floor, color: 'text-blue-400' },
          { label: 'Rack Positions', value: stats.rack, color: 'text-purple-400' },
          { label: 'Occupied', value: stats.occupied, color: 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Search by label, aisle, or notes..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500">
          <option value="">All types</option>
          <option value="floor">Floor</option>
          <option value="rack">Rack</option>
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500">
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All locations</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-800/50">
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Label</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Aisle</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Bay</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Level</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Type</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Occupancy</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Notes</th>
              <th className="text-left px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-gray-500 py-12">
                {locations.length === 0 ? 'No locations yet — use Quick Generator to create A-01 through A-48 in one click' : 'No locations match the current filters'}
              </td></tr>
            ) : filtered.map((loc, i) => {
              const count = occupancyByLabel[loc.label] || 0
              return (
                <tr key={loc.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'} ${!loc.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="text-blue-400 font-mono font-medium">{loc.label}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{loc.aisle}</td>
                  <td className="px-4 py-3 text-gray-300">{loc.bay}</td>
                  <td className="px-4 py-3 text-gray-300">{loc.level || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      loc.type === 'rack'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}>{loc.type}</span>
                  </td>
                  <td className="px-4 py-3">
                    {count > 0 ? (
                      <span className="text-yellow-400 text-xs flex items-center gap-1">
                        <Package size={11}/> {count} pallet{count !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">empty</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{loc.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      loc.active
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>{loc.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => toggleActive(loc)} className="text-gray-400 hover:text-white p-1 rounded" title={loc.active ? 'Mark inactive' : 'Mark active'}>
                        {loc.active ? <EyeOff size={14}/> : <Eye size={14}/>}
                      </button>
                      <button onClick={() => handleEdit(loc)} className="text-gray-400 hover:text-white p-1 rounded" title="Edit">
                        <Pencil size={14}/>
                      </button>
                      <button onClick={() => handleDelete(loc.id)} className="text-gray-400 hover:text-red-400 p-1 rounded" title="Delete" disabled={count > 0}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ─── ADD / EDIT MODAL ─── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <MapPin size={16}/> {editId ? 'Edit Location' : 'New Location'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18}/>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Aisle *</label>
                  <input value={form.aisle} onChange={e => set('aisle', e.target.value)}
                    className={inputCls} placeholder="A" maxLength={3}/>
                </div>
                <div>
                  <label className={labelCls}>Bay *</label>
                  <input value={form.bay} onChange={e => set('bay', e.target.value)}
                    className={inputCls} placeholder="01"/>
                </div>
                <div>
                  <label className={labelCls}>Level</label>
                  <input value={form.level} onChange={e => set('level', e.target.value)}
                    className={inputCls} placeholder="(rack only)"/>
                </div>
              </div>
              <div>
                <label className={labelCls}>Generated Label</label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-blue-400 font-mono">
                  {buildLabel(form.aisle, form.bay, form.level) || '—'}
                </div>
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select value={form.type} onChange={e => set('type', e.target.value)} className={inputCls}>
                  <option value="floor">Floor bay</option>
                  <option value="rack">Rack position</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                  className={inputCls + ' resize-none'} placeholder="Optional notes..."/>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}
                  className="w-4 h-4 accent-blue-500"/>
                <span className="text-gray-300 text-sm">Active</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={loading || !form.aisle || !form.bay}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
                {loading ? 'Saving...' : editId ? 'Save Changes' : 'Add Location'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── QUICK GENERATOR MODAL ─── */}
      {showGenerator && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Zap size={16}/> Quick Generator
              </h3>
              <button onClick={() => setShowGenerator(false)} className="text-gray-400 hover:text-white">
                <X size={18}/>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-gray-400 text-xs">
                Generate a range of locations in one click. Example: Aisle A, bays 01–48 (floor) creates A-01 through A-48.
              </p>
              <div>
                <label className={labelCls}>Type</label>
                <select value={gen.type} onChange={e => setGen(g => ({ ...g, type: e.target.value }))} className={inputCls}>
                  <option value="floor">Floor bays (Aisle-Bay)</option>
                  <option value="rack">Rack positions (Aisle-Bay-Level)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Aisle</label>
                <input value={gen.aisle} onChange={e => setGen(g => ({ ...g, aisle: e.target.value }))}
                  className={inputCls} placeholder="A"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Bay Start</label>
                  <input type="number" value={gen.bayStart} onChange={e => setGen(g => ({ ...g, bayStart: e.target.value }))}
                    className={inputCls} placeholder="01"/>
                </div>
                <div>
                  <label className={labelCls}>Bay End</label>
                  <input type="number" value={gen.bayEnd} onChange={e => setGen(g => ({ ...g, bayEnd: e.target.value }))}
                    className={inputCls} placeholder="48"/>
                </div>
              </div>
              {gen.type === 'rack' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Level Start</label>
                    <input type="number" value={gen.levelStart} onChange={e => setGen(g => ({ ...g, levelStart: e.target.value }))}
                      className={inputCls} placeholder="01"/>
                  </div>
                  <div>
                    <label className={labelCls}>Level End</label>
                    <input type="number" value={gen.levelEnd} onChange={e => setGen(g => ({ ...g, levelEnd: e.target.value }))}
                      className={inputCls} placeholder="04"/>
                  </div>
                </div>
              )}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-400">
                Will create labels like: {gen.type === 'rack'
                  ? `${(gen.aisle||'A').toUpperCase()}-${String(gen.bayStart||1).padStart(2,'0')}-${String(gen.levelStart||1).padStart(2,'0')} ... ${(gen.aisle||'A').toUpperCase()}-${String(gen.bayEnd||1).padStart(2,'0')}-${String(gen.levelEnd||1).padStart(2,'0')}`
                  : `${(gen.aisle||'A').toUpperCase()}-${String(gen.bayStart||1).padStart(2,'0')} ... ${(gen.aisle||'A').toUpperCase()}-${String(gen.bayEnd||1).padStart(2,'0')}`}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowGenerator(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button onClick={handleGenerate} disabled={loading || !gen.aisle || !gen.bayStart || !gen.bayEnd}
                className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg">
                {loading ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload */}
      {showBulkUpload && (
        <BulkUpload type="locations" onClose={() => setShowBulkUpload(false)} onSuccess={fetchData}/>
      )}
    </div>
  )
}
