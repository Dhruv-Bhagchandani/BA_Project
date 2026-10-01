// ---------------------------------------------------------------------------
// Evaluation protocol (DATASET_DOCUMENTATION.md §10).
// Compares agent output against the hidden ground truth, overall and sliced.
// ---------------------------------------------------------------------------
import { resolve, type LineResult, type POResult } from './engine'
import type { Difficulty, GroundTruth, MatchStatus } from './types'

export interface Ratio { num: number; den: number; value: number | null }
const ratio = (num: number, den: number): Ratio => ({ num, den, value: den ? num / den : null })

export interface Metrics {
  lines: number
  pos: number
  skuAccuracy: Ratio
  candidateRecall: Ratio
  extractQty: Ratio
  extractUom: Ratio
  extractPrice: Ratio
  priceValidation: Ratio
  exceptionAccuracy: Ratio
  actionAccuracy: Ratio
  exceptionRecall: Ratio
  falseAutoApproval: Ratio
  falseEscalation: Ratio
  stpLine: Ratio
  stpOrder: Ratio
  hallucination: Ratio
}

export interface Pair { r: LineResult; gt: GroundTruth; poId: string }

const numEq = (a: number | null, b: string) => {
  if (b.trim() === '') return a === null
  return a !== null && Math.abs(a - Number(b)) < 0.051 // documents may print one decimal
}

export function computeMetrics(pairs: Pair[]): Metrics {
  const single = pairs.filter((p) => ['exact_match', 'high_confidence_match'].includes(p.gt.expected_match_status))
  const ambiguous = pairs.filter((p) => p.gt.expected_match_status === 'ambiguous_multiple_candidates')
  const refLines = pairs.filter((p) => p.gt.reference_price_source !== 'not_applicable')
  const exc = pairs.filter((p) => p.gt.expected_exception_type !== 'none')
  const neg = pairs.filter((p) => p.gt.should_auto_process !== 'TRUE')
  const pos = pairs.filter((p) => p.gt.should_auto_process === 'TRUE')
  const noMatch = pairs.filter((p) => p.gt.expected_match_status === 'no_match')
  const withQty = pairs.filter((p) => p.gt.extracted_quantity_true !== '')
  const withPrice = pairs.filter((p) => p.gt.extracted_unit_price_true !== '')

  const byPO = new Map<string, Pair[]>()
  for (const p of pairs) {
    if (!byPO.has(p.poId)) byPO.set(p.poId, [])
    byPO.get(p.poId)!.push(p)
  }
  let stpPOs = 0
  for (const ls of byPO.values()) if (ls.every((p) => p.r.autoProcess && p.gt.should_auto_process === 'TRUE')) stpPOs++

  return {
    lines: pairs.length,
    pos: byPO.size,
    skuAccuracy: ratio(single.filter((p) => p.r.match.sku === p.gt.true_sku && p.r.match.status !== 'ambiguous_multiple_candidates').length, single.length),
    candidateRecall: ratio(ambiguous.filter((p) => !p.r.autoProcess && p.r.match.candidates.some((c) => c.sku === p.gt.true_sku)).length, ambiguous.length),
    extractQty: ratio(withQty.filter((p) => numEq(p.r.parsed.qty, p.gt.extracted_quantity_true)).length, withQty.length),
    extractUom: ratio(pairs.filter((p) => p.r.parsed.uomRaw === p.gt.extracted_uom_true).length, pairs.length),
    extractPrice: ratio(withPrice.filter((p) => numEq(p.r.parsed.price, p.gt.extracted_unit_price_true)).length, withPrice.length),
    priceValidation: ratio(refLines.filter((p) => p.r.price.status === p.gt.expected_price_status).length, refLines.length),
    exceptionAccuracy: ratio(pairs.filter((p) => p.r.exception === p.gt.expected_exception_type).length, pairs.length),
    actionAccuracy: ratio(pairs.filter((p) => p.r.action === p.gt.expected_action).length, pairs.length),
    exceptionRecall: ratio(exc.filter((p) => p.r.exception !== 'none').length, exc.length),
    falseAutoApproval: ratio(neg.filter((p) => p.r.autoProcess).length, neg.length),
    falseEscalation: ratio(pos.filter((p) => !p.r.autoProcess).length, pos.length),
    stpLine: ratio(pairs.filter((p) => p.r.autoProcess && p.gt.should_auto_process === 'TRUE').length, pairs.length),
    stpOrder: ratio(stpPOs, byPO.size),
    hallucination: ratio(noMatch.filter((p) => !!p.r.match.sku && p.r.match.status !== 'no_match').length, noMatch.length),
  }
}

export function pairResults(results: POResult[], gt: Map<string, GroundTruth>): Pair[] {
  const out: Pair[] = []
  for (const po of results)
    for (const r of po.lines) {
      const g = gt.get(r.input.po_line_id)
      if (g) out.push({ r, gt: g, poId: po.input.header.po_id })
    }
  return out
}

export function sliceBy<K extends string>(pairs: Pair[], key: (p: Pair) => K): Map<K, Metrics> {
  const groups = new Map<K, Pair[]>()
  for (const p of pairs) {
    const k = key(p)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(p)
  }
  return new Map([...groups].map(([k, v]) => [k, computeMetrics(v)]))
}

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'exception']

/** Re-decide each line at a different confidence threshold without re-running matching. */
export function sweepThreshold(pairs: Pair[], thresholds: number[]) {
  return thresholds.map((t) => {
    let fa = 0, neg = 0, stp = 0, esc = 0, posN = 0
    for (const p of pairs) {
      let status: MatchStatus = p.r.match.status
      if (status === 'high_confidence_match' && p.r.match.confidence < t) status = 'low_confidence_match'
      if (status === 'low_confidence_match' && p.r.match.sku && p.r.match.confidence >= t && p.r.match.method.startsWith('quality') && !p.r.flags.some((f) => ['attribute_conflict', 'partial_match', 'unmapped_code'].includes(f))) status = 'high_confidence_match'
      const [, , auto] = resolve(status, p.r.price.status, new Set(p.r.flags))
      const truth = p.gt.should_auto_process === 'TRUE'
      if (!truth) { neg++; if (auto) fa++ }
      else { posN++; if (auto) stp++; else esc++ }
    }
    return {
      threshold: t,
      falseAutoApproval: neg ? fa / neg : 0,
      stp: pairs.length ? stp / pairs.length : 0,
      falseEscalation: posN ? esc / posN : 0,
    }
  })
}

export function confusion(pairs: Pair[]) {
  const m = new Map<string, Map<string, number>>()
  for (const p of pairs) {
    const a = p.gt.expected_action
    const b = p.r.action
    if (!m.has(a)) m.set(a, new Map())
    m.get(a)!.set(b, (m.get(a)!.get(b) ?? 0) + 1)
  }
  return m
}
