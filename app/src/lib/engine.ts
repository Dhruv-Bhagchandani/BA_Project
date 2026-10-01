// ---------------------------------------------------------------------------
// The PO -> SO agent.
//
// Stage 2 of the pipeline (after document extraction):
//   1. understand the line      (normalise text, pull GSM / width / colour / ratio)
//   2. match to the catalogue   (IDF-weighted token match over quality groups,
//                                then colour within the group; never guesses)
//   3. validate commercial data (UOM, quantity, price vs reference as of PO date)
//   4. decide                   (fixed precedence ladder -> exception + action)
//   5. draft the sales-order line
//
// Every decision carries a human-readable trace so a reviewer can see *why*.
// ---------------------------------------------------------------------------
import {
  canonicalColour, normaliseUom, parseDescription, parseGsm, parsePrice, parseQuantity,
  parseWidth, qualityTokens, setVocabulary, YARDS_PER_METRE, type ParsedDescription, type UomNorm,
} from './normalize'
import type {
  Action, Customer, ExceptionType, Flag, MatchStatus, POHeader, POInput, POLineInput, PriceStatus,
  Product, Rules, SoLineStatus, Txn,
} from './types'

// ---------------------------------------------------------------------------
// Context (built once from master data)
// ---------------------------------------------------------------------------
interface QualityGroup {
  id: string
  family: string
  sub: string
  composition: string
  gsm: number
  width: number | null
  uom: string
  tokens: string[]
  ratio: string | null
  skus: Product[]           // active and inactive
}

