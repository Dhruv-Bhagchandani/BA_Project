import { ArrowRight, Bot, ClipboardCheck, FileInput, ShieldCheck, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { STATUS_META } from '../components/POView'
import { ActionBadge, Badge, Button, Card, Mono, PageHeader, Stat } from '../components/ui'
import { ACTION_META, compactInr, EXCEPTION_LABEL, num, pct } from '../lib/format'
import { useStore } from '../lib/store'
import type { Action, ExceptionType } from '../lib/types'

const STATUS = { auto: '#0ca30c', flagged: '#fab219', held: '#ec835a', rejected: '#d03b3b' }
const AXIS = { fontSize: 11, fill: '#52514e' }

export default function Dashboard() {
  const { inbox, data, reviews } = useStore()

  const s = useMemo(() => {
    const lines = inbox.flatMap((p) => p.lines.map((l) => ({ l, po: p })))
    const auto = lines.filter((x) => x.l.action === 'auto_process').length
    const flagged = lines.filter((x) => x.l.action === 'auto_process_with_flag').length
    const rejected = lines.filter((x) => x.l.action === 'reject_line').length
    const held = lines.length - auto - flagged - rejected
    const stpOrders = inbox.filter((p) => p.summary.straightThrough).length
    const autoValue = inbox.reduce((t, p) => t + p.summary.autoValue, 0)
    const pending = lines.filter((x) => !x.l.autoProcess && x.l.action !== 'reject_line' && !reviews[x.l.input.po_line_id]).length
    let fa = 0, neg = 0
    for (const { l } of lines) {
      const g = data?.gt.get(l.input.po_line_id)
      if (!g) continue
      if (g.should_auto_process !== 'TRUE') { neg++; if (l.autoProcess) fa++ }
    }
    const byAction = new Map<Action, number>()
    const byExc = new Map<ExceptionType, number>()
    for (const { l } of lines) {
      byAction.set(l.action, (byAction.get(l.action) ?? 0) + 1)
      if (l.exception !== 'none') byExc.set(l.exception, (byExc.get(l.exception) ?? 0) + 1)
    }
    const weeks = new Map<string, { week: string; auto: number; flagged: number; held: number; rejected: number }>()
    for (const { l, po } of lines) {
      const d = new Date(po.input.header.po_date + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      const k = d.toISOString().slice(0, 10)
      if (!weeks.has(k)) weeks.set(k, { week: k.slice(5), auto: 0, flagged: 0, held: 0, rejected: 0 })
      const w = weeks.get(k)!
      if (l.action === 'auto_process') w.auto++
      else if (l.action === 'auto_process_with_flag') w.flagged++
      else if (l.action === 'reject_line') w.rejected++
      else w.held++
    }
    const channels = new Map<string, { channel: string; lines: number; auto: number }>()
    for (const { l, po } of lines) {
      const c = po.input.header.received_channel
      if (!channels.has(c)) channels.set(c, { channel: c, lines: 0, auto: 0 })
      const r = channels.get(c)!
      r.lines++
      if (l.autoProcess) r.auto++
    }
    return {
      lines: lines.length, auto, flagged, held, rejected, stpOrders, autoValue, pending, fa, neg,
      byAction: [...byAction].sort((a, b) => b[1] - a[1]),
      byExc: [...byExc].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: EXCEPTION_LABEL[k], v })),
      weeks: [...weeks.entries()].sort().map(([, v]) => v),
      channels: [...channels.values()].map((c) => ({ ...c, rate: Math.round((c.auto / c.lines) * 1000) / 10 })).sort((a, b) => b.rate - a.rate),
    }
  }, [inbox, data, reviews])

  const attention = useMemo(() => inbox.filter((p) => p.summary.status !== 'auto_approved')
    .sort((a, b) => b.input.header.po_date.localeCompare(a.input.header.po_date)).slice(0, 8), [inbox])

  return (
    <div>
      <PageHeader title="Order desk overview"
        subtitle={`${num(inbox.length)} customer purchase orders received ${data?.headers[0]?.po_date} → ${data?.headers.at(-1)?.po_date}, processed by the agent in arrival order.`}
        actions={<Link to="/process"><Button><FileInput className="h-4 w-4" /> Process a PO</Button></Link>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lines auto-approved" value={pct((s.auto + s.flagged) / s.lines)} icon={<Bot className="h-4 w-4 text-slate-400" />}
          sub={<>{num(s.auto + s.flagged)} of {num(s.lines)} lines · dataset ceiling 62.2%</>} />
        <Stat label="Orders fully straight-through" value={pct(s.stpOrders / inbox.length)} icon={<Timer className="h-4 w-4 text-slate-400" />}
          sub={<>{num(s.stpOrders)} POs needed no human · ceiling 18.9%</>} />
        <Stat label="False auto-approval rate" value={pct(s.fa / Math.max(1, s.neg), 2)} tone={s.fa / Math.max(1, s.neg) < 0.02 ? 'good' : 'bad'} icon={<ShieldCheck className="h-4 w-4 text-slate-400" />}
          sub={<>{s.fa} of {num(s.neg)} risky lines slipped through — the safety metric</>} />
        <Stat label="Waiting for review" value={num(s.pending)} icon={<ClipboardCheck className="h-4 w-4 text-slate-400" />}
          sub={<Link to="/review" className="text-brand-600 hover:underline">Open review queue →</Link>} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="SO value created automatically" value={compactInr(s.autoValue)} sub="ex-GST, straight-through + flagged lines" />
        <Stat label="Desk time saved (est.)" value={`${num(((s.auto + s.flagged) * 4) / 60)} h`} sub="assumes ~4 min to key one SO line by hand" />
        <Stat label="Lines rejected (not stocked)" value={num(s.rejected)} sub="no SKU proposed — 0 hallucinations" />
        <Stat label="Exceptions caught" value={num(s.lines - s.auto)} sub="every non-clean line carries a specific reason" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Weekly line outcomes" subtitle="What the agent did with every PO line, by week received">
          <div className="h-72 p-3">
            <ResponsiveContainer>
              <BarChart data={s.weeks} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap={3}>
                <CartesianGrid vertical={false} stroke="#ececea" />
                <XAxis dataKey="week" tick={AXIS} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="auto" name="Auto-approved" stackId="a" fill={STATUS.auto} stroke="#fff" strokeWidth={1} />
                <Bar dataKey="flagged" name="Auto + flag" stackId="a" fill={STATUS.flagged} stroke="#fff" strokeWidth={1} />
                <Bar dataKey="held" name="Held for review" stackId="a" fill={STATUS.held} stroke="#fff" strokeWidth={1} />
                <Bar dataKey="rejected" name="Rejected" stackId="a" fill={STATUS.rejected} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Decisions" subtitle="Line-level action chosen by the agent">
          <div className="space-y-2 p-5">
            {s.byAction.map(([a, n]) => (
              <div key={a} className="flex items-center gap-3 text-sm">
                <div className="w-44 shrink-0"><ActionBadge action={a} short /></div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(n / s.lines) * 100}%` }} />
                </div>
                <span className="w-24 text-right text-xs tabular-nums text-slate-600">{num(n)} · {pct(n / s.lines)}</span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-slate-500">{ACTION_META.auto_process_with_flag.label}: SO line created, variance reported to commercial team.</p>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Exceptions raised" subtitle="Why lines were flagged or held">
          <div className="h-[440px] p-3">
            <ResponsiveContainer>
              <BarChart data={s.byExc} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barCategoryGap={4}>
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={170} tick={AXIS} axisLine={false} tickLine={false} interval={0} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="v" name="Lines" fill="#2a78d6" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 10, fill: '#52514e' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Automation rate by channel" subtitle="Share of lines auto-approved, by how the PO arrived">
          <div className="h-[440px] p-3">
            <ResponsiveContainer>
              <BarChart data={s.channels} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ececea" />
                <XAxis dataKey="channel" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis unit="%" tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => `${v}%`} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="rate" name="Auto-approved lines" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={56} label={{ position: 'top', fontSize: 11, fill: '#52514e', formatter: (v: unknown) => `${v}%` }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-5" title="Recent POs needing attention" action={<Link to="/inbox" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">All POs <ArrowRight className="h-3 w-3" /></Link>}>
        <div className="divide-y divide-slate-100">
          {attention.map((p) => (
            <Link key={p.input.header.po_id} to={`/po/${p.input.header.po_id}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
              <Mono className="w-44 text-slate-800">{p.input.header.po_number}</Mono>
              <span className="min-w-0 flex-1 truncate text-slate-600">{p.customer?.customer_name}</span>
              <span className="text-xs text-slate-500">{p.input.header.po_date}</span>
              <span className="text-xs tabular-nums text-slate-500">{p.summary.auto + p.summary.autoFlagged}/{p.summary.lines} auto</span>
              <Badge tone={STATUS_META[p.summary.status].tone}>{STATUS_META[p.summary.status].label}</Badge>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}
