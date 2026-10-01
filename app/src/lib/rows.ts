// Convert raw string rows (as stored in Parquet) into typed records.
import type { Customer, POHeader, POLineInput, Product, Txn } from './types'

type Row = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const n = (v: unknown) => {
  const x = s(v).trim()
  return x === '' ? NaN : Number(x)
}

export const toProduct = (r: Row): Product => ({
  sku: s(r.sku), product_name: s(r.product_name), product_family: s(r.product_family),
  sub_category: s(r.sub_category), quality_group_id: s(r.quality_group_id), composition: s(r.composition),
  gsm: n(r.gsm), width_inch: s(r.width_inch) === '' ? null : n(r.width_inch), size_spec: s(r.size_spec),
  colour: s(r.colour), colour_family: s(r.colour_family), weave_knit: s(r.weave_knit), finish: s(r.finish),
  uom: s(r.uom) as Product['uom'], list_price_inr: n(r.list_price_inr), moq_units: n(r.moq_units),
  lead_time_days: n(r.lead_time_days), hsn_code: s(r.hsn_code), gst_rate_pct: n(r.gst_rate_pct),
  is_active: s(r.is_active) === 'Y', launch_date: s(r.launch_date),
})

export const toCustomer = (r: Row): Customer => ({
  customer_id: s(r.customer_id), customer_name: s(r.customer_name), customer_segment: s(r.customer_segment),
  city: s(r.city), state_code: s(r.state_code), gstin_masked: s(r.gstin_masked),
  commercial_tier: s(r.commercial_tier) as Customer['commercial_tier'],
  standard_discount_pct: n(r.standard_discount_pct), credit_terms_days: n(r.credit_terms_days),
  credit_limit_inr: n(r.credit_limit_inr), preferred_uom: s(r.preferred_uom),
  uses_own_item_codes: s(r.uses_own_item_codes) === 'Y', customer_code_prefix: s(r.customer_code_prefix),
  onboarding_date: s(r.onboarding_date), is_new_customer: s(r.is_new_customer) === 'Y',
  po_channel_preference: s(r.po_channel_preference), avg_monthly_order_value_inr: n(r.avg_monthly_order_value_inr),
})

export const toTxn = (r: Row): Txn => ({
  transaction_id: s(r.transaction_id), order_ref: s(r.order_ref), line_no: n(r.line_no),
  customer_id: s(r.customer_id), sku: s(r.sku), transaction_date: s(r.transaction_date),
  quantity: n(r.quantity), uom: s(r.uom), unit_price_inr: n(r.unit_price_inr),
  line_amount_inr: n(r.line_amount_inr), discount_pct_applied: n(r.discount_pct_applied),
  order_status: s(r.order_status),
})

export const toHeader = (r: Row): POHeader => ({
  po_id: s(r.po_id), po_number: s(r.po_number), customer_id: s(r.customer_id), po_date: s(r.po_date),
  received_channel: s(r.received_channel), document_quality: s(r.document_quality),
  document_language_mix: s(r.document_language_mix), currency: s(r.currency) || 'INR',
  payment_terms_days: s(r.payment_terms_days), requested_delivery_date: s(r.requested_delivery_date),
  ship_to_city: s(r.ship_to_city), po_line_count: n(r.po_line_count),
})

export const toLine = (r: Row): POLineInput => ({
  po_line_id: s(r.po_line_id), po_id: s(r.po_id), line_no: n(r.line_no),
  customer_item_description: s(r.customer_item_description), customer_item_code: s(r.customer_item_code),
  colour_text: s(r.colour_text), gsm_text: s(r.gsm_text), width_text: s(r.width_text),
  quantity_text: s(r.quantity_text), uom_text: s(r.uom_text), unit_price_text: s(r.unit_price_text),
  line_remarks: s(r.line_remarks), requested_delivery_date: s(r.requested_delivery_date),
})

export const asStrings = <T>(r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, s(v)])) as T
