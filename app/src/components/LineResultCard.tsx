import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, CircleCheck, CircleX, GraduationCap, HelpCircle, Undo2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { LineResult } from '../lib/engine'
import { EXCEPTION_LABEL, human, inr, num } from '../lib/format'
import { useStore } from '../lib/store'
import type { GroundTruth } from '../lib/types'
import { ActionBadge, Badge, Button, Confidence, Mono } from './ui'

const STAGE_LABEL = { extract: 'Extract', match: 'Match', price: 'Price', quantity: 'Qty/UOM', policy: 'Policy', decision: 'Decision' }

function PriceHistory({ l }: { l: LineResult }) {
  const data = l.price.history.slice(-12).map((h) => ({ date: h.date, price: h.price }))
  if (data.length < 2) return null
  return (
    <div className="mt-2 h-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis domain={['auto', 'auto']} width={44} tick={{ fontSize: 10, fill: '#52514e' }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => inr(Number(v))} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          {l.parsed.price !== null && <ReferenceLine y={l.parsed.price} stroke="#eb6834" strokeDasharray="4 3" label={{ value: 'quoted', fontSize: 10, fill: '#52514e', position: 'insideTopRight' }} />}
          <Line type="monotone" dataKey="price" stroke="#2a78d6" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-[11px] text-slate-500">This customer's transacted price for the SKU (blue) vs quoted (orange)</div>
    </div>
  )
}

function Field({ label, value, raw }: { label: string; value: React.ReactNode; raw?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-100 py-1 text-xs last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-800">
        {value}
        {raw !== undefined && raw !== '' && <span className="ml-1.5 font-mono text-[10px] text-slate-400">"{raw}"</span>}
      </span>
    </div>
  )
}

function TruthPanel({ l, gt }: { l: LineResult; gt: GroundTruth }) {
  const ok = (a: boolean) => (a ? <Check className="inline h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="inline h-3.5 w-3.5 text-red-600" />)
  const truthAuto = gt.should_auto_process === 'TRUE'
  const candidateOk = gt.ambiguous_candidate_skus ? gt.ambiguous_candidate_skus.split('|').some((s) => l.match.candidates.some((c) => c.sku === s)) : null
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-violet-900"><GraduationCap className="h-3.5 w-3.5" /> Ground truth (hidden from the agent)</div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>Scenario: <b>{human(gt.scenario_type)}</b> · <span className="capitalize">{gt.difficulty_level}</span></div>
        <div>{ok(l.action === gt.expected_action)} Expected action: <b>{human(gt.expected_action)}</b></div>
        <div>{ok(l.exception === gt.expected_exception_type)} Expected exception: <b>{human(gt.expected_exception_type)}</b></div>
        <div>{ok(l.autoProcess === truthAuto)} Should auto-process: <b>{truthAuto ? 'yes' : 'no'}</b>
          {l.autoProcess && !truthAuto && <Badge tone="reject" className="ml-1">false auto-approval</Badge>}</div>
        <div>True SKU: <Mono>{gt.true_sku || '— (not in catalogue)'}</Mono>
          {['exact_match', 'high_confidence_match'].includes(gt.expected_match_status) && <> {ok(l.match.sku === gt.true_sku)}</>}</div>
        {candidateOk !== null && <div>{ok(candidateOk)} Candidate set covers truth ({gt.n_candidate_skus} valid)</div>}
        <div>{ok(l.price.status === gt.expected_price_status || gt.reference_price_source === 'not_applicable')} Expected price status: <b>{human(gt.expected_price_status)}</b></div>
      </div>
      <p className="mt-2 italic text-violet-900/80">{gt.match_evidence_notes}</p>
    </div>
  )
}

