import clsx from 'clsx'
import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, PageHeader, Select } from '../components/ui'
import { levenshtein } from '../lib/normalize'
import { computeMetrics, confusion, DIFFICULTIES, pairResults, sliceBy, sweepThreshold, type Metrics, type Ratio } from '../lib/evaluate'
import { human, num, pct } from '../lib/format'
import { useStore } from '../lib/store'

const METRIC_DEFS: { key: keyof Metrics; label: string; def: string; safety?: boolean; lowerBetter?: boolean }[] = [
  { key: 'falseAutoApproval', label: 'False auto-approval rate', def: 'Agent auto-processed a line that should have gone to a human', safety: true, lowerBetter: true },
  { key: 'hallucination', label: 'Hallucination rate', def: 'A SKU was proposed for a product that is not in the catalogue', safety: true, lowerBetter: true },
  { key: 'stpLine', label: 'Straight-through (line)', def: 'Lines correctly auto-processed — dataset ceiling 62.2%' },
  { key: 'stpOrder', label: 'Straight-through (order)', def: 'POs where every line was correctly auto-processed — ceiling 18.9%' },
  { key: 'skuAccuracy', label: 'SKU matching accuracy', def: 'Predicted SKU = true SKU, on lines with one unambiguous answer' },
  { key: 'candidateRecall', label: 'Candidate recall (ambiguous)', def: 'True SKU in the returned candidate set AND the agent declined to commit' },
  { key: 'exceptionAccuracy', label: 'Exception detection accuracy', def: 'Predicted exception type = expected, all lines' },
  { key: 'exceptionRecall', label: 'Exception recall', def: 'Lines with a real exception that were flagged at all' },
  { key: 'actionAccuracy', label: 'Action accuracy', def: 'Predicted action = expected action' },
  { key: 'priceValidation', label: 'Price validation accuracy', def: 'Predicted price status = expected (lines with a reference)' },
  { key: 'falseEscalation', label: 'False escalation rate', def: 'Agent sent a line to a human that could have been auto-processed', lowerBetter: true },
  { key: 'extractQty', label: 'Quantity parsing', def: '"1,200", "800 approx", "~800" parsed to the right number; blanks stay blank' },
  { key: 'extractPrice', label: 'Price parsing', def: '"Rs. 236.22", "236.22/mtr", "INR 233.08" parsed correctly' },
]

const r = (x: Ratio, d = 1) => (x.value === null ? '—' : pct(x.value, d))

function MetricTile({ m, def }: { m: Ratio; def: (typeof METRIC_DEFS)[number] }) {
  return (
    <div className={clsx('rounded-xl border bg-surface p-4 shadow-sm', def.safety ? 'border-emerald-200' : 'border-slate-200')}>
      <div className="flex items-start justify-between gap-2 text-xs font-medium text-slate-500">
        <span>{def.label}</span>{def.safety && <Badge tone="good">safety</Badge>}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{r(m, def.safety ? 2 : 1)}</div>
      <div className="text-[11px] tabular-nums text-slate-400">{num(m.num)} / {num(m.den)}</div>
      <div className="mt-1 text-[11px] leading-snug text-slate-500">{def.def}</div>
    </div>
  )
}

