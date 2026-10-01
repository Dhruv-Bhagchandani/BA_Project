import clsx from 'clsx'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Empty, Mono } from '../components/ui'
import { download, inr, num } from '../lib/format'
import { buildSalesOrder, soToCsv, type SoLineState } from '../lib/salesOrder'
import { useStore } from '../lib/store'
import { SO_TONE } from './SalesOrders'

const STATE: Record<SoLineState, { label: string; tone: 'good' | 'flag' | 'review' | 'reject' | 'clarify' }> = {
  auto: { label: 'Auto', tone: 'good' }, auto_flagged: { label: 'Auto · flagged', tone: 'flag' }, approved: { label: 'Approved', tone: 'good' },
  pending: { label: 'Pending review', tone: 'review' }, rejected: { label: 'Not created', tone: 'reject' }, clarification: { label: 'Awaiting customer', tone: 'clarify' },
}

export default function SalesOrderDoc() {
  const { id = '' } = useParams()
  const { getPO, reviews, ctx } = useStore()
  const po = getPO(id)
  if (!po || !ctx) return <Empty>Sales order not found.</Empty>
  const so = buildSalesOrder(po, reviews, ctx.productBySku)
  const c = po.customer
  const live = so.lines.filter((l) => ['auto', 'auto_flagged', 'approved'].includes(l.state))
  const other = so.lines.filter((l) => !['auto', 'auto_flagged', 'approved'].includes(l.state))

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/po/${id}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Back to PO {po.input.header.po_number}</Link>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => download(`${so.soNumber}.csv`, soToCsv(so))}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => download(`${so.soNumber}.json`, JSON.stringify(so, null, 2), 'application/json')}><Download className="h-4 w-4" /> JSON (ERP)</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</Button>
        </div>
      </div>

      <article className="print-full mx-auto max-w-5xl rounded-xl border border-slate-200 bg-surface p-8 shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Sales Order</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{so.soNumber}</div>
            <div className="mt-2"><Badge tone={SO_TONE[so.status]}>{so.status}</Badge></div>
          </div>
          <div className="text-right text-sm text-slate-600">
            <div className="font-semibold text-slate-900">Textile Distribution Co. (Demo Entity)</div>
            <div>Unit 14, Textile Trade Centre, Mumbai 400013</div>
            <div className="text-xs text-slate-400">GSTIN 27XXXXX4471X1Z6 (placeholder)</div>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-200 py-6 text-sm sm:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bill to</div>
            <div className="mt-1 font-medium text-slate-900">{so.customerName}</div>
            {c && <div className="text-slate-600">{c.city}, {c.state_code} · GSTIN {c.gstin_masked}<br />Customer {c.customer_id} · tier {c.commercial_tier}</div>}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Against</div>
            <div className="mt-1 text-slate-700">Customer PO <Mono>{so.poNumber}</Mono><br />PO date {po.input.header.po_date} · received via {po.input.header.received_channel || 'upload'}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Terms</div>
            <div className="mt-1 text-slate-700">Ship to {so.shipTo || '—'}<br />Delivery by {so.deliveryDate || '—'} · payment {so.paymentTermsDays || '—'} days</div>
          </div>
        </section>

        <table className="mt-6 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="py-2 pr-2">#</th><th className="py-2 pr-2">SKU / description</th><th className="py-2 pr-2">HSN</th>
              <th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Rate</th><th className="py-2 pr-2 text-right">Amount</th>
              <th className="py-2 pr-2 text-right">GST</th><th className="no-print py-2">Source</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {live.map((l) => (
              <tr key={l.poLineId}>
                <td className="py-2 pr-2 text-slate-400">{l.lineNo}</td>
                <td className="py-2 pr-2"><Mono className="text-brand-700">{l.sku}</Mono><div className="text-slate-800">{l.name}</div>
                  {l.flag && <div className="text-[11px] text-amber-700">⚑ {l.flag}{l.reviewer && ` · ${l.reviewer}`}</div>}</td>
                <td className="py-2 pr-2 font-mono text-xs text-slate-500">{l.hsn}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{num(l.qty, 2)} {l.uom}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{inr(l.unitPrice)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{inr(l.value)}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-500">{l.gstPct}% · {inr(l.gstAmount)}</td>
                <td className="no-print py-2"><Badge tone={STATE[l.state].tone}>{STATE[l.state].label}</Badge></td>
              </tr>
            ))}
            {live.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-500">No lines confirmed yet.</td></tr>}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{inr(so.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd className="tabular-nums">{inr(so.gst)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{inr(so.total)}</dd></div>
          </dl>
        </div>

        {other.length > 0 && (
          <section className="mt-8 rounded-lg border border-dashed border-slate-300 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">PO lines not yet on this order ({other.length})</div>
            <ul className="space-y-1.5 text-sm">
              {other.map((l) => (
                <li key={l.poLineId} className={clsx('flex flex-wrap items-center gap-2')}>
                  <span className="text-slate-400">#{l.lineNo}</span>
                  <span className="font-mono text-xs text-slate-700">{l.customerText}</span>
                  <Badge tone={STATE[l.state].tone}>{STATE[l.state].label}</Badge>
                  <span className="text-xs text-slate-500">{l.flag}</span>
                </li>
              ))}
            </ul>
            <p className="no-print mt-3 text-xs text-slate-500">Resolve these in the <Link to="/review" className="text-brand-600 underline">review queue</Link> or on the <Link to={`/po/${id}`} className="text-brand-600 underline">PO page</Link>.</p>
          </section>
        )}
        <footer className="mt-8 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
          Generated by OrderPilot from customer PO {so.poNumber}. Prices: quoted rate where within tolerance, otherwise the validated reference price. Synthetic demo data.
        </footer>
      </article>
    </div>
  )
}