function ReviewPanel({ l, customerId }: { l: LineResult; customerId: string }) {
  const { reviews, decide, undoDecision, ctx } = useStore()
  const decision = reviews[l.input.po_line_id]
  const [sku, setSku] = useState(l.match.sku ?? l.match.candidates[0]?.sku ?? '')
  const [skuSearch, setSkuSearch] = useState('')
  const [qty, setQty] = useState(String(l.so?.qty ?? l.parsed.qty ?? ''))
  const [price, setPrice] = useState(String(l.so?.unitPrice ?? l.price.reference ?? l.parsed.price ?? ''))
  const [note, setNote] = useState('')
  const code = l.input.customer_item_code || l.parsed.desc.customerCodes[0] || ''

  const searchHits = useMemo(() => {
    if (!ctx || skuSearch.trim().length < 2) return []
    const q = skuSearch.toLowerCase().split(/\s+/)
    return ctx.products.filter((p) => q.every((w) => `${p.sku} ${p.product_name}`.toLowerCase().includes(w))).slice(0, 8)
  }, [ctx, skuSearch])

  if (decision)
    return (
      <div className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs',
        decision.status === 'approved' ? 'border-emerald-200 bg-emerald-50' : decision.status === 'rejected' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50')}>
        <div>
          <b className="capitalize">{decision.status === 'clarification' ? 'Clarification requested' : decision.status}</b> by {decision.reviewer} · {new Date(decision.at).toLocaleString()}
          {decision.sku && <> · SKU <Mono>{decision.sku}</Mono></>}{decision.qty !== undefined && <> · qty {num(decision.qty, 2)}</>}{decision.unitPrice !== undefined && <> · {inr(decision.unitPrice)}</>}
          {decision.note && <div className="mt-1 text-slate-600">“{decision.note}”</div>}
        </div>
        <Button variant="ghost" onClick={() => undoDecision(l.input.po_line_id)}><Undo2 className="h-3.5 w-3.5" /> Undo</Button>
      </div>
    )
  if (l.autoProcess) return null

  const pool = [...new Map([...l.match.candidates.map((c) => [c.sku, c.name] as const), ...searchHits.map((p) => [p.sku, p.product_name] as const)]).entries()]
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 text-xs font-semibold text-amber-900">Reviewer decision</div>
      <div className="grid gap-2 md:grid-cols-[1fr_120px_140px]">
        <div className="space-y-1.5">
          <select value={sku} onChange={(e) => setSku(e.target.value)} className="w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-xs">
            <option value="">— choose SKU —</option>
            {pool.map(([s, n]) => <option key={s} value={s}>{s} · {n}</option>)}
          </select>
          <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search catalogue for another SKU…" className="w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-xs" />
        </div>
        <label className="text-[11px] text-slate-500">Qty ({ctx?.productBySku.get(sku)?.uom ?? l.parsed.uomRaw})
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="mt-0.5 w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-xs text-slate-800" />
        </label>
        <label className="text-[11px] text-slate-500">Unit price ₹
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="mt-0.5 w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-xs text-slate-800" />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. confirmed colour with buyer on call" className="mt-2 w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-xs" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="success" disabled={!sku || !(Number(qty) > 0) || !(Number(price) > 0)}
          onClick={() => decide(l.input.po_line_id, { status: 'approved', sku, qty: Number(qty), unitPrice: Number(price), note }, code ? { customerId, code } : undefined)}>
          <CircleCheck className="h-4 w-4" /> Approve into SO
        </Button>
        <Button variant="secondary" onClick={() => decide(l.input.po_line_id, { status: 'clarification', note })}><HelpCircle className="h-4 w-4" /> Ask customer</Button>
        <Button variant="danger" onClick={() => decide(l.input.po_line_id, { status: 'rejected', note })}><CircleX className="h-4 w-4" /> Reject line</Button>
        {code && <span className="text-[11px] text-slate-500">Approving teaches the agent that <Mono>{code}</Mono> = selected SKU for this customer.</span>}
      </div>
    </div>
  )
}

