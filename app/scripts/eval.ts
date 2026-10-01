// Headless evaluation of the agent against the ground truth.
//   npx tsx scripts/eval.ts [train|validation|test|all] [--errors scenario_name]
import { readFileSync } from 'node:fs'
import { parquetReadObjects } from 'hyparquet'
import { buildContext, processPO, registerPO } from '../src/lib/engine'
import { computeMetrics, pairResults, sliceBy, sweepThreshold } from '../src/lib/evaluate'
import { asStrings, toCustomer, toHeader, toLine, toProduct, toTxn } from '../src/lib/rows'
import { DEFAULT_RULES, type GroundTruth } from '../src/lib/types'

const load = async (name: string) => {
  const buf = readFileSync(new URL(`../public/data/${name}.parquet`, import.meta.url))
  return parquetReadObjects({ file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer })
}

const split = process.argv[2] ?? 'all'
const errIdx = process.argv.indexOf('--errors')
const errScenario = errIdx > 0 ? process.argv[errIdx + 1] : null

const [prod, cust, txn, pos, lines, gtRows, splits] = await Promise.all(
  ['products', 'customers', 'transactions', 'purchase_orders', 'po_lines', 'ground_truth', 'splits'].map(load))
const ctx = buildContext(prod.map(toProduct), cust.map(toCustomer), txn.map(toTxn))
const headers = pos.map(toHeader).sort((a, b) => a.po_date.localeCompare(b.po_date) || a.po_id.localeCompare(b.po_id))
const linesByPo = new Map<string, ReturnType<typeof toLine>[]>()
for (const l of lines.map(toLine)) {
  if (!linesByPo.has(l.po_id)) linesByPo.set(l.po_id, [])
  linesByPo.get(l.po_id)!.push(l)
}
const splitOf = new Map(splits.map((r) => [String(r.po_id), String(r.split)]))
const gt = new Map(gtRows.map((r) => asStrings<GroundTruth>(r)).map((g) => [g.po_line_id, g]))

const t0 = performance.now()
const results = []
for (const h of headers) {
  const ls = linesByPo.get(h.po_id) ?? []
  const r = processPO(ctx, DEFAULT_RULES, { header: h, lines: ls, source: 'inbox' })
  registerPO(ctx, h, ls) // inbox arrives in date order; later POs can be checked against it
  if (split === 'all' || splitOf.get(h.po_id) === split) results.push(r)
}
const ms = performance.now() - t0
const pairs = pairResults(results, gt)
const m = computeMetrics(pairs)
const pct = (r: { value: number | null; num: number; den: number }) => `${r.value === null ? '—' : (r.value * 100).toFixed(1) + '%'} (${r.num}/${r.den})`
console.log(`split=${split} POs=${m.pos} lines=${m.lines} in ${ms.toFixed(0)}ms`)
for (const [k, v] of Object.entries(m)) if (typeof v === 'object') console.log(k.padEnd(20), pct(v))

console.log('\nBy difficulty: sku | exc | FAAR | STP')
for (const [k, v] of sliceBy(pairs, (p) => p.gt.difficulty_level))
  console.log(k.padEnd(10), pct(v.skuAccuracy), '|', pct(v.exceptionAccuracy), '|', pct(v.falseAutoApproval), '|', pct(v.stpLine))
console.log('\nBy scenario: exc-acc | action-acc | FAAR')
for (const [k, v] of [...sliceBy(pairs, (p) => p.gt.scenario_type)].sort())
  console.log(k.padEnd(36), pct(v.exceptionAccuracy).padEnd(22), pct(v.actionAccuracy).padEnd(22), pct(v.falseAutoApproval))
console.log('\nSweep', sweepThreshold(pairs, [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]).map((s) => `${s.threshold}: FAAR ${(s.falseAutoApproval * 100).toFixed(1)} STP ${(s.stp * 100).toFixed(1)}`).join(' | '))

const pc = new Map<string, number>()
for (const p of pairs) if (p.gt.reference_price_source !== 'not_applicable' && p.r.price.status !== p.gt.expected_price_status) { const k = `${p.gt.expected_price_status} -> ${p.r.price.status} [${p.gt.reference_price_source}/${p.r.price.source}]`; pc.set(k, (pc.get(k) ?? 0) + 1) }
console.log('\nPrice confusions', [...pc].sort((a, b) => b[1] - a[1]).slice(0, 12))
if (errScenario) {
  const errs = pairs.filter((p) => p.gt.scenario_type === errScenario && p.r.exception !== p.gt.expected_exception_type)
  for (const p of errs.slice(0, 25)) {
    console.log('\n---', p.gt.po_line_id, 'expected', p.gt.expected_exception_type, p.gt.true_sku, '| got', p.r.exception, p.r.match.status, p.r.match.sku, p.r.match.confidence.toFixed(2))
    console.log('  desc:', JSON.stringify(p.r.input.customer_item_description), 'col:', p.r.input.colour_text, 'gsm:', p.r.input.gsm_text, 'uom:', p.r.input.uom_text, 'rem:', p.r.input.line_remarks)
    console.log('  ', p.r.trace.map((t) => t.text).join(' || '))
  }
}