export interface EngineContext {
  products: Product[]
  productBySku: Map<string, Product>
  groups: QualityGroup[]
  groupById: Map<string, QualityGroup>
  idf: Map<string, number>
  customers: Map<string, Customer>
  txnsByPair: Map<string, Txn[]>          // `${cust}|${sku}` -> sorted by date
  txnsByCustomer: Map<string, Txn[]>
  globalMedianQty: Record<string, number>
  /** prior POs for duplicate detection: customer -> list */
  poHistory: Map<string, { po_id: string; po_number: string; po_date: string; signature: string[] }[]>
  /** customer item code -> sku, learned from human review (human-in-the-loop) */
  learnedCodes: Map<string, string>
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Format-insensitive fingerprint of a line: re-sent POs re-type "1,200" as "1200", "Rs. 99" as "99.00". */
export function lineSignature(l: POLineInput) {
  const q = parseQuantity(l.quantity_text).value
  const p = parsePrice(l.unit_price_text)
  return `${l.customer_item_description.trim().toLowerCase().replace(/\s+/g, ' ')}|${q ?? '-'}|${p === null ? '-' : Math.round(p)}`
}

export function buildContext(
  products: Product[],
  customers: Customer[],
  txns: Txn[],
  priorPOs: { header: POHeader; lines: POLineInput[] }[] = [],
): EngineContext {
  const productBySku = new Map(products.map((p) => [p.sku, p]))
  const gmap = new Map<string, QualityGroup>()
  for (const p of products) {
    let g = gmap.get(p.quality_group_id)
    if (!g) {
      const ratio = p.composition.match(/(\d{2,3})\/(\d{1,2})/)
      g = {
        id: p.quality_group_id, family: p.product_family, sub: p.sub_category, composition: p.composition,
        gsm: p.gsm, width: p.width_inch, uom: p.uom,
        tokens: [...new Set(qualityTokens(`${p.composition} ${p.sub_category}`))],
        ratio: ratio ? `${ratio[1]}/${ratio[2]}` : p.composition.includes('100%') ? '100' : null,
        skus: [],
      }
      gmap.set(g.id, g)
    }
    g.skus.push(p)
  }
  const groups = [...gmap.values()]
  // IDF of quality tokens across quality groups
  const df = new Map<string, number>()
  for (const g of groups) for (const t of g.tokens) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = new Map<string, number>()
  for (const [t, n] of df) idf.set(t, Math.log(1 + groups.length / n))

  const vocab = new Set<string>()
  for (const g of groups) for (const t of g.tokens) vocab.add(t)
  for (const p of products) for (const w of p.product_family.toLowerCase().split(/\s+/)) vocab.add(w)
  setVocabulary(vocab)

  const txnsByPair = new Map<string, Txn[]>()
  const txnsByCustomer = new Map<string, Txn[]>()
  for (const t of txns) {
    const k = `${t.customer_id}|${t.sku}`
    if (!txnsByPair.has(k)) txnsByPair.set(k, [])
    txnsByPair.get(k)!.push(t)
    if (!txnsByCustomer.has(t.customer_id)) txnsByCustomer.set(t.customer_id, [])
    txnsByCustomer.get(t.customer_id)!.push(t)
  }
  for (const arr of txnsByPair.values()) arr.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
  for (const arr of txnsByCustomer.values()) arr.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
  const globalMedianQty: Record<string, number> = {}
  for (const u of ['MTR', 'KG', 'PCS']) globalMedianQty[u] = median(txns.filter((t) => t.uom === u).map((t) => t.quantity))

  const ctx: EngineContext = {
    products, productBySku, groups, groupById: gmap, idf,
    customers: new Map(customers.map((c) => [c.customer_id, c])),
    txnsByPair, txnsByCustomer, globalMedianQty, poHistory: new Map(), learnedCodes: new Map(),
  }
  for (const po of priorPOs) registerPO(ctx, po.header, po.lines)
  return ctx
}

export function registerPO(ctx: EngineContext, header: POHeader, lines: POLineInput[]) {
  const list = ctx.poHistory.get(header.customer_id) ?? []
  if (list.some((p) => p.po_id === header.po_id)) return
  list.push({ po_id: header.po_id, po_number: header.po_number, po_date: header.po_date, signature: lines.map(lineSignature) })
  ctx.poHistory.set(header.customer_id, list)
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
export interface Candidate { sku: string; name: string; score: number; note: string; inHistory: boolean }

export interface TraceStep { stage: 'extract' | 'match' | 'price' | 'quantity' | 'policy' | 'decision'; ok: boolean | null; text: string }

export interface LineResult {
  input: POLineInput
  parsed: {
    desc: ParsedDescription
    qty: number | null
    qtyApprox: boolean
    uomRaw: string
    uom: UomNorm | null
    price: number | null
    gsm: number | null
    width: number | null
    colour: string | null
    colourColumn: string | null
  }
  match: {
    status: MatchStatus
    sku: string | null
    product: Product | null
    confidence: number
    candidates: Candidate[]
    method: string
  }
  price: {
    status: PriceStatus
    reference: number | null
    source: 'customer_last_transacted' | 'customer_stale_transacted' | 'tier_list_price' | 'not_applicable'
    ageDays: number | null
    lastDate: string | null
    deltaPct: number | null
    history: { date: string; price: number }[]
  }
  flags: Flag[]
  exception: ExceptionType
  action: Action
  autoProcess: boolean
  soStatus: SoLineStatus
  so: { qty: number | null; uom: string; unitPrice: number | null; value: number | null; gstPct: number; hsn: string } | null
  trace: TraceStep[]
}

export interface POResult {
  input: POInput
  customer: Customer | null
  isNewCustomer: boolean
  duplicateOf: { po_id: string; po_number: string; po_date: string } | null
  lines: LineResult[]
  summary: {
    lines: number
    auto: number
    autoFlagged: number
    review: number
    rejected: number
    orderValue: number
    autoValue: number
    straightThrough: boolean
    status: 'auto_approved' | 'partially_approved' | 'needs_review' | 'on_hold'
  }
}

// ---------------------------------------------------------------------------
// Resolver — identical precedence ladder to the dataset's ground truth
// ---------------------------------------------------------------------------
export function resolve(
  matchStatus: MatchStatus,
  priceStatus: PriceStatus,
  flags: Set<Flag>,
): [ExceptionType, Action, boolean, SoLineStatus] {
  if (flags.has('malformed')) return ['incomplete_line', 'manual_entry', false, 'do_not_create']
  if (flags.has('illegible')) return ['illegible_document', 'manual_entry', false, 'hold_for_review']
  if (matchStatus === 'no_match') return ['unknown_product', 'reject_line', false, 'do_not_create']
  if (flags.has('duplicate')) return ['duplicate_order', 'hold_duplicate_check', false, 'hold_for_review']
  if (flags.has('missing_qty')) return ['missing_quantity', 'request_clarification', false, 'hold_for_review']
  if (flags.has('conflicting')) return ['conflicting_data', 'request_clarification', false, 'hold_for_review']
  if (matchStatus === 'ambiguous_multiple_candidates') return ['ambiguous_match', 'review_match', false, 'hold_for_review']
  if (flags.has('attribute_conflict')) return ['attribute_conflict', 'review_match', false, 'hold_for_review']
  if (flags.has('partial_match')) return ['partial_match', 'review_match', false, 'hold_for_review']
  if (flags.has('unmapped_code')) return ['unmapped_customer_code', 'review_match', false, 'hold_for_review']
  if (matchStatus === 'low_confidence_match') return ['low_confidence_match', 'review_match', false, 'hold_for_review']
  if (flags.has('uom_incompatible')) return ['uom_mismatch', 'review_uom', false, 'hold_for_review']
  if (priceStatus === 'outside_tolerance_high' || priceStatus === 'outside_tolerance_low')
    return ['price_variance_major', 'review_price', false, 'hold_for_review']
  if (flags.has('new_customer')) return ['new_customer_no_history', 'review_price', false, 'hold_for_review']
  if (flags.has('qty_outlier')) return ['quantity_outlier', 'review_quantity', false, 'hold_for_review']
  if (flags.has('uom_convertible')) return ['uom_converted', 'auto_process_with_flag', true, 'create_so_line_flagged']
  if (priceStatus === 'stale_reference_price') return ['stale_reference_price', 'auto_process_with_flag', true, 'create_so_line_flagged']
  if (priceStatus === 'no_reference_price') return ['no_reference_price', 'auto_process_with_flag', true, 'create_so_line_flagged']
  if (priceStatus === 'minor_variance_acceptable') return ['price_variance_minor', 'auto_process_with_flag', true, 'create_so_line_flagged']
  return ['none', 'auto_process', true, 'create_so_line']
}

function priceStatusFromDelta(delta: number, source: string, rules: Rules): PriceStatus {
  const a = Math.abs(delta)
  if (a > rules.price_tolerance_flag_pct) return delta > 0 ? 'outside_tolerance_high' : 'outside_tolerance_low'
  if (source === 'tier_list_price') return 'no_reference_price'
  if (source === 'customer_stale_transacted') return 'stale_reference_price'
  if (a <= rules.price_tolerance_auto_pct) return 'within_tolerance'
  return 'minor_variance_acceptable'
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

const TIER_DISCOUNT: Record<string, number> = { A: 0.12, B: 0.07, C: 0.03 }

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
interface GroupScore { g: QualityGroup; text: number; recall: number; precision: number; gsmOk: boolean | null; widthOk: boolean | null; total: number }

function scoreGroups(ctx: EngineContext, d: ParsedDescription, gsm: number | null, width: number | null): GroupScore[] {
  const descSet = new Set(d.tokens)
  const descKnown = d.tokens.filter((t) => ctx.idf.has(t))
  const descW = descKnown.reduce((s, t) => s + (ctx.idf.get(t) ?? 0), 0)
  const ratioStated = d.ratios.length ? d.ratios : d.tokens.includes('r100') ? ['100'] : []
  const out: GroupScore[] = []
  for (const g of ctx.groups) {
    let hit = 0
    let tot = 0
    for (const t of g.tokens) {
      const w = ctx.idf.get(t) ?? 0
      tot += w
      if (descSet.has(t)) hit += w
    }
    const recall = tot ? hit / tot : 0
    let ph = 0
    for (const t of descKnown) if (g.tokens.includes(t)) ph += ctx.idf.get(t) ?? 0
    const precision = descW ? ph / descW : 0
    let text = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0
    // explicit composition ratio that contradicts the group is a strong negative
    if (ratioStated.length && g.ratio) {
      const gr = g.ratio === '100' ? 'r100' : 'r' + g.ratio.replace('/', '_')
      if (!ratioStated.some((r) => (r === '100' ? 'r100' : 'r' + r.replace('/', '_')) === gr)) text *= 0.75
    }
    const gsmOk = gsm === null ? null : gsm === g.gsm
    const widthOk = width === null || g.width === null ? null : width === g.width
    const total = text * 0.7 + (gsmOk === null ? 0.12 : gsmOk ? 0.25 : 0) + (widthOk === null ? 0.03 : widthOk ? 0.05 : 0)
    out.push({ g, text, recall, precision, gsmOk, widthOk, total })
  }
  out.sort((a, b) => b.total - a.total)
  return out
}

function customerSkus(ctx: EngineContext, customerId: string, poDate: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of ctx.txnsByCustomer.get(customerId) ?? []) {
    if (t.transaction_date > poDate) break
    m.set(t.sku, (m.get(t.sku) ?? 0) + 1)
  }
  return m
}

function toCandidate(p: Product, note: string, hist: Map<string, number>, score = 0): Candidate {
  return { sku: p.sku, name: p.product_name, score, note, inHistory: hist.has(p.sku) }
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Line processing
// ---------------------------------------------------------------------------
export function processLine(
  ctx: EngineContext,
  rules: Rules,
  line: POLineInput,
  header: POHeader,
  opts: { customer: Customer | null; isNewCustomer: boolean; duplicate: boolean; hist: Map<string, number> },
): LineResult {
  const trace: TraceStep[] = []
  const flags = new Set<Flag>()
  const d = parseDescription(line.customer_item_description)

  // ---------------- extraction -----------------
  const q = parseQuantity(line.quantity_text)
  const uom = normaliseUom(line.uom_text)
  const price = parsePrice(line.unit_price_text)
  const gsmCol = parseGsm(line.gsm_text + ' gsm') ?? (/^\s*\d{2,3}\s*$/.test(line.gsm_text) ? Number(line.gsm_text) : null)
  const gsm = /^\s*\d{2,3}\s*$/.test(line.gsm_text) ? Number(line.gsm_text) : d.gsm ?? gsmCol
  const width = /^\s*\d{2,3}\s*$/.test(line.width_text) ? Number(line.width_text) : d.width ?? parseWidth(line.width_text + ' inch')
  const colourColumn = line.colour_text ? canonicalColour(line.colour_text) : null
  if (line.gsm_text.trim() && !/^\s*\d{2,3}\s*$/.test(line.gsm_text)) d.ocrSignals.push(`GSM column unreadable "${line.gsm_text}"`)
  if (line.legibility === 'illegible' || line.legibility === 'uncertain') d.ocrSignals.push(`extractor reported this line as ${line.legibility}`)
  if (line.colour_text.trim() && /\d/.test(line.colour_text)) d.ocrSignals.push(`colour column damaged "${line.colour_text}"`)
  // a fuzzy colour read from a misspelt description defers to an explicit colour column
  const descColour = d.colourFuzzy && colourColumn ? colourColumn : d.colours[0] ?? null
  const colour = descColour ?? colourColumn

  trace.push({
    stage: 'extract', ok: null,
    text: `Read: ${[
      gsm ? `${gsm} GSM` : 'no GSM', width ? `${width}"` : 'no width', colour ? `colour ${colour}` : 'no colour',
      d.ratios.length ? `ratio ${d.ratios.join(',')}` : null,
      d.corrected.length ? `corrected ${d.corrected.map((c) => `${c.from}→${c.to}`).join(', ')}` : null,
    ].filter(Boolean).join(' · ')}`,
  })

  // ---------------- data-integrity checks -----------------
  const explicitCode = line.customer_item_code.trim() || d.customerCodes[0] || ''
  const codeOnly = (d.customerCodes.length > 0 || /\bcode\b/i.test(d.raw)) && d.tokens.length === 0 && gsm === null && !d.jargonFamily && !colour

  if (d.ocrSignals.length >= 1 && !codeOnly) {
    flags.add('illegible')
    trace.push({ stage: 'extract', ok: false, text: `Document legibility: ${d.ocrSignals.slice(0, 3).join('; ')} — digits on this line cannot be trusted` })
  }
  if (!codeOnly && d.malformed && !flags.has('illegible')) {
    flags.add('malformed')
    trace.push({ stage: 'extract', ok: false, text: `"${d.raw.trim() || '(blank)'}" carries no resolvable product attributes — needs manual entry` })
  }
  if (q.value === null) {
    flags.add('missing_qty')
    trace.push({ stage: 'quantity', ok: false, text: `Quantity "${q.raw || 'blank'}" is not a number — will not infer it from history` })
  }
  if (opts.duplicate) flags.add('duplicate')

  // ---------------- matching -----------------
  let status: MatchStatus = 'low_confidence_match'
  let sku: string | null = null
  let confidence = 0
  let candidates: Candidate[] = []
  let method = ''

  const learned = explicitCode ? ctx.learnedCodes.get(`${header.customer_id}|${explicitCode}`) : undefined

  if (d.nonCatalogue.length) {
    status = 'no_match'
    confidence = 0.02
    method = 'non-catalogue material'
    trace.push({ stage: 'match', ok: false, text: `"${d.nonCatalogue.join(', ')}" is not a material we stock — no SKU will be proposed` })
  } else if (learned && ctx.productBySku.has(learned)) {
    const p = ctx.productBySku.get(learned)!
    status = 'high_confidence_match'
    sku = p.sku
    confidence = 0.9
    method = 'learned customer code'
    candidates = [toCandidate(p, `code ${explicitCode} learned from earlier review`, opts.hist, 1)]
    trace.push({ stage: 'match', ok: true, text: `Customer code ${explicitCode} was mapped to ${p.sku} by a reviewer earlier` })
  } else if (codeOnly) {
    flags.add('unmapped_code')
    status = 'low_confidence_match'
    confidence = 0.1
    method = 'customer code only'
    trace.push({ stage: 'match', ok: false, text: `Only the customer's own code ${explicitCode || ''} is given; no catalogue attributes to resolve it` })
  } else if (flags.has('malformed')) {
    status = 'low_confidence_match'
    confidence = 0.05
    method = 'unresolvable text'
  } else {
    // does the line speak only in family-level trade jargon?
    let familyOnly = false
    if (d.jargonFamily) {
      const jt = new Set(qualityTokens(d.jargonPhrase!))
      const rest = d.tokens.filter((t) => !jt.has(t) && ctx.idf.has(t))
      familyOnly = rest.length === 0
    }

    if (familyOnly) {
      const fam = d.jargonFamily!
      let pool = ctx.products.filter((p) => p.product_family === fam && p.is_active)
      method = `trade jargon → ${fam}`
      if (gsm !== null) pool = pool.filter((p) => p.gsm === gsm)
      if (width !== null) {
        const w = pool.filter((p) => p.width_inch === width)
        if (w.length) pool = w
      }
      if (colour) pool = pool.filter((p) => p.colour === colour)
      const histPool = pool.filter((p) => opts.hist.has(p.sku))
      if (gsm !== null && colour && pool.length === 1) {
        status = 'high_confidence_match'
        sku = pool[0].sku
        confidence = histPool.length ? 0.86 : 0.74
        candidates = [toCandidate(pool[0], 'unique SKU in family with this GSM + colour', opts.hist, 1)]
        trace.push({ stage: 'match', ok: true, text: `Jargon "${d.jargonPhrase}" → ${fam}; ${gsm} GSM + ${colour} leaves exactly one SKU` })
      } else if (gsm !== null && colour && histPool.length === 1) {
        status = 'high_confidence_match'
        sku = histPool[0].sku
        confidence = 0.8
        candidates = pool.map((p) => toCandidate(p, p.sku === sku ? 'bought before by this customer' : 'same family/GSM/colour', opts.hist))
        trace.push({ stage: 'match', ok: true, text: `${pool.length} SKUs fit; buying history picks ${sku}` })
      } else if (pool.length === 0) {
        status = 'low_confidence_match'
        confidence = 0.2
        trace.push({ stage: 'match', ok: false, text: `Jargon "${d.jargonPhrase}" → ${fam}, but nothing in that family fits the stated attributes` })
      } else {
        status = 'ambiguous_multiple_candidates'
        confidence = 0.25
        const ordered = [...histPool, ...pool.filter((p) => !opts.hist.has(p.sku))]
        candidates = ordered.map((p) => toCandidate(p, opts.hist.has(p.sku) ? 'bought before by this customer' : 'same family', opts.hist))
        trace.push({ stage: 'match', ok: false, text: `Only family-level intent ("${d.jargonPhrase}") — ${pool.length} candidate SKUs; will not guess` })
      }
    } else {
      const scored = scoreGroups(ctx, d, gsm, width)
      const bestText = Math.max(...scored.map((s) => s.text))
      // groups that read as the same quality on text, then pick by GSM/width
      const textTop = scored.filter((s) => s.text >= bestText - 0.06)
      let chosen: GroupScore | undefined
      let gsmConflict = false
      if (gsm !== null) {
        const withGsm = textTop.filter((s) => s.gsmOk)
        // abbreviations/typos can blur the composition: look a little wider for a group that
        // agrees on GSM *and* offers the stated colour before calling it a conflict
        const descTok = new Set(d.tokens)
        const wider = scored.filter((s) => s.gsmOk && s.text >= bestText - 0.3 && s.text >= 0.45 &&
          qualityTokens(s.g.sub).every((t) => descTok.has(t)) &&
          (!colour || s.g.skus.some((p) => p.colour === colour)))
        if (withGsm.length) chosen = withGsm.sort((a, b) => b.total - a.total)[0]
        else if (wider.length) chosen = wider[0]
        else if (bestText >= 0.6 && !scored.slice(0, 5).some((s) => s.gsmOk && s.text >= bestText - 0.15)) {
          chosen = textTop[0]
          gsmConflict = true
        } else chosen = scored[0]
      } else chosen = scored[0]

      // tie-break between groups that read identically (often differing only by width / GSM)
      const peers = scored.filter((s) => s !== chosen && Math.abs(s.total - chosen!.total) < 0.015 && s.text >= chosen!.text - 0.01)
      if (peers.length && colour) {
        const hasColour = [chosen!, ...peers].filter((s) => s.g.skus.some((p) => p.colour === colour))
        if (hasColour.length) chosen = hasColour.sort((a, b) =>
          (b.g.skus.some((p) => opts.hist.has(p.sku)) ? 1 : 0) - (a.g.skus.some((p) => opts.hist.has(p.sku)) ? 1 : 0))[0]
      }
      const g = chosen!.g
      const runnerUp = scored.find((s) => s.g !== g && !(s.g.tokens.join() === g.tokens.join() && s.g.gsm === g.gsm))
      const margin = chosen!.total - (runnerUp?.total ?? 0)
      method = `quality match ${g.id}`

      if (chosen!.text < 0.35) {
        status = 'low_confidence_match'
        confidence = Math.max(0.05, chosen!.text * 0.6)
        candidates = scored.slice(0, 5).flatMap((s) => s.g.skus.filter((p) => p.is_active).slice(0, 2))
          .slice(0, 6).map((p) => toCandidate(p, 'weak textual similarity', opts.hist))
        trace.push({ stage: 'match', ok: false, text: `Best catalogue similarity is only ${(chosen!.text * 100).toFixed(0)}% — not a confident identity` })
      } else {
        const gsmTxt = gsm === null ? '' : gsmConflict ? ` but stated ${gsm} GSM does not exist (catalogue has ${g.gsm})` : ` at ${g.gsm} GSM`
        trace.push({
          stage: 'match', ok: !gsmConflict,
          text: `Quality ${g.id}: ${g.composition} ${g.sub}${gsmTxt} (text ${(chosen!.text * 100).toFixed(0)}%, margin ${(margin * 100).toFixed(0)} pts)`,
        })
        const active = g.skus.filter((p) => p.is_active)
        const siblings = active.length ? active : g.skus
        const colourConflict = descColour && colourColumn && descColour !== colourColumn
        let base = 0.45 + 0.45 * chosen!.text + Math.min(0.1, margin)
        base -= 0.03 * d.corrected.length
        if (gsm === null) base -= 0.05

        if (gsmConflict) {
          flags.add('attribute_conflict')
          status = 'low_confidence_match'
          const sib = colour ? g.skus.find((p) => p.colour === colour) : undefined
          sku = sib?.sku ?? null
          confidence = 0.3
          candidates = siblings.map((p) => toCandidate(p, `${p.gsm} GSM in this quality`, opts.hist))
        } else if (colourConflict) {
          flags.add('attribute_conflict')
          status = 'low_confidence_match'
          const sib = g.skus.find((p) => p.colour === descColour)
          sku = sib?.sku ?? null
          confidence = 0.3
          candidates = siblings.map((p) => toCandidate(p, p.colour === descColour ? 'colour in description' : p.colour === colourColumn ? 'colour in colour column' : 'sibling', opts.hist))
          trace.push({ stage: 'match', ok: false, text: `Description says ${descColour}, colour column says ${colourColumn}` })
        } else if (!colour) {
          if (siblings.length === 1) {
            status = 'high_confidence_match'
            sku = siblings[0].sku
            confidence = base - 0.05
            candidates = [toCandidate(siblings[0], 'only colour in this quality', opts.hist, 1)]
            trace.push({ stage: 'match', ok: true, text: `No colour stated, but ${g.id} is offered in one colour only` })
          } else {
            status = 'ambiguous_multiple_candidates'
            confidence = 0.3
            candidates = siblings.map((p) => toCandidate(p, `colour ${p.colour}`, opts.hist))
            trace.push({ stage: 'match', ok: false, text: `Colour not stated — ${siblings.length} SKUs share this quality (${siblings.map((p) => p.colour).join(', ')}); returning all` })
          }
        } else {
          const p = g.skus.find((x) => x.colour === colour)
          if (!p) {
            flags.add('partial_match')
            status = 'low_confidence_match'
            confidence = 0.35
            candidates = siblings.map((x) => toCandidate(x, `offered colour ${x.colour}`, opts.hist))
            trace.push({ stage: 'match', ok: false, text: `Quality exists but ${colour} is not offered (has ${siblings.map((x) => x.colour).join(', ')}); will not substitute a colour` })
          } else {
            sku = p.sku
            const exact = normName(d.raw) === normName(p.product_name)
            status = exact ? 'exact_match' : 'high_confidence_match'
            confidence = exact ? 0.99 : Math.min(0.97, base + (opts.hist.has(p.sku) ? 0.03 : 0))
            candidates = [toCandidate(p, exact ? 'verbatim catalogue name' : 'attributes reconcile', opts.hist, chosen!.total)]
            for (const s of scored.slice(0, 4)) {
              if (s.g === g) continue
              const alt = s.g.skus.find((x) => x.colour === colour) ?? s.g.skus[0]
              candidates.push(toCandidate(alt, `runner-up quality ${s.g.id}`, opts.hist, s.total))
              if (candidates.length >= 3) break
            }
            if (!p.is_active) trace.push({ stage: 'match', ok: false, text: `${p.sku} is discontinued (is_active = N)` })
            trace.push({ stage: 'match', ok: true, text: `${exact ? 'Exact' : 'Matched'} ${p.sku} — ${p.product_name}` })
          }
        }
      }
    }
  }

  if (sku && confidence < rules.confidence_threshold && (status === 'high_confidence_match')) {
    status = 'low_confidence_match'
    trace.push({ stage: 'policy', ok: false, text: `Confidence ${(confidence * 100).toFixed(0)}% is below the ${(rules.confidence_threshold * 100).toFixed(0)}% auto-approval threshold` })
  }

  // order candidates so SKUs this customer already buys come first
  candidates.sort((a, b) => Number(b.inHistory) - Number(a.inHistory))

  // ---------------- remarks that contradict the line -----------------
  const product = sku ? ctx.productBySku.get(sku)! : null
  // when we decline to commit, still give the reviewer price context against the leading candidate
  const priceProduct = product ?? (status !== 'no_match' && candidates.length ? ctx.productBySku.get(candidates[0].sku) ?? null : null)
  const rem = line.line_remarks.trim()
  if (rem) {
    const remColourRaw = rem.match(/(?:supply in|need)\s+([a-z][a-z .]+?)(?:\s+as discussed|,|\s+not\b|$)/i)
    const remColour = remColourRaw ? canonicalColour(remColourRaw[1]) : null
    const remGsm = rem.match(/(\d{2,3})\s*gsm/i)
    const remWidth = rem.match(/width\s+(?:to be\s+)?(\d{2,3})/i)
    const lineColour = colour ?? product?.colour ?? null
    const lineGsm = gsm ?? product?.gsm ?? null
    const lineWidth = width ?? product?.width_inch ?? null
    let why = ''
    if (remColour && remColour !== lineColour) why = `remarks ask for ${remColour}, line says ${lineColour ?? '—'}`
    else if (remGsm && lineGsm !== null && Number(remGsm[1]) !== lineGsm) why = `remarks say ${remGsm[1]} GSM, line says ${lineGsm}`
    else if (remWidth && Number(remWidth[1]) !== lineWidth) why = `remarks say ${remWidth[1]}" width, line/catalogue says ${lineWidth ?? '—'}`
    if (why) {
      flags.add('conflicting')
      trace.push({ stage: 'match', ok: false, text: `Conflicting instructions: ${why}` })
    }
  }

  // ---------------- UOM -----------------
  let soQty = q.value
  if (product && uom) {
    if (uom === 'YDS' && product.uom === 'MTR') {
      flags.add('uom_convertible')
      if (q.value !== null) soQty = Math.round((q.value / YARDS_PER_METRE) * 100) / 100
      trace.push({ stage: 'quantity', ok: true, text: `Ordered in yards; converted ${q.value ?? '?'} yd → ${soQty ?? '?'} m` })
    } else if (uom !== product.uom) {
      flags.add('uom_incompatible')
      trace.push({ stage: 'quantity', ok: false, text: `Ordered in ${line.uom_text} but ${product.sku} sells by ${product.uom}; no safe conversion without yield data` })
    }
  }

  // ---------------- quantity outlier -----------------
  if (product && soQty !== null) {
    const custQ = (ctx.txnsByCustomer.get(header.customer_id) ?? [])
      .filter((t) => t.uom === product.uom && t.transaction_date <= header.po_date).map((t) => t.quantity)
    const typical = custQ.length >= 3 ? median(custQ) : ctx.globalMedianQty[product.uom] ?? 0
    if ((typical && soQty > rules.qty_outlier_multiple * typical) || (product.uom === 'MTR' && soQty > rules.qty_outlier_abs_mtr)) {
      flags.add('qty_outlier')
      trace.push({ stage: 'quantity', ok: false, text: `${soQty.toLocaleString('en-IN')} ${product.uom} is ${(soQty / typical).toFixed(0)}× this customer's typical line (${typical}) — possible keying error` })
    }
  }

  // ---------------- price -----------------
  let pStatus: PriceStatus = 'not_applicable'
  let reference: number | null = null
  let source: LineResult['price']['source'] = 'not_applicable'
  let ageDays: number | null = null
  let lastDate: string | null = null
  let deltaPct: number | null = null
  let history: { date: string; price: number }[] = []
  if (priceProduct && status !== 'no_match') {
    const product = priceProduct
    const hist = (ctx.txnsByPair.get(`${header.customer_id}|${product.sku}`) ?? []).filter((t) => t.transaction_date <= header.po_date)
    history = hist.map((t) => ({ date: t.transaction_date, price: t.unit_price_inr }))
    if (hist.length) {
      const last = hist[hist.length - 1]
      reference = last.unit_price_inr
      lastDate = last.transaction_date
      ageDays = daysBetween(last.transaction_date, header.po_date)
      source = ageDays <= rules.reference_price_max_age_days ? 'customer_last_transacted' : 'customer_stale_transacted'
    } else {
      const tier = opts.customer?.commercial_tier ?? 'C'
      reference = Math.round(product.list_price_inr * (1 - (TIER_DISCOUNT[tier] ?? 0)) * 100) / 100
      source = 'tier_list_price'
    }
    if (price === null) {
      pStatus = 'no_price_quoted'
      trace.push({ stage: 'price', ok: null, text: `No price quoted; SO will carry reference ₹${reference.toFixed(2)}` })
    } else {
      deltaPct = Math.round(((price - reference) / reference) * 10000) / 100
      pStatus = priceStatusFromDelta(deltaPct, source, rules)
      const srcTxt = source === 'customer_last_transacted' ? `last sold to this customer on ${lastDate} (${ageDays} d ago)`
        : source === 'customer_stale_transacted' ? `last sold ${ageDays} days ago — STALE (> ${rules.reference_price_max_age_days} d)`
        : `no history for this customer — tier ${opts.customer?.commercial_tier ?? '?'} list price`
      trace.push({
        stage: 'price', ok: Math.abs(deltaPct) <= rules.price_tolerance_flag_pct,
        text: `${sku ? '' : `Indicative (vs leading candidate ${product.sku}): `}Quoted ₹${price.toFixed(2)} vs reference ₹${reference.toFixed(2)} (${srcTxt}): ${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%`,
      })
    }
  } else if (status !== 'no_match' && price !== null) {
    pStatus = 'not_applicable'
  }

  if (opts.isNewCustomer) flags.add('new_customer')

  const [exception, action, autoProcess, soStatus] = resolve(status, pStatus, flags)

  // ---------------- SO line -----------------
  let so: LineResult['so'] = null
  if (soStatus !== 'do_not_create' && product) {
    const unit = pStatus === 'outside_tolerance_high' || pStatus === 'outside_tolerance_low' || price === null ? reference : price
    so = {
      qty: soQty, uom: product.uom, unitPrice: unit,
      value: soQty !== null && unit !== null ? Math.round(soQty * unit * 100) / 100 : null,
      gstPct: product.gst_rate_pct, hsn: product.hsn_code,
    }
  }

  trace.push({
    stage: 'decision', ok: autoProcess,
    text: autoProcess
      ? (action === 'auto_process' ? 'All checks pass — create SO line automatically' : `Create SO line, flagged: ${exception.replace(/_/g, ' ')}`)
      : `Hold: ${exception.replace(/_/g, ' ')} → ${action.replace(/_/g, ' ')}`,
  })

  return {
    input: line,
    parsed: { desc: d, qty: q.value, qtyApprox: q.approx, uomRaw: line.uom_text, uom, price, gsm, width, colour, colourColumn },
    match: { status, sku, product, confidence: Math.max(0, Math.min(0.99, confidence)), candidates, method },
    price: { status: pStatus, reference, source, ageDays, lastDate, deltaPct, history },
    flags: [...flags], exception, action, autoProcess, soStatus, so, trace,
  }
}

// ---------------------------------------------------------------------------
// PO processing
// ---------------------------------------------------------------------------
export function findDuplicate(ctx: EngineContext, rules: Rules, header: POHeader, lines: POLineInput[]) {
  const prior = ctx.poHistory.get(header.customer_id) ?? []
  const sig = lines.map(lineSignature)
  for (const p of prior) {
    if (p.po_id === header.po_id || p.po_number === header.po_number) continue
    const gap = daysBetween(p.po_date, header.po_date)
    if (gap < 0 || gap > rules.duplicate_window_days) continue
    if (gap === 0 && p.po_id > header.po_id) continue
    if (p.signature.length !== sig.length) continue
    const same = sig.filter((s) => p.signature.includes(s)).length
    if (same / sig.length >= 0.8) return { po_id: p.po_id, po_number: p.po_number, po_date: p.po_date }
  }
  return null
}

export function resolveCustomer(ctx: EngineContext, input: POInput): Customer | null {
  const byId = ctx.customers.get(input.header.customer_id)
  if (byId) return byId
  const name = (input.customer_name_text ?? '').toLowerCase().replace(/[^a-z ]/g, '').trim()
  if (!name) return null
  let best: Customer | null = null
  let bestScore = 0
  for (const c of ctx.customers.values()) {
    const cn = c.customer_name.toLowerCase().replace(/[^a-z ]/g, '')
    const a = new Set(name.split(/\s+/))
    const b = new Set(cn.split(/\s+/))
    const inter = [...a].filter((x) => b.has(x)).length
    const s = inter / Math.max(a.size, b.size)
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  return bestScore >= 0.6 ? best : null
}

export function processPO(ctx: EngineContext, rules: Rules, input: POInput): POResult {
  const customer = resolveCustomer(ctx, input)
  const header = { ...input.header, customer_id: customer?.customer_id ?? input.header.customer_id }
  const priorTx = (ctx.txnsByCustomer.get(header.customer_id) ?? []).filter((t) => t.transaction_date <= header.po_date)
  // "new" = onboarded without trading history (master flag), or a buyer we cannot find at all
  const isNewCustomer = !customer || customer.is_new_customer || (priorTx.length === 0 && customer.onboarding_date > header.po_date)
  const duplicateOf = findDuplicate(ctx, rules, header, input.lines)
  const hist = customerSkus(ctx, header.customer_id, header.po_date)
  const lines = input.lines.map((l) => processLine(ctx, rules, l, header, { customer, isNewCustomer, duplicate: !!duplicateOf, hist }))

  const auto = lines.filter((l) => l.action === 'auto_process').length
  const autoFlagged = lines.filter((l) => l.action === 'auto_process_with_flag').length
  const rejected = lines.filter((l) => l.soStatus === 'do_not_create').length
  const review = lines.length - auto - autoFlagged
  const orderValue = lines.reduce((s, l) => s + (l.so?.value ?? 0), 0)
  const autoValue = lines.filter((l) => l.autoProcess).reduce((s, l) => s + (l.so?.value ?? 0), 0)
  const straightThrough = lines.length > 0 && lines.every((l) => l.autoProcess)
  const status: POResult['summary']['status'] = duplicateOf ? 'on_hold'
    : straightThrough ? 'auto_approved'
    : auto + autoFlagged > 0 ? 'partially_approved' : 'needs_review'
  return {
    input: { ...input, header }, customer, isNewCustomer, duplicateOf, lines,
    summary: { lines: lines.length, auto, autoFlagged, review, rejected, orderValue, autoValue, straightThrough, status },
  }
}
