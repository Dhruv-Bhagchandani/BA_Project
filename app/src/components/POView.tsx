import { AlertTriangle, ArrowRight, Copy, Download, Eye, EyeOff, FileText, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { POResult } from '../lib/engine'
import { download, human, inr, num } from '../lib/format'
import { soNumberFor } from '../lib/salesOrder'
import { useStore } from '../lib/store'
import LineResultCard, { LineTableHeader } from './LineResultCard'
import { Badge, Button, Card, Mono } from './ui'

/** Object URLs for files uploaded in this session (files are not persisted, only their extraction). */
export const sessionFiles = new Map<string, { url: string; type: string; name: string }>()

export function DocPreview({ url, type, name }: { url: string; type: string; name: string }) {
  return (
    <Card title={<span className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> Source document</span>} subtitle={name}
      action={<a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">Open</a>}>
      <div className="h-[560px] overflow-auto bg-slate-100">
        {type.includes('pdf') ? (
          <iframe src={url} title={name} className="h-full w-full" />
        ) : (
          <img src={url} alt={name} className="mx-auto max-w-full" />
        )}
      </div>
    </Card>
  )
}

export const STATUS_META: Record<POResult['summary']['status'], { label: string; tone: 'good' | 'flag' | 'review' | 'hold' }> = {
  auto_approved: { label: 'Straight-through: SO created', tone: 'good' },
  partially_approved: { label: 'Partially auto-approved', tone: 'flag' },
  needs_review: { label: 'Needs review', tone: 'review' },
  on_hold: { label: 'On hold — duplicate check', tone: 'hold' },
}

export default function POView({ po, showTruthDefault = false, docUrl }: { po: POResult; showTruthDefault?: boolean; docUrl?: { url: string; type: string; name: string } | null }) {
  const { data } = useStore()
  const [truth, setTruth] = useState(showTruthDefault)
  const h = po.input.header
  const gtOf = (id: string, ref?: string) => data?.gt.get(ref ?? id)
  const hasTruth = po.lines.some((l) => gtOf(l.input.po_line_id, l.input.ref_line_id))
  const meta = STATUS_META[po.summary.status]
  const poEval = data?.poEval.get(h.po_id) ?? data?.poEval.get(data.headers.find((x) => x.po_number === h.po_number)?.po_id ?? '')

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900"><Mono className="text-base">{h.po_number || '(no PO number)'}</Mono></h1>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {po.input.source === 'upload' && <Badge tone="info">uploaded</Badge>}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              {po.customer ? <Link to={`/customers/${po.customer.customer_id}`} className="font-medium text-brand-700 hover:underline">{po.customer.customer_name}</Link>
                : <span className="font-medium text-orange-700">{po.input.customer_name_text || 'Unknown buyer'} (not in customer master)</span>}
              {po.customer && <span className="text-slate-400"> · {po.customer.customer_segment} · tier {po.customer.commercial_tier} · {po.customer.city}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Ref <Mono>{h.po_id}</Mono></span>
              <span>PO date {h.po_date || '—'}</span>
              <span>Delivery {h.requested_delivery_date || '—'}</span>
              {h.received_channel && <span>Via {h.received_channel}</span>}
              {h.ship_to_city && <span>Ship to {h.ship_to_city}</span>}
              {h.payment_terms_days && <span>Terms {h.payment_terms_days} days</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasTruth && (
              <Button variant="secondary" onClick={() => setTruth(!truth)}>
                {truth ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {truth ? 'Hide' : 'Compare with'} ground truth
              </Button>
            )}
            <Button variant="secondary" onClick={() => download(`${h.po_id}_agent_result.json`, JSON.stringify(po.lines.map((l) => ({
              po_line_id: l.input.po_line_id, matched_sku: l.match.sku, match_status: l.match.status, confidence: l.match.confidence,
              candidates: l.match.candidates.map((c) => c.sku), price_status: l.price.status, reference_price: l.price.reference,
              exception: l.exception, action: l.action, auto_process: l.autoProcess, so_line: l.so, trace: l.trace.map((t) => t.text),
            })), null, 2), 'application/json')}><Download className="h-4 w-4" /> JSON</Button>
            <Link to={`/sales-orders/${h.po_id}`}><Button>Sales order {soNumberFor(h.po_id)} <ArrowRight className="h-4 w-4" /></Button></Link>
          </div>
        </div>

        {(po.duplicateOf || po.isNewCustomer) && (
          <div className="space-y-2 border-t border-slate-100 px-5 py-3">
            {po.duplicateOf && (
              <div className="flex items-start gap-2 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
                <Copy className="mt-0.5 h-4 w-4 shrink-0" />
                <div>Possible duplicate of <Link className="font-medium underline" to={`/po/${po.duplicateOf.po_id}`}>{po.duplicateOf.po_number}</Link> received {po.duplicateOf.po_date}: same customer, same lines, within the duplicate window. Every line is held until someone confirms this is a genuine repeat order.</div>
              </div>
            )}
            {po.isNewCustomer && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{po.customer ? 'First order from a newly onboarded customer' : 'Buyer not found in the customer master'}: no negotiated price and no payment history. Safety rule: never straight-through, however clean the lines look.</div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl border-t border-slate-100 bg-slate-100 sm:grid-cols-5">
          {[
            ['Lines', num(po.summary.lines)],
            ['Auto-approved', num(po.summary.auto)],
            ['Auto + flagged', num(po.summary.autoFlagged)],
            ['Held for review', num(po.summary.review - po.summary.rejected)],
            ['Auto SO value', inr(po.summary.autoValue, true)],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-5 py-3">
              <div className="text-[11px] text-slate-500">{k}</div>
              <div className="text-base font-semibold tabular-nums text-slate-900">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {truth && poEval && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/50 px-4 py-2 text-xs text-violet-900">
          <AlertTriangle className="h-3.5 w-3.5" /> Evaluation metadata — PO difficulty <b>{poEval.po_difficulty_level}</b>, scenarios:
          {poEval.po_scenario_mix.split('|').map((s) => <Badge key={s} tone="hold">{human(s)}</Badge>)}
        </div>
      )}

      <div className={docUrl ? 'grid gap-5 2xl:grid-cols-[minmax(0,1fr)_460px]' : ''}>
        <Card title="Line-by-line decisions" subtitle="Click a line to see what the agent read, what it matched, the price check and its reasoning.">
          <LineTableHeader />
          {po.lines.map((l, i) => (
            <LineResultCard key={l.input.po_line_id} l={l} gt={gtOf(l.input.po_line_id, l.input.ref_line_id)} showTruth={truth}
              customerId={h.customer_id} defaultOpen={po.lines.length <= 2 && i === 0} />
          ))}
        </Card>
        {docUrl && <div className="2xl:sticky 2xl:top-4 2xl:self-start"><DocPreview {...docUrl} /></div>}
      </div>
    </div>
  )
}
