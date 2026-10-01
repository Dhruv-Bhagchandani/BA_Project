// ---------------------------------------------------------------------------
// Domain types — mirror the dataset documentation (DATASET_DOCUMENTATION.md §3, §7)
// ---------------------------------------------------------------------------

export type Uom = 'MTR' | 'KG' | 'PCS'

export interface Product {
  sku: string
  product_name: string
  product_family: string
  sub_category: string
  quality_group_id: string
  composition: string
  gsm: number
  width_inch: number | null
  size_spec: string
  colour: string
  colour_family: string
  weave_knit: string
  finish: string
  uom: Uom
  list_price_inr: number
  moq_units: number
  lead_time_days: number
  hsn_code: string
  gst_rate_pct: number
  is_active: boolean
  launch_date: string
}

export interface Customer {
  customer_id: string
  customer_name: string
  customer_segment: string
  city: string
  state_code: string
  gstin_masked: string
  commercial_tier: 'A' | 'B' | 'C'
  standard_discount_pct: number
  credit_terms_days: number
  credit_limit_inr: number
  preferred_uom: string
  uses_own_item_codes: boolean
  customer_code_prefix: string
  onboarding_date: string
  is_new_customer: boolean
  po_channel_preference: string
  avg_monthly_order_value_inr: number
}

export interface Txn {
  transaction_id: string
  order_ref: string
  line_no: number
  customer_id: string
  sku: string
  transaction_date: string
  quantity: number
  uom: string
  unit_price_inr: number
  line_amount_inr: number
  discount_pct_applied: number
  order_status: string
}

export interface POHeader {
  po_id: string
  po_number: string
  customer_id: string
  po_date: string
  received_channel: string
  document_quality: string
  document_language_mix: string
  currency: string
  payment_terms_days: string
  requested_delivery_date: string
  ship_to_city: string
  po_line_count: number
}

/** A PO line exactly as an extractor would hand it over — every field is text. */
export interface POLineInput {
  po_line_id: string
  po_id: string
  line_no: number
  customer_item_description: string
  customer_item_code: string
  colour_text: string
  gsm_text: string
  width_text: string
  quantity_text: string
  uom_text: string
  unit_price_text: string
  line_remarks: string
  requested_delivery_date: string
  /** Set by a document extractor (e.g. Claude) when characters could not be read reliably. */
  legibility?: 'clear' | 'uncertain' | 'illegible'
  /** For documents that are part of the benchmark: the dataset line this corresponds to (evaluation only). */
  ref_line_id?: string
}

export interface POInput {
  header: POHeader
  /** Name as printed on the document, used when customer_id is unknown. */
  customer_name_text?: string
  lines: POLineInput[]
  source: 'inbox' | 'upload' | 'manual'
}

export interface GroundTruth {
  po_line_id: string
  po_id: string
  customer_id: string
  true_sku: string
  true_product_name: string
  true_product_family: string
  extracted_quantity_true: string
  extracted_uom_true: string
  extracted_unit_price_true: string
  expected_so_quantity: string
  expected_so_uom: string
  expected_so_unit_price_inr: string
  expected_so_line_value_inr: string
  reference_price_inr: string
  reference_price_source: string
  reference_price_age_days: string
  price_delta_pct: string
  expected_match_status: MatchStatus
  expected_price_status: PriceStatus
  expected_exception_type: ExceptionType
  expected_action: Action
  should_auto_process: string
  expected_so_line_status: SoLineStatus
  expected_confidence_band: string
  ambiguous_candidate_skus: string
  n_candidate_skus: string
  scenario_type: string
  difficulty_level: Difficulty
  match_evidence_notes: string
}

export type Difficulty = 'easy' | 'medium' | 'hard' | 'exception'

export type MatchStatus =
  | 'exact_match'
  | 'high_confidence_match'
  | 'low_confidence_match'
  | 'ambiguous_multiple_candidates'
  | 'no_match'

export type PriceStatus =
  | 'within_tolerance'
  | 'minor_variance_acceptable'
  | 'outside_tolerance_high'
  | 'outside_tolerance_low'
  | 'stale_reference_price'
  | 'no_reference_price'
  | 'no_price_quoted'
  | 'not_applicable'

export type ExceptionType =
  | 'none'
  | 'price_variance_minor'
  | 'price_variance_major'
  | 'uom_mismatch'
  | 'uom_converted'
  | 'missing_quantity'
  | 'unknown_product'
  | 'duplicate_order'
  | 'attribute_conflict'
  | 'ambiguous_match'
  | 'partial_match'
  | 'illegible_document'
  | 'conflicting_data'
  | 'quantity_outlier'
  | 'incomplete_line'
  | 'unmapped_customer_code'
  | 'stale_reference_price'
  | 'no_reference_price'
  | 'low_confidence_match'
  | 'new_customer_no_history'

export type Action =
  | 'auto_process'
  | 'auto_process_with_flag'
  | 'review_match'
  | 'review_price'
  | 'review_uom'
  | 'review_quantity'
  | 'request_clarification'
  | 'hold_duplicate_check'
  | 'manual_entry'
  | 'reject_line'

export type SoLineStatus = 'create_so_line' | 'create_so_line_flagged' | 'hold_for_review' | 'do_not_create'

export type Flag =
  | 'malformed'
  | 'illegible'
  | 'duplicate'
  | 'missing_qty'
  | 'conflicting'
  | 'attribute_conflict'
  | 'partial_match'
  | 'unmapped_code'
  | 'uom_incompatible'
  | 'uom_convertible'
  | 'new_customer'
  | 'qty_outlier'

export interface Rules {
  price_tolerance_auto_pct: number
  price_tolerance_flag_pct: number
  reference_price_max_age_days: number
  qty_outlier_multiple: number
  qty_outlier_abs_mtr: number
  duplicate_window_days: number
  /** Agent-side policy: lines below this match confidence are never auto-processed. */
  confidence_threshold: number
}

export const DEFAULT_RULES: Rules = {
  price_tolerance_auto_pct: 2,
  price_tolerance_flag_pct: 5,
  reference_price_max_age_days: 180,
  qty_outlier_multiple: 8,
  qty_outlier_abs_mtr: 25000,
  duplicate_window_days: 10,
  confidence_threshold: 0.6,
}
