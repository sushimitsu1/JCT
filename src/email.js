import emailjs from '@emailjs/browser'

const SERVICE_ID = 'service_gnbyh69'
const TEMPLATE_ID = 'template_urzgyjp'
const PUBLIC_KEY = 'GaPn4arwOhrzpMZkK'

export const sendInvoiceEmail = async (invoice) => {
  if (!invoice.clientEmail) {
    console.warn('No client email on file — skipping email')
    return false
  }

  const lineItemsText = invoice.lineItems?.map(item =>
    `${item.description}: ${item.quantity} x $${item.rate} = $${item.amount}`
  ).join('\n') || ''

  const templateParams = {
    to_email: invoice.clientEmail,
    client_name: invoice.clientName,
    invoice_number: invoice.invoiceNumber || 'N/A',
    period: invoice.period,
    total: `$${Number(invoice.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    line_items: lineItemsText,
  }

  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY)
    return true
  } catch (err) {
    console.error('Email failed:', err)
    return false
  }
}

export const sendShipmentEmail = async (order, clientEmail) => {
  if (!clientEmail) return false

  const templateParams = {
    to_email: clientEmail,
    client_name: order.clientName,
    invoice_number: order.orderNumber || 'N/A',
    period: order.orderDate,
    total: `${order.totalUnits} units`,
    line_items: `Tracking Number: ${order.trackingNumber || 'N/A'}\nShip To: ${order.shipTo || 'N/A'}`,
  }

  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY)
    return true
  } catch (err) {
    console.error('Shipment email failed:', error)
    return false
  }
}