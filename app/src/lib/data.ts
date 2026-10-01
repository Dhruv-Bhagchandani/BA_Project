// Loads the Parquet data files shipped in /public/data straight into the browser.
import { parquetReadObjects } from 'hyparquet'
import { asStrings, toCustomer, toHeader, toLine, toProduct, toTxn } from './rows'
import type { Customer, GroundTruth, POHeader, POLineInput, Product, Txn } from './types'

export interface DocManifestRow {
  po_id: string; po_number: string; customer_id: string; document_file: string; file_format: string
  layout_id: string; layout_name: string; quality_id: string; quality_name: string; has_text_layer: string
  requires_ocr: string; n_pages: string; n_lines: string; has_terms_annexure_page: string
  line_items_span_pages: string; source_channel: string; split: string; file_size_bytes: string
}
export interface DocHeaderRow {
  po_id: string; printed_po_number: string; printed_po_date: string; printed_customer_name: string
  printed_customer_city: string; printed_ship_to_city: string; printed_delivery_date: string
  printed_payment_terms_days: string; printed_line_count: string; printed_order_total_inr: string
  total_printed_on_document: string; amount_column_present: string
}
export interface POEvalRow {
  po_id: string; po_scenario_type: string; po_difficulty_level: string; po_scenario_mix: string
  distinct_scenarios_in_po: string; is_duplicate_po: string; duplicate_of_po_id: string
}
export interface SplitRow { po_id: string; split: string; temporal_split: string; po_difficulty_level: string }
export interface SampleDoc {
  po_id: string; po_number: string; customer_id: string; document_file: string; file_format: string
  layout_id: string; layout_name: string; quality_id: string; quality_name: string; has_text_layer: string
  n_pages: string; n_lines: string
}

export interface Dataset {
  products: Product[]
  customers: Customer[]
  txns: Txn[]
  headers: POHeader[]
  linesByPo: Map<string, POLineInput[]>
  gt: Map<string, GroundTruth>
  poEval: Map<string, POEvalRow>
  splits: Map<string, SplitRow>
  manifest: Map<string, DocManifestRow>
  docHeaders: Map<string, DocHeaderRow>
  samples: SampleDoc[]
}

const base = import.meta.env.BASE_URL

async function readParquet(name: string) {
  const res = await fetch(`${base}data/${name}.parquet`)
  if (!res.ok) throw new Error(`Could not load ${name}.parquet (${res.status})`)
  const buf = await res.arrayBuffer()
  return parquetReadObjects({ file: buf })
}

export async function loadDataset(onProgress?: (done: number, total: number, name: string) => void): Promise<Dataset> {
  const names = ['products', 'customers', 'transactions', 'purchase_orders', 'po_lines', 'ground_truth',
    'purchase_orders_eval', 'splits', 'doc_manifest', 'doc_headers'] as const
  let done = 0
  const raw = await Promise.all(names.map(async (n) => {
    const rows = await readParquet(n)
    onProgress?.(++done, names.length + 1, n)
    return rows
  }))
  const [prod, cust, txn, pos, lines, gt, poEval, splits, man, dh] = raw
  const samples: SampleDoc[] = await fetch(`${base}samples/index.json`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
  onProgress?.(names.length + 1, names.length + 1, 'samples')

  const linesByPo = new Map<string, POLineInput[]>()
  for (const l of lines.map(toLine)) {
    if (!linesByPo.has(l.po_id)) linesByPo.set(l.po_id, [])
    linesByPo.get(l.po_id)!.push(l)
  }
  for (const ls of linesByPo.values()) ls.sort((a, b) => a.line_no - b.line_no)

  const byPo = <T extends { po_id: string }>(rows: Record<string, unknown>[]) =>
    new Map(rows.map((r) => asStrings<T>(r)).map((r) => [r.po_id, r]))

  return {
    products: prod.map(toProduct),
    customers: cust.map(toCustomer),
    txns: txn.map(toTxn),
    headers: pos.map(toHeader).sort((a, b) => a.po_date.localeCompare(b.po_date) || a.po_id.localeCompare(b.po_id)),
    linesByPo,
    gt: new Map(gt.map((r) => asStrings<GroundTruth>(r)).map((g) => [g.po_line_id, g])),
    poEval: byPo<POEvalRow>(poEval),
    splits: byPo<SplitRow>(splits),
    manifest: byPo<DocManifestRow>(man),
    docHeaders: byPo<DocHeaderRow>(dh),
    samples,
  }
}