export default function LineResultCard({ l, gt, showTruth, customerId, defaultOpen }: {
  l: LineResult; gt?: GroundTruth; showTruth?: boolean; customerId: string; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const { reviews } = useStore()
  const decision = reviews[l.input.po_line_id]
  const p = l.match.product
  const falseAuto = gt && showTruth && l.autoProcess && gt.should_auto_process !== 'TRUE'

  return (
    <div className={clsx('border-b border-slate-100 last:border-0', falseAuto && 'bg-red-50/40')}>
      <button onClick={() => setOpen(!open)} className="grid w-full grid-cols-[24px_1fr] items-start gap-2 px-4 py-3 text-left hover:bg-slate-50 lg:grid-cols-[24px_minmax(0,1.3fr)_minmax(0,1.2fr)_110px_130px_90px_190px]">
        <span className="pt-0.5 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">Line {l.input.line_no}{l.input.customer_item_code && <> · code <Mono>{l.input.customer_item_code}</Mono></>}</div>
          <div className="truncate font-mono text-xs text-slate-800" title={l.input.customer_item_description}>{l.input.customer_item_description || '(blank)'}</div>
        </div>
        <div className="min-w-0 max-lg:col-start-2">
          {p ? (
            <>
              <div className="font-mono text-[11px] text-brand-700">{p.sku}</div>
              <div className="truncate text-xs text-slate-700" title={p.product_name}>{p.product_name}</div>
            </>
          ) : l.match.candidates.length ? (
            <div className="text-xs text-amber-800">{l.match.candidates.length} candidate SKU{l.match.candidates.length > 1 ? 's' : ''} — not committed</div>
          ) : (
            <div className="text-xs text-slate-500">{l.match.status === 'no_match' ? 'Not in catalogue' : 'No match proposed'}</div>
          )}
        </div>
        <div className="text-xs tabular-nums text-slate-700 max-lg:col-start-2">
          {l.parsed.qty !== null ? num(l.parsed.qty) : <span className="text-orange-700">{l.input.quantity_text || 'blank'}</span>} <span className="text-slate-400">{l.input.uom_text}</span>
        </div>
        <div className="text-xs tabular-nums max-lg:col-start-2">
          <div className="text-slate-700">{l.parsed.price !== null ? inr(l.parsed.price) : <span className="text-slate-400">no price</span>}</div>
          {l.price.deltaPct !== null && (
            <div className={clsx('text-[11px]', Math.abs(l.price.deltaPct) > 5 ? 'text-red-700' : Math.abs(l.price.deltaPct) > 2 ? 'text-amber-700' : 'text-slate-500')}>
              {l.price.deltaPct > 0 ? '+' : ''}{l.price.deltaPct.toFixed(1)}% vs ref
            </div>
          )}
        </div>
        <div className="max-lg:col-start-2"><Confidence value={l.match.confidence} /></div>
        <div className="flex flex-wrap items-center gap-1 max-lg:col-start-2">
          <ActionBadge action={l.action} short />
          {decision && <Badge tone={decision.status === 'approved' ? 'good' : decision.status === 'rejected' ? 'reject' : 'clarify'}>{decision.status === 'clarification' ? 'asked' : decision.status}</Badge>}
          {falseAuto && <Badge tone="reject">false auto</Badge>}
        </div>
      </button>

      {open && (
        <div className="space-y-3 bg-slate-50/60 px-4 pb-4 pt-1 lg:pl-12">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-surface p-3">
              <div className="mb-1 text-xs font-semibold text-slate-700">1 · What the agent read</div>
              <Field label="Quantity" value={l.parsed.qty !== null ? `${num(l.parsed.qty, 2)}${l.parsed.qtyApprox ? ' (approx.)' : ''}` : 'missing'} raw={l.input.quantity_text} />
              <Field label="UOM" value={l.parsed.uom ?? '—'} raw={l.input.uom_text} />
              <Field label="Unit price" value={inr(l.parsed.price)} raw={l.input.unit_price_text} />
              <Field label="GSM" value={l.parsed.gsm ?? '—'} raw={l.input.gsm_text} />
              <Field label="Width" value={l.parsed.width ? `${l.parsed.width}"` : '—'} raw={l.input.width_text} />
              <Field label="Colour" value={l.parsed.colour ?? '—'} raw={l.input.colour_text} />
              {l.input.line_remarks && <Field label="Remarks" value={<span className="italic">{l.input.line_remarks}</span>} />}
              {l.input.requested_delivery_date && <Field label="Delivery" value={l.input.requested_delivery_date} />}
              {l.parsed.desc.corrected.length > 0 && <Field label="Spelling fixes" value={l.parsed.desc.corrected.map((c) => `${c.from}→${c.to}`).join(', ')} />}
            </div>
            <div className="rounded-lg border border-slate-200 bg-surface p-3">
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>2 · Catalogue match</span><Badge tone="info">{human(l.match.status)}</Badge>
              </div>
              <div className="mb-1 text-[11px] text-slate-500">Method: {l.match.method || '—'}</div>
              {p && (
                <div className="mb-2 rounded-md bg-brand-50 p-2 text-xs">
                  <div className="font-mono text-brand-700">{p.sku}{!p.is_active && <Badge tone="reject" className="ml-2">discontinued</Badge>}</div>
                  <div className="text-slate-800">{p.product_name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{p.product_family} · {p.finish} · sells in {p.uom} · list {inr(p.list_price_inr)} · MOQ {p.moq_units} · lead {p.lead_time_days} d</div>
                </div>
              )}
              {l.match.candidates.length > (p ? 1 : 0) && (
                <>
                  <div className="text-[11px] font-medium text-slate-500">{p ? 'Alternatives considered' : `Candidates for the reviewer (${l.match.candidates.length})`}</div>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-[11px]">
                    {l.match.candidates.filter((c) => c.sku !== p?.sku).slice(0, 12).map((c) => (
                      <li key={c.sku} className="flex gap-1.5">
                        <Mono className="shrink-0 text-brand-700">{c.sku}</Mono>
                        <span className="truncate text-slate-600" title={c.name}>{c.name}</span>
                        {c.inHistory && <Badge tone="good" className="!px-1 !py-0 text-[10px]">bought before</Badge>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-surface p-3">
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>3 · Price check</span><Badge tone={l.price.status.startsWith('outside') ? 'reject' : l.price.status === 'within_tolerance' ? 'good' : 'neutral'}>{human(l.price.status)}</Badge>
              </div>
              <Field label="Quoted" value={inr(l.parsed.price)} />
              <Field label="Reference" value={inr(l.price.reference)} />
              <Field label="Source" value={human(l.price.source)} />
              {l.price.lastDate && <Field label="Last transacted" value={`${l.price.lastDate} (${l.price.ageDays} d before PO)`} />}
              <Field label="Deviation" value={l.price.deltaPct === null ? '—' : `${l.price.deltaPct > 0 ? '+' : ''}${l.price.deltaPct.toFixed(2)}%`} />
              {l.so && <Field label="Proposed SO line" value={`${num(l.so.qty, 2)} ${l.so.uom} × ${inr(l.so.unitPrice)} = ${inr(l.so.value)}`} />}
              <PriceHistory l={l} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-700">
              <span>4 · Agent reasoning</span>
              <span className="flex items-center gap-2 font-normal">
                Exception: <Badge tone={l.exception === 'none' ? 'good' : 'neutral'}>{EXCEPTION_LABEL[l.exception]}</Badge>
                <ActionBadge action={l.action} />
              </span>
            </div>
            <ol className="space-y-1">
              {l.trace.map((t, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', t.ok === true ? 'bg-emerald-500' : t.ok === false ? 'bg-amber-500' : 'bg-slate-300')} />
                  <span className="w-16 shrink-0 text-slate-400">{STAGE_LABEL[t.stage]}</span>
                  <span className="text-slate-700">{t.text}</span>
                </li>
              ))}
            </ol>
          </div>

          {gt && showTruth && <TruthPanel l={l} gt={gt} />}
          <ReviewPanel l={l} customerId={customerId} />
        </div>
      )}
    </div>
  )
}

export function LineTableHeader() {
  return (
    <div className="hidden grid-cols-[24px_minmax(0,1.3fr)_minmax(0,1.2fr)_110px_130px_90px_190px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 lg:grid">
      <span />
      <span>Customer wrote</span>
      <span>Matched product</span>
      <span>Qty</span>
      <span>Price</span>
      <span>Confidence</span>
      <span>Decision</span>
    </div>
  )
}
