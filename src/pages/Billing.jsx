import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { DollarSign, FileText, Plus, X, Download, CheckCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import { sendInvoiceEmail } from '../email'

const months = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

const generateInvoiceNumber = () => {
  const now = new Date()
  return `INV-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${Math.floor(Math.random()*9000)+1000}`
}

export default function Billing() {
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [inventory, setInventory] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [selectedClient, setSelectedClient] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [success, setSuccess] = useState('')

  const fetchData = async () => {
    const [invSnap, clientsSnap, invoicesSnap] = await Promise.all([
      getDocs(collection(db, 'inventory')),
      getDocs(collection(db, 'clients')),
      getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc')))
    ])
    setInventory(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { fetchData() }, [])

  const handleClientChange = (clientId) => {
    setSelectedClient(clientId)
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    const clientInventory = inventory.filter(i =>
      i.clientId === clientId && (i.status || 'available') === 'available'
    )
    const pallets = clientInventory.length
    const rate = Number(client.billingRate || 25)
    setLineItems([
      {
        description: `Storage fee — ${months[selectedMonth]} ${selectedYear}`,
        quantity: pallets,
        unit: 'pallets',
        rate,
        amount: pallets * rate
      },
      {
        description: 'Handling fee — inbound',
        quantity: 1,
        unit: 'flat',
        rate: 0,
        amount: 0
      }
    ])
  }

  const updateLineItem = (i, field, value) => {
    const items = [...lineItems]
    items[i] = { ...items[i], [field]: value }
    if (field === 'quantity' || field === 'rate') {
      items[i].amount = Number(items[i].quantity || 0) * Number(items[i].rate || 0)
    }
    if (field === 'amount') items[i].amount = Number(value)
    setLineItems(items)
  }

  const addLineItem = () => setLineItems([...lineItems, { description: '', quantity: 1, unit: '', rate: 0, amount: 0 }])
  const removeLineItem = (i) => setLineItems(lineItems.filter((_, idx) => idx !== i))
  const total = lineItems.reduce((sum, i) => sum + Number(i.amount || 0), 0)

  const handleSave = async () => {
    if (!selectedClient) return
    setLoading(true)
    setSuccess('')
    const client = clients.find(c => c.id === selectedClient)
    const invoiceNumber = generateInvoiceNumber()
    try {
      const invoiceData = {
        invoiceNumber,
        clientId: selectedClient,
        clientName: client?.companyName,
        clientEmail: client?.email || '',
        clientPhone: client?.phone || '',
        month: selectedMonth,
        year: selectedYear,
        period: `${months[selectedMonth]} ${selectedYear}`,
        lineItems,
        total,
        status: 'pending',
        createdAt: new Date().toISOString()
      }
      await addDoc(collection(db, 'invoices'), invoiceData)

      // Send email if client has email
      if (client?.email) {
        const sent = await sendInvoiceEmail(invoiceData)
        setSuccess(sent
          ? `Invoice saved and emailed to ${client.email}`
          : 'Invoice saved — email could not be sent'
        )
      } else {
        setSuccess('Invoice saved — no email on file for this client')
      }

      setShowModal(false)
      setSelectedClient('')
      setLineItems([])
      fetchData()
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const markAsPaid = async (e, id) => {
    e.stopPropagation()
    await updateDoc(doc(db, 'invoices', id), {
      status: 'paid',
      paidAt: new Date().toISOString()
    })
    fetchData()
  }

  const exportPDF = (invoice) => {
    const pdf = new jsPDF()
    const pageWidth = pdf.internal.pageSize.getWidth()

    pdf.setFillColor(17, 24, 39)
    pdf.rect(0, 0, pageWidth, 45, 'F')

    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(20)
    pdf.setFont('helvetica', 'bold')
    pdf.text('JCT Logistics', 14, 20)

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(156, 163, 175)
    pdf.text('Warehouse Management & 3PL Services', 14, 28)
    pdf.text('Ontario, California', 14, 35)

    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(22)
    pdf.setFont('helvetica', 'bold')
    pdf.text('INVOICE', pageWidth - 14, 20, { align: 'right' })

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(156, 163, 175)
    pdf.text(invoice.invoiceNumber || '', pageWidth - 14, 28, { align: 'right' })
    pdf.text(`Period: ${invoice.period}`, pageWidth - 14, 35, { align: 'right' })

    pdf.setTextColor(17, 24, 39)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'bold')
    pdf.text('BILL TO', 14, 58)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.setTextColor(17, 24, 39)
    pdf.text(invoice.clientName || '', 14, 66)

    pdf.setFontSize(9)
    pdf.setTextColor(75, 85, 99)
    if (invoice.clientEmail) pdf.text(invoice.clientEmail, 14, 73)
    if (invoice.clientPhone) pdf.text(invoice.clientPhone, 14, 79)

    pdf.setFillColor(249, 250, 251)
    pdf.roundedRect(pageWidth - 80, 52, 66, 32, 2, 2, 'F')
    pdf.setFontSize(8)
    pdf.setTextColor(107, 114, 128)
    pdf.text('Invoice Date', pageWidth - 76, 60)
    pdf.text('Status', pageWidth - 76, 70)
    pdf.text('Due Date', pageWidth - 76, 80)
    pdf.setTextColor(17, 24, 39)
    pdf.setFont('helvetica', 'bold')
    pdf.text(new Date().toLocaleDateString(), pageWidth - 30, 60, { align: 'right' })
    pdf.text(invoice.status?.toUpperCase() || 'PENDING', pageWidth - 30, 70, { align: 'right' })
    pdf.text('Upon Receipt', pageWidth - 30, 80, { align: 'right' })

    let y = 96
    pdf.setFillColor(17, 24, 39)
    pdf.rect(14, y, pageWidth - 28, 8, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Description', 17, y + 5.5)
    pdf.text('Qty', 110, y + 5.5)
    pdf.text('Unit', 125, y + 5.5)
    pdf.text('Rate', 145, y + 5.5)
    pdf.text('Amount', pageWidth - 17, y + 5.5, { align: 'right' })

    y += 8
    invoice.lineItems?.forEach((item, i) => {
      if (i % 2 === 0) {
        pdf.setFillColor(249, 250, 251)
        pdf.rect(14, y, pageWidth - 28, 8, 'F')
      }
      pdf.setTextColor(55, 65, 81)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.text(String(item.description || ''), 17, y + 5.5)
      pdf.text(String(item.quantity || ''), 110, y + 5.5)
      pdf.text(String(item.unit || ''), 125, y + 5.5)
      pdf.text(`$${Number(item.rate).toFixed(2)}`, 145, y + 5.5)
      pdf.text(`$${Number(item.amount).toFixed(2)}`, pageWidth - 17, y + 5.5, { align: 'right' })
      y += 8
    })

    y += 6
    pdf.setFillColor(17, 24, 39)
    pdf.roundedRect(pageWidth - 80, y, 66, 18, 2, 2, 'F')
    pdf.setTextColor(156, 163, 175)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text('TOTAL DUE', pageWidth - 76, y + 7)
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(13)
    pdf.setFont('helvetica', 'bold')
    pdf.text(
      `$${Number(invoice.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      pageWidth - 16, y + 12, { align: 'right' }
    )

    const footerY = pdf.internal.pageSize.getHeight() - 16
    pdf.setDrawColor(229, 231, 235)
    pdf.line(14, footerY - 4, pageWidth - 14, footerY - 4)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(156, 163, 175)
    pdf.text('Thank you for your business.', pageWidth / 2, footerY, { align: 'center' })

    pdf.save(`${invoice.invoiceNumber || 'Invoice'}_${invoice.clientName}_${invoice.period}.pdf`)
  }

  const exportExcel = (invoice) => {
    const rows = invoice.lineItems.map(item => ({
      Description: item.description,
      Quantity: item.quantity,
      Unit: item.unit,
      'Rate ($)': item.rate,
      'Amount ($)': item.amount
    }))
    rows.push({ Description: 'TOTAL', 'Amount ($)': invoice.total })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice')
    XLSX.writeFile(wb, `${invoice.invoiceNumber}_${invoice.clientName}_${invoice.period}.xlsx`)
  }

  const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
  const pendingCount = invoices.filter(i => i.status === 'pending').length
  const paidCount = invoices.filter(i => i.status === 'paid').length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.length} invoices · {pendingCount} pending</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setSelectedClient(''); setLineItems([]); setSuccess('') }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Invoice
        </button>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Invoiced</p>
          <p className="text-2xl font-semibold text-white">${totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Pending</p>
          <p className="text-2xl font-semibold text-yellow-400">{pendingCount}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Paid</p>
          <p className="text-2xl font-semibold text-green-400">{paidCount}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Active Clients</p>
          <p className="text-2xl font-semibold text-white">{clients.length}</p>
        </div>
      </div>

      <div className="space-y-3">
        {invoices.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
            <FileText size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No invoices yet — click New Invoice to generate one</p>
          </div>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
                onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 bg-green-600/10 border border-green-600/20 rounded-lg flex items-center justify-center">
                    <DollarSign size={16} className="text-green-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{inv.clientName}</p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {inv.invoiceNumber ? `${inv.invoiceNumber} · ` : ''}{inv.period}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    inv.status === 'paid'
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                  }`}>
                    {inv.status}
                  </span>
                  <p className="text-white font-semibold text-sm">${Number(inv.total).toLocaleString()}</p>
                  {inv.status === 'pending' && (
                    <button
                      onClick={e => markAsPaid(e, inv.id)}
                      className="text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 px-2 py-1 rounded transition-colors flex items-center gap-1"
                    >
                      <CheckCircle size={11} /> Mark Paid
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); exportPDF(inv) }}
                    className="text-gray-400 hover:text-red-400 transition-colors p-1"
                    title="Export PDF"
                  >
                    <FileText size={15} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); exportExcel(inv) }}
                    className="text-gray-400 hover:text-green-400 transition-colors p-1"
                    title="Export Excel"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </div>

              {expandedId === inv.id && (
                <div className="border-t border-gray-800 px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left pb-2 font-medium">Description</th>
                        <th className="text-left pb-2 font-medium">Qty</th>
                        <th className="text-left pb-2 font-medium">Unit</th>
                        <th className="text-left pb-2 font-medium">Rate</th>
                        <th className="text-right pb-2 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {inv.lineItems?.map((item, i) => (
                        <tr key={i}>
                          <td className="py-2 text-gray-300">{item.description}</td>
                          <td className="py-2 text-gray-300">{item.quantity}</td>
                          <td className="py-2 text-gray-400">{item.unit}</td>
                          <td className="py-2 text-gray-400">${item.rate}</td>
                          <td className="py-2 text-white text-right">${Number(item.amount).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-700">
                        <td colSpan={4} className="pt-3 text-gray-400 text-xs font-medium">TOTAL</td>
                        <td className="pt-3 text-white font-semibold text-right">${Number(inv.total).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {inv.paidAt && (
                    <p className="text-green-400 text-xs mt-3">Paid on {new Date(inv.paidAt).toLocaleDateString()}</p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-white font-semibold">New Invoice</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Client *</label>
                  <select
                    value={selectedClient}
                    onChange={e => handleClientChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select client...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.companyName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Month</label>
                  <select
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Year</label>
                  <input
                    type="number"
                    value={selectedYear}
                    onChange={e => setSelectedYear(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              {lineItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-400 text-xs">Line Items</label>
                    <button onClick={addLineItem} className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                      <Plus size={12} /> Add line
                    </button>
                  </div>
                  <div className="space-y-2">
                    {lineItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          value={item.description}
                          onChange={e => updateLineItem(i, 'description', e.target.value)}
                          className="col-span-4 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Description"
                        />
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => updateLineItem(i, 'quantity', e.target.value)}
                          className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Qty"
                        />
                        <input
                          type="number"
                          value={item.rate}
                          onChange={e => updateLineItem(i, 'rate', e.target.value)}
                          className="col-span-2 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Rate"
                        />
                        <input
                          type="number"
                          value={item.amount}
                          onChange={e => updateLineItem(i, 'amount', e.target.value)}
                          className="col-span-3 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Amount"
                        />
                        <button onClick={() => removeLineItem(i)} className="col-span-1 text-gray-600 hover:text-red-400 flex justify-center">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end mt-3 pt-3 border-t border-gray-800">
                    <p className="text-white font-semibold text-sm">Total: ${total.toLocaleString()}</p>
                  </div>
                </div>
              )}
              {!selectedClient && (
                <p className="text-gray-500 text-sm text-center py-4">Select a client to auto-generate line items</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading || !selectedClient || lineItems.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {loading ? 'Saving...' : 'Save & Send Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}