import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { Package } from 'lucide-react'

const conditionColors = {
  A: 'bg-green-500/10 text-green-400 border-green-500/20',
  B: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  C: 'bg-red-500/10 text-red-400 border-red-500/20'
}

export default function Inventory() {
  const [inventory, setInventory] = useState([])
  const [clients, setClients] = useState([])
  const [filterClient, setFilterClient] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      const [invSnap, clientsSnap] = await Promise.all([
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'clients'))
      ])
      setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    }
    fetchData()
  }, [])

  const filtered = inventory.filter(item => {
    const matchesClient = filterClient ? item.clientId === filterClient : true
    const matchesSearch = search
      ? item.sku?.toLowerCase().includes(search.toLowerCase()) ||
        item.description?.toLowerCase().includes(search.toLowerCase())
      : true
    return matchesClient && matchesSearch
  })

  const totalUnits = filtered.reduce((sum, i) => sum + Number(i.quantity || 0), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Inventory</h2>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} SKUs · {totalUnits} total units</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search SKU or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 w-64"
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
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">SKU</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Description</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Client</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Qty</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Condition</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Location</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <Package size={32} className="text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No inventory yet — receive items first</p>
                </td>
              </tr>
            ) : (
              filtered.map((item, i) => (
                <tr key={item.id} className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                  <td className="px-4 py-3 text-white font-mono text-xs font-medium">{item.sku}</td>
                  <td className="px-4 py-3 text-gray-300">{item.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-300">{item.clientName}</td>
                  <td className="px-4 py-3 text-white font-medium">{item.quantity}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[item.condition]}`}>
                      Grade {item.condition}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{item.location || '—'}</td>
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