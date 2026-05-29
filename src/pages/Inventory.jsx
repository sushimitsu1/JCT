import { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Package, MapPin, Pencil, Check, X } from 'lucide-react'

const conditionColors = {
  A: 'bg-green-500/10 text-green-400 border-green-500/20',
  B: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  C: 'bg-red-500/10 text-red-400 border-red-500/20'
}

const statusColors = {
  available:  'bg-green-500/10 text-green-400 border-green-500/20',
  'on-hold':  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  damaged:    'bg-red-500/10 text-red-400 border-red-500/20',
  shipped:    'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

export default function Inventory() {
  const [inventory, setInventory] = useState([])
  const [clients, setClients] = useState([])
  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('available')
  const [search, setSearch] = useState('')
  const [editingLocation, setEditingLocation] = useState(null)

  const fetchData = async () => {
    const [invSnap, clientsSnap] = await Promise.all([
      getDocs(collection(db, 'inventory')),
      getDocs(collection(db, 'clients'))
    ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const updateStatus = async (id, status) => {
    await updateDoc(doc(db, 'inventory', id), { status })
    setInventory(inv => inv.map(i => i.id === id ? { ...i, status } : i))
  }

  const saveLocation = async (id, location) => {
    await updateDoc(doc(db, 'inventory', id), { location })
    setInventory(inv => inv.map(i => i.id === id ? { ...i, location } : i))
    setEditingLocation(null)
  }

  const filtered = inventory.filter(item => {
    const matchesClient = filterClient ? item.clientId === filterClient : true
    const matchesStatus = filterStatus ? (item.status || 'available') === filterStatus : true
    const matchesSearch = search
      ? item.sku?.toLowerCase().includes(search.toLowerCase()) ||
        item.palletId?.toLowerCase().includes(search.toLowerCase()) ||
        item.description?.toLowerCase().includes(search.toLowerCase())
      : true
    return matchesClient && matchesStatus && matchesSearch
  })

  const available = inventory.filter(i => (i.status || 'available') === 'available').length
  const onHold    = inventory.filter(i => i.status === 'on-hold').length
  const damaged   = inventory.filter(i => i.status === 'damaged').length
  const totalUnits = filtered.reduce((sum, i) => sum + Number(i.units || i.quantity || 0), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Inventory</h2>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} pallets · {totalUnits} units shown</p>
        </div>
      </div>

      {/* Summary cards — clickable to filter */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Available',     value: available,         color: 'text-green-400',  filter: 'available' },
          { label: 'On Hold',       value: onHold,            color: 'text-yellow-400', filter: 'on-hold'   },
          { label: 'Damaged',       value: damaged,           color: 'text-red-400',    filter: 'damaged'   },
          { label: 'Total Pallets', value: inventory.length,  color: 'text-white',      filter: ''          },
        ].map(card => (
          <div
            key={card.label}
            onClick={() => setFilterStatus(filterStatus === card.filter ? '' : card.filter)}
            className={`bg-gray-900 border rounded-xl p-4 cursor-pointer transition-colors ${
              filterStatus === card.filter ? 'border-blue-500' : 'border-gray-800 hover:border-gray-700'
            }`}
          >
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search pallet ID, SKU, description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 w-72"
        />
        <select
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
        >
          <option value="">All clients</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
        >
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="on-hold">On Hold</option>
          <option value="damaged">Damaged</option>
          <option value="shipped">Shipped</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Pallet ID</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">SKU</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Description</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Client</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Units</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Cond.</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Location</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12">
                  <Package size={32} className="text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No pallets found</p>
                </td>
              </tr>
            ) : (
              filtered.map((item, i) => (
                <tr key={item.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                  <td className="px-4 py-3 text-blue-400 font-mono text-xs font-medium">{item.palletId || '—'}</td>
                  <td className="px-4 py-3 text-white font-mono text-xs font-medium">{item.sku}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-xs truncate text-xs">{item.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{item.clientName}</td>
                  <td className="px-4 py-3 text-gray-300">{item.units || item.quantity || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[item.condition]}`}>
                      {item.condition}
                    </span>
                  </td>

                  {/* Inline location editing */}
                  <td className="px-4 py-3">
                    {editingLocation?.id === item.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editingLocation.value}
                          onChange={e => setEditingLocation({ ...editingLocation, value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveLocation(item.id, editingLocation.value)
                            if (e.key === 'Escape') setEditingLocation(null)
                          }}
                          className="bg-gray-800 border border-blue-500 text-white rounded px-2 py-1 text-xs w-24 focus:outline-none"
                        />
                        <button onClick={() => saveLocation(item.id, editingLocation.value)} className="text-green-400 hover:text-green-300">
                          <Check size={12} />
                        </button>
                        <button onClick={() => setEditingLocation(null)} className="text-gray-500 hover:text-gray-300">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingLocation({ id: item.id, value: item.location || '' })}
                        className="flex items-center gap-1 text-gray-300 hover:text-white group"
                      >
                        <MapPin size={11} className="text-gray-600 group-hover:text-gray-400" />
                        <span className="text-xs">{item.location || 'Set location'}</span>
                        <Pencil size={10} className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </td>

                  {/* Status dropdown */}
                  <td className="px-4 py-3">
                    <select
                      value={item.status || 'available'}
                      onChange={e => updateStatus(item.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded-full border bg-transparent cursor-pointer focus:outline-none ${statusColors[item.status || 'available']}`}
                    >
                      <option value="available">Available</option>
                      <option value="on-hold">On Hold</option>
                      <option value="damaged">Damaged</option>
                      <option value="shipped">Shipped</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{item.receivedDate}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}