export default function Evaluation() {
  const { inbox, data, uploads, uploadResults, rules } = useStore()
  const [split, setSplit] = useState('test')

  const pairs = useMemo(() => {
    if (!data) return []
    const keep = inbox.filter((p) => {
      const s = data.splits.get(p.input.header.po_id)
      return split === 'all' || (split === 'test_temporal' ? s?.temporal_split === 'test_temporal' : s?.split === split)
    })
    return pairResults(keep, data.gt)
  }, [inbox, data, split])

  const m = useMemo(() => computeMetrics(pairs), [pairs])
  const byDiff = useMemo(() => sliceBy(pairs, (p) => p.gt.difficulty_level), [pairs])
  const byScen = useMemo(() => [...sliceBy(pairs, (p) => p.gt.scenario_type)].sort((a, b) => b[1].lines - a[1].lines), [pairs])
  const sweep = useMemo(() => sweepThreshold(pairs, [0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98])
    .map((s) => ({ ...s, faar: +(s.falseAutoApproval * 100).toFixed(2), stpPct: +(s.stp * 100).toFixed(1) })), [pairs])
  const conf = useMemo(() => confusion(pairs), [pairs])
  const actions = useMemo(() => [...new Set([...conf.keys(), ...[...conf.values()].flatMap((v) => [...v.keys()])])].sort(), [conf])

  // stage-1: Claude extractions of benchmark documents, scored field-by-field
  const extraction = useMemo(() => {
    if (!data) return null
    const lineById = new Map([...data.linesByPo.values()].flat().map((l) => [l.po_line_id, l]))
    const fields = ['quantity_text', 'uom_text', 'unit_price_text', 'colour_text', 'gsm_text'] as const
    const hits: Record<string, [number, number]> = Object.fromEntries(fields.map((f) => [f, [0, 0]]))
    let cerSum = 0, cerN = 0, docs = 0, faN = 0, faDen = 0
    for (const u of uploads.filter((x) => x.method === 'claude')) {
      const res = uploadResults.get(u.id)
      let any = false
      for (const l of u.input.lines) {
        const ref = l.ref_line_id ? lineById.get(l.ref_line_id) : undefined
        if (!ref) continue
        any = true
        for (const f of fields) {
          hits[f][1]++
          if ((l[f] ?? '').trim() === ref[f].trim()) hits[f][0]++
        }
        const a = ref.customer_item_description.trim(), b = l.customer_item_description.trim()
        cerSum += Math.min(1, levenshtein(a, b, 999) / Math.max(1, a.length)); cerN++
      }
      if (res) for (const lr of res.lines) {
        const g = lr.input.ref_line_id ? data.gt.get(lr.input.ref_line_id) : undefined
        if (g && g.should_auto_process !== 'TRUE') { faDen++; if (lr.autoProcess) faN++ }
      }
      if (any) docs++
    }
    return { docs, hits, cer: cerN ? cerSum / cerN : null, lines: cerN, faN, faDen }
  }, [uploads, uploadResults, data])

  const coverage = useMemo(() => {
    if (!data) return null
    const layouts = [...new Set([...data.manifest.values()].map((d) => d.layout_id))].sort()
    const quals = [...new Set([...data.manifest.values()].map((d) => d.quality_id))].sort()
    const cell = new Map<string, number>()
    for (const d of data.manifest.values()) cell.set(`${d.layout_id}|${d.quality_id}`, (cell.get(`${d.layout_id}|${d.quality_id}`) ?? 0) + 1)
    return { layouts, quals, cell }
  }, [data])

  return (
    <div>
      <PageHeader title="Evaluation against ground truth"
        subtitle="The agent's decisions scored against the hidden labels, following the dataset's evaluation protocol. Labels are never visible to the agent; they are joined only here."
        actions={<Select label="Split" value={split} onChange={setSplit} options={[
          { value: 'test', label: 'Test (199 POs)' }, { value: 'validation', label: 'Validation' }, { value: 'train', label: 'Train' },
          { value: 'test_temporal', label: 'Temporal hold-out (newest 15%)' }, { value: 'all', label: 'All 1,000 POs' }]} />} />

      <div className="mb-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-surface p-3 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <div><b>Read these numbers honestly.</b> The data is synthetic and its messiness comes from a finite set of generator rules; the agent's
          normalisation rules were developed with knowledge of those rules and against all splits, so the test split is not a blind hold-out and
          results here are an optimistic ceiling for real POs. The interesting signal is <i>where</i> it fails (by scenario) and the
          safety trade-off below. Current policy: confidence threshold {Math.round(rules.confidence_threshold * 100)}%, price tolerance
          ±{rules.price_tolerance_auto_pct}% / ±{rules.price_tolerance_flag_pct}%.</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {METRIC_DEFS.slice(0, 10).map((d) => <MetricTile key={d.key} m={m[d.key] as Ratio} def={d} />)}
      </div>

      <Card className="mt-5" title="Headline table — performance by difficulty" subtitle="Expected shape: clean degradation from easy to exception. Auto-approval on hard/exception lines should be ~0.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2">Difficulty</th><th className="px-3 py-2 text-right">Lines</th><th className="px-3 py-2 text-right">SKU accuracy</th>
                <th className="px-3 py-2 text-right">Exception accuracy</th><th className="px-3 py-2 text-right">False auto-approval</th>
                <th className="px-3 py-2 text-right">False escalation</th><th className="px-5 py-2 text-right">Straight-through</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DIFFICULTIES.map((d) => {
                const x = byDiff.get(d)
                if (!x) return null
                return (
                  <tr key={d}>
                    <td className="px-5 py-2 font-medium capitalize">{d}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(x.lines)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r(x.skuAccuracy)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r(x.exceptionAccuracy)}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', (x.falseAutoApproval.value ?? 0) > 0.02 && 'font-semibold text-red-700')}>{r(x.falseAutoApproval, 2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r(x.falseEscalation)}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{r(x.stpLine)}</td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-5 py-2">Overall</td><td className="px-3 py-2 text-right tabular-nums">{num(m.lines)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r(m.skuAccuracy)}</td><td className="px-3 py-2 text-right tabular-nums">{r(m.exceptionAccuracy)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r(m.falseAutoApproval, 2)}</td><td className="px-3 py-2 text-right tabular-nums">{r(m.falseEscalation)}</td>
                <td className="px-5 py-2 text-right tabular-nums">{r(m.stpLine)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Safety trade-off: confidence threshold" subtitle="Raising the bar for auto-approval trades straight-through volume for fewer false auto-approvals. Each panel has its own scale.">
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {[{ k: 'stpPct', label: 'Straight-through rate (%)', color: '#2a78d6' }, { k: 'faar', label: 'False auto-approval rate (%)', color: '#d03b3b' }].map((c) => (
              <div key={c.k}>
                <div className="px-2 text-xs font-medium text-slate-600">{c.label}</div>
                <div className="h-52">
                  <ResponsiveContainer>
                    <LineChart data={sweep} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#ececea" />
                      <XAxis dataKey="threshold" type="number" domain={[0.3, 1]} tick={{ fontSize: 10, fill: '#52514e' }} tickFormatter={(v) => `${Math.round(v * 100)}%`} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#52514e' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} labelFormatter={(v) => `threshold ${Math.round(Number(v) * 100)}%`} />
                      <ReferenceLine x={rules.confidence_threshold} stroke="#94a3b8" strokeDasharray="4 3" label={{ value: 'current', fontSize: 10, fill: '#52514e', position: 'insideTopLeft' }} />
                      <Line dataKey={c.k} name={c.label} stroke={c.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
          <p className="px-5 pb-4 text-[11px] text-slate-500">Most of the agent's safety comes from the exception ladder (which lines are never auto-eligible), not the threshold — which is why the curve is flat until the very top. Change the policy in Settings.</p>
        </Card>

        <Card title="Action confusion matrix" subtitle="Rows: expected action · Columns: agent's action">
          <div className="overflow-x-auto p-3">
            <table className="text-[11px]">
              <thead><tr><th />{actions.map((a) => <th key={a} className="h-28 w-9 align-bottom"><div className="w-9 origin-bottom-left translate-x-4 whitespace-nowrap text-left text-slate-500" style={{ transform: "rotate(-60deg)" }}>{human(a)}</div></th>)}</tr></thead>
              <tbody>
                {actions.map((a) => {
                  const row = conf.get(a)
                  const total = row ? [...row.values()].reduce((s, v) => s + v, 0) : 0
                  return (
                    <tr key={a}>
                      <th className="whitespace-nowrap pr-2 text-right font-normal text-slate-600">{human(a)}</th>
                      {actions.map((b) => {
                        const v = row?.get(b) ?? 0
                        const share = total ? v / total : 0
                        return (
                          <td key={b} title={`${human(a)} → ${human(b)}: ${v}`} className="h-8 w-9 border border-surface text-center tabular-nums"
                            style={{ background: v ? (a === b ? `rgba(42,120,214,${0.15 + share * 0.85})` : `rgba(208,59,59,${0.15 + share * 0.85})`) : 'var(--color-slate-50)', color: share > 0.55 ? 'white' : 'var(--color-slate-700)' }}>
                            {v || ''}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-5" title="By scenario" subtitle="Where each kind of messiness lands. FAAR = false auto-approval rate among lines that should have been escalated.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2">Scenario</th><th className="px-3 py-2 text-right">Lines</th><th className="px-3 py-2 text-right">Exception acc.</th>
                <th className="px-3 py-2 text-right">Action acc.</th><th className="px-3 py-2 text-right">SKU acc.</th><th className="px-3 py-2 text-right">FAAR</th><th className="px-5 py-2 text-right">STP</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byScen.map(([k, x]) => (
                <tr key={k}>
                  <td className="px-5 py-1.5">{human(k)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(x.lines)}</td>
                  <td className={clsx('px-3 py-1.5 text-right tabular-nums', (x.exceptionAccuracy.value ?? 1) < 0.95 && 'text-amber-700')}>{r(x.exceptionAccuracy)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r(x.actionAccuracy)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r(x.skuAccuracy)}</td>
                  <td className={clsx('px-3 py-1.5 text-right tabular-nums', (x.falseAutoApproval.value ?? 0) > 0 && 'font-semibold text-red-700')}>{r(x.falseAutoApproval, 1)}</td>
                  <td className="px-5 py-1.5 text-right tabular-nums">{r(x.stpLine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Stage 1 — document extraction (live)" subtitle="Scored on benchmark documents you run through Claude extraction on the Process page.">
          <div className="p-5 text-sm">
            {!extraction || extraction.docs === 0 ? (
              <p className="text-slate-500">No Claude extractions of benchmark documents yet. Add an API key in Settings, then process a few sample documents — each one is scored here field-by-field against the printed ground truth, and the downstream false auto-approval rate on <i>real</i> extraction is compared with the oracle input above.</p>
            ) : (
              <>
                <div className="mb-3 text-xs text-slate-500">{extraction.docs} document(s), {extraction.lines} matched lines</div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(extraction.hits).map(([f, [h, n]]) => (
                      <tr key={f}><td className="py-1.5">{human(f.replace('_text', ''))} exact match</td><td className="py-1.5 text-right tabular-nums">{n ? pct(h / n) : '—'} <span className="text-xs text-slate-400">({h}/{n})</span></td></tr>
                    ))}
                    <tr><td className="py-1.5">Description character error rate</td><td className="py-1.5 text-right tabular-nums">{extraction.cer === null ? '—' : pct(extraction.cer, 2)}</td></tr>
                    <tr><td className="py-1.5 font-medium">False auto-approval on real extraction</td><td className="py-1.5 text-right tabular-nums">{extraction.faDen ? pct(extraction.faN / extraction.faDen, 2) : '—'} <span className="text-xs text-slate-400">({extraction.faN}/{extraction.faDen})</span></td></tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        </Card>
        <Card title="Document benchmark coverage" subtitle="1,000 rendered POs by layout × quality tier (empty cells are impossible by construction)">
          {coverage && (
            <div className="overflow-x-auto p-3">
              <table className="text-xs">
                <thead><tr><th />{coverage.quals.map((q) => <th key={q} className="px-2 py-1 font-medium text-slate-500">{human(q.replace(/^q\d_/, ''))}</th>)}</tr></thead>
                <tbody>
                  {coverage.layouts.map((l) => (
                    <tr key={l}>
                      <th className="whitespace-nowrap pr-2 text-right font-normal text-slate-600">{human(l.replace(/^L\d_/, ''))}</th>
                      {coverage.quals.map((q) => {
                        const v = coverage.cell.get(`${l}|${q}`) ?? 0
                        return <td key={q} className="h-8 w-20 border border-surface text-center tabular-nums" style={{ background: v ? `rgba(42,120,214,${0.1 + Math.min(1, v / 170) * 0.8})` : 'var(--color-slate-50)', color: v > 110 ? 'white' : 'var(--color-slate-700)' }}>{v || ''}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">570 documents carry a text layer; 430 (image-only PDFs, photos, faxes) need OCR or a vision model.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
