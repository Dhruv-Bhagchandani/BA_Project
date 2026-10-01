import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { STATUS_META } from '../components/POView'
import { Badge, Button, Card, Empty, Mono, PageHeader, Select } from '../components/ui'
import { inr, num } from '../lib/format'
import { useStore } from '../lib/store'

const PAGE = 50

export default function Inbox() {
  const { inbox, data } = useStore()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [channel, setChannel] = useState('all')
  const [split, setSplit] = useState('all')
  const [page, setPage] = useState(0)

  const channels = useMemo(() => [...new Set(inbox.map((p) => p.input.header.received_channel))].sort(), [inbox])
  const rows = useMemo(() => {
    const ql = q.toLowerCase()
    return inbox
      .filter((p) => status === 'all' || p.summary.status === status)
      .filter((p) => channel === 'all' || p.input.header.received_channel === channel)
      .filter((p) => split === 'all' || data?.splits.get(p.input.header.po_id)?.split === split)
      .filter((p) => !ql || `${p.input.header.po_id} ${p.input.header.po_number} ${p.customer?.customer_name}`.toLowerCase().includes(ql))
      .sort((a, b) => b.input.header.po_date.localeCompare(a.input.header.po_date) || b.input.header.po_id.localeCompare(a.input.header.po_id))
  }, [inbox, q, status, channel, split, data])
  const pages = Math.ceil(rows.length / PAGE)
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)

  return (
    <div>
      <PageHeader title="PO inbox" subtitle="Every purchase order received, with the agent's verdict. Click through for the line-by-line reasoning." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search PO or customer…"
            className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0) }}
            options={[{ value: 'all', label: 'All' }, ...Object.entries(STATUS_META).map(([k, v]) => ({ value: k, label: v.label }))]} />
          <Select label="Channel" value={channel} onChange={(v) => { setChannel(v); setPage(0) }}
            options={[{ value: 'all', label: 'All' }, ...channels.map((c) => ({ value: c, label: c }))]} />
          <Select label="Split" value={split} onChange={(v) => { setSplit(v); setPage(0) }}
            options={['all', 'train', 'validation', 'test'].map((s) => ({ value: s, label: s }))} />
          <span className="ml-auto text-xs text-slate-500">{num(rows.length)} POs</span>
        </div>
        {shown.length === 0 ? <Empty>No POs match these filters.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">PO</th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Channel</th><th className="px-3 py-2 text-right font-medium">Lines auto</th>
                  <th className="px-3 py-2 text-right font-medium">Auto SO value</th><th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => {
                  const h = p.input.header
                  const m = STATUS_META[p.summary.status]
                  return (
                    <tr key={h.po_id} className="hover:bg-slate-50">
                      <td className="px-5 py-2"><Link to={`/po/${h.po_id}`} className="hover:underline"><Mono className="text-brand-700">{h.po_number}</Mono></Link><div className="text-[11px] text-slate-400">{h.po_id}</div></td>
                      <td className="max-w-56 truncate px-3 py-2 text-slate-700">{p.customer?.customer_name}{p.isNewCustomer && <Badge tone="review" className="ml-1.5">new</Badge>}</td>
                      <td className="px-3 py-2 text-slate-600">{h.po_date}</td>
                      <td className="px-3 py-2 text-slate-600">{h.received_channel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.summary.auto + p.summary.autoFlagged}/{p.summary.lines}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(p.summary.autoValue, true)}</td>
                      <td className="px-5 py-2"><Badge tone={m.tone}>{m.label}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
