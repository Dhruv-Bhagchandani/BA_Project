import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Mono, PageHeader, Select, Stat } from '../components/ui'
import { compactInr, download, inr, num } from '../lib/format'
import { buildSalesOrder, type SalesOrder } from '../lib/salesOrder'
import { useStore } from '../lib/store'

export const SO_TONE: Record<SalesOrder['status'], 'good' | 'flag' | 'review' | 'hold' | 'reject'> = {
  Confirmed: 'good', 'Partially confirmed': 'flag', 'Awaiting review': 'review', 'On hold': 'hold', Cancelled: 'reject',
}

const PAGE = 50

export default function SalesOrders() {
  const { inbox, uploadResults, reviews, ctx } = useStore()
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const sos = useMemo(() => {
    if (!ctx) return []
    return [...uploadResults.values(), ...[...inbox].reverse()].map((po) => buildSalesOrder(po, reviews, ctx.productBySku))
  }, [inbox, uploadResults, reviews, ctx])

  const filtered = sos.filter((s) => (status === 'all' || s.status === status) &&
    (!q || `${s.soNumber} ${s.poNumber} ${s.customerName}`.toLowerCase().includes(q.toLowerCase())))
  const total = sos.reduce((t, s) => t + s.subtotal, 0)

  const exportAll = () => {
    const head = 'so_number,po_number,customer,so_date,status,live_lines,pending_lines,subtotal_inr,gst_inr,total_inr'
    const rows = filtered.map((s) => [s.soNumber, s.poNumber, s.customerName, s.soDate, s.status,
      s.lines.filter((l) => ['auto', 'auto_flagged', 'approved'].includes(l.state)).length, s.pendingCount, s.subtotal, s.gst, s.total]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    download('sales_orders.csv', [head, ...rows].join('\n'))
  }

  return (
    <div>
      <PageHeader title="Sales orders" subtitle="One sales order per PO. Auto-approved lines land immediately; held lines join once a reviewer approves them."
        actions={<Button variant="secondary" onClick={exportAll}><Download className="h-4 w-4" /> Export CSV</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Confirmed (all lines resolved)" value={num(sos.filter((s) => s.status === 'Confirmed').length)} />
        <Stat label="Partially confirmed" value={num(sos.filter((s) => s.status === 'Partially confirmed').length)} />
        <Stat label="Awaiting review / on hold" value={num(sos.filter((s) => s.status === 'Awaiting review' || s.status === 'On hold').length)} />
        <Stat label="Booked SO value (ex-GST)" value={compactInr(total)} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search SO, PO or customer…" className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0) }}
            options={[{ value: 'all', label: 'All' }, ...Object.keys(SO_TONE).map((k) => ({ value: k, label: k }))]} />
          <span className="ml-auto text-xs text-slate-500">{num(filtered.length)} sales orders</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2 font-medium">SO</th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">PO</th>
                <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 text-right font-medium">Lines live / pending</th>
                <th className="px-3 py-2 text-right font-medium">Total incl. GST</th><th className="px-5 py-2 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice(page * PAGE, page * PAGE + PAGE).map((s) => (
                <tr key={s.soNumber} className="hover:bg-slate-50">
                  <td className="px-5 py-2"><Link to={`/sales-orders/${s.poId}`} className="hover:underline"><Mono className="text-brand-700">{s.soNumber}</Mono></Link></td>
                  <td className="max-w-56 truncate px-3 py-2">{s.customerName}</td>
                  <td className="px-3 py-2"><Mono className="text-slate-500">{s.poNumber}</Mono></td>
                  <td className="px-3 py-2 text-slate-600">{s.soDate}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.lines.filter((l) => ['auto', 'auto_flagged', 'approved'].includes(l.state)).length} / {s.pendingCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(s.total, true)}</td>
                  <td className="px-5 py-2"><Badge tone={SO_TONE[s.status]}>{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            <span>Page {page + 1} of {Math.ceil(filtered.length / PAGE)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
