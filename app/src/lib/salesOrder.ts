// Turns an agent result + human review decisions into a Sales Order document.
import type { LineResult, POResult } from './engine'
import type { Product } from './types'

export interface ReviewDecision {
  status: 'approved' | 'rejected' | 'clarification'
  sku?: string
  unitPrice?: number
  qty?: number
  note?: string
  reviewer: string
  at: string
}

export type SoLineState = 'auto' | 'auto_flagged' | 'approved' | 'pending' | 'rejected' | 'clarification'

export interface SoLine {
  lineNo: number
  poLineId: string
  state: SoLineState
  sku: string | null
  name: string
  qty: number | null
  uom: string
  unitPrice: number | null
  value: number
  gstPct: number
  gstAmount: number
  hsn: string
  flag: string | null
  customerText: string
  reviewer?: string
}

export interface SalesOrder {
  soNumber: string
  poId: string
  poNumber: string
  customerId: string
  customerName: string
  shipTo: string
  soDate: string
  deliveryDate: string
  paymentTermsDays: string
  status: 'Confirmed' | 'Partially confirmed' | 'Awaiting review' | 'On hold' | 'Cancelled'
  lines: SoLine[]
  subtotal: number
  gst: number
  total: number
  pendingCount: number
}

export function soNumberFor(poId: string) {
  return `SO-${poId.replace(/^PO/, '')}`
}

const round2 = (x: number) => Math.round(x * 100) / 100

function soLineFrom(l: LineResult, decision: ReviewDecision | undefined, productBySku: Map<string, Product>): SoLine {
  const base = {
    lineNo: l.input.line_no,
    poLineId: l.input.po_line_id,
    customerText: l.input.customer_item_description,
  }
  if (decision?.status === 'approved') {
    const p = productBySku.get(decision.sku ?? l.match.sku ?? '') ?? l.match.product
    const qty = decision.qty ?? l.so?.qty ?? l.parsed.qty
    const unit = decision.unitPrice ?? l.so?.unitPrice ?? l.price.reference ?? l.parsed.price
    const value = qty !== null && qty !== undefined && unit !== null && unit !== undefined ? round2(qty * unit) : 0
    const gstPct = p?.gst_rate_pct ?? 5
    return {
      ...base, state: 'approved', sku: p?.sku ?? null, name: p?.product_name ?? '—', qty: qty ?? null,
      uom: p?.uom ?? l.so?.uom ?? '', unitPrice: unit ?? null, value, gstPct, gstAmount: round2((value * gstPct) / 100),
      hsn: p?.hsn_code ?? '', flag: `reviewed: ${l.exception.replace(/_/g, ' ')}`, reviewer: decision.reviewer,
    }
  }
  if (l.autoProcess && l.so) {
    const value = l.so.value ?? 0
    return {
      ...base, state: l.action === 'auto_process' ? 'auto' : 'auto_flagged', sku: l.match.sku,
      name: l.match.product?.product_name ?? '—', qty: l.so.qty, uom: l.so.uom, unitPrice: l.so.unitPrice, value,
      gstPct: l.so.gstPct, gstAmount: round2((value * l.so.gstPct) / 100), hsn: l.so.hsn,
      flag: l.action === 'auto_process_with_flag' ? l.exception.replace(/_/g, ' ') : null,
    }
  }
  const state: SoLineState = decision?.status === 'rejected' ? 'rejected'
    : decision?.status === 'clarification' ? 'clarification'
    : l.soStatus === 'do_not_create' && l.action === 'reject_line' ? 'rejected' : 'pending'
  return {
    ...base, state, sku: l.match.sku, name: l.match.product?.product_name ?? (l.match.candidates.length ? `${l.match.candidates.length} candidates` : '—'),
    qty: l.so?.qty ?? l.parsed.qty, uom: l.so?.uom ?? l.parsed.uomRaw, unitPrice: l.so?.unitPrice ?? l.parsed.price, value: 0,
    gstPct: 0, gstAmount: 0, hsn: '', flag: `${l.exception.replace(/_/g, ' ')} → ${l.action.replace(/_/g, ' ')}`,
  }
}

export function buildSalesOrder(po: POResult, reviews: Record<string, ReviewDecision>, productBySku: Map<string, Product>): SalesOrder {
  const lines = po.lines.map((l) => soLineFrom(l, reviews[l.input.po_line_id], productBySku))
  const live = lines.filter((l) => l.state === 'auto' || l.state === 'auto_flagged' || l.state === 'approved')
  const subtotal = round2(live.reduce((s, l) => s + l.value, 0))
  const gst = round2(live.reduce((s, l) => s + l.gstAmount, 0))
  const pendingCount = lines.filter((l) => l.state === 'pending' || l.state === 'clarification').length
  const h = po.input.header
  const status: SalesOrder['status'] = po.duplicateOf && !live.length ? 'On hold'
    : !live.length && !pendingCount ? 'Cancelled'
    : pendingCount === 0 ? 'Confirmed'
    : live.length ? 'Partially confirmed' : 'Awaiting review'
  return {
    soNumber: soNumberFor(h.po_id), poId: h.po_id, poNumber: h.po_number, customerId: h.customer_id,
    customerName: po.customer?.customer_name ?? po.input.customer_name_text ?? 'Unknown customer',
    shipTo: h.ship_to_city, soDate: h.po_date, deliveryDate: h.requested_delivery_date,
    paymentTermsDays: h.payment_terms_days || String(po.customer?.credit_terms_days ?? ''),
    status, lines, subtotal, gst, total: round2(subtotal + gst), pendingCount,
  }
}

export function soToCsv(so: SalesOrder) {
  const head = ['so_number', 'po_number', 'customer', 'line', 'state', 'sku', 'product', 'qty', 'uom', 'unit_price_inr', 'value_inr', 'gst_pct', 'gst_inr', 'hsn', 'flag']
  const rows = so.lines.map((l) => [so.soNumber, so.poNumber, so.customerName, l.lineNo, l.state, l.sku ?? '', l.name, l.qty ?? '', l.uom, l.unitPrice ?? '', l.value, l.gstPct, l.gstAmount, l.hsn, l.flag ?? ''])
  return [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}
