import { ArrowRight, Bot, Database, FileSearch, FileUp, Globe, ScanText, ShieldCheck } from 'lucide-react'
import { Card, PageHeader } from '../components/ui'
import { useStore } from '../lib/store'

const LADDER = [
  ['1', 'Line is malformed / free text with no attributes', 'incomplete line', 'manual entry', false],
  ['2', 'Document illegible (OCR damage)', 'illegible document', 'manual entry', false],
  ['3', 'Product not in catalogue', 'unknown product', 'reject line', false],
  ['4', 'PO duplicates an earlier PO', 'duplicate order', 'hold — duplicate check', false],
  ['5', 'Quantity missing / non-numeric', 'missing quantity', 'request clarification', false],
  ['6', 'Remarks contradict the description', 'conflicting data', 'request clarification', false],
  ['7', 'Several SKUs legitimately fit', 'ambiguous match', 'review match', false],
  ['8', 'Stated GSM/colour contradicts catalogue', 'attribute conflict', 'review match', false],
  ['9', 'Quality exists, requested colour does not', 'partial match', 'review match', false],
  ['10', 'Only a customer-internal code', 'unmapped customer code', 'review match', false],
  ['11', 'Match confidence below threshold', 'low-confidence match', 'review match', false],
  ['12', 'KG ↔ MTR (no yield data)', 'UOM mismatch', 'review UOM', false],
  ['13', 'Price > 5% off reference', 'major price variance', 'review price', false],
  ['14', 'Customer has no trading history', 'new customer', 'review price', false],
  ['15', 'Quantity > 8× customer norm', 'quantity outlier', 'review quantity', false],
  ['16', 'Yards → metres (deterministic)', 'UOM converted', 'auto + flag', true],
  ['17', 'Reference price > 180 days old', 'stale reference', 'auto + flag', true],
  ['18', 'No customer history for SKU → tier list price', 'no reference price', 'auto + flag', true],
  ['19', 'Price 2–5% off reference', 'minor variance', 'auto + flag', true],
  ['20', 'Everything clean', 'none', 'auto-process', true],
] as const

const STAGES = [
  { icon: FileUp, title: 'Ingest', text: 'PDF, scan, phone photo, fax or email text — uploaded in the browser.' },
  { icon: ScanText, title: 'Extract', text: 'Claude reads the document verbatim into header + lines (never fixes typos or invents quantities). Without a key: built-in pdf.js text layer / tesseract OCR, matched against the document register.' },
  { icon: FileSearch, title: 'Match', text: 'Normalise abbreviations, typos, colour synonyms and trade jargon; IDF-weighted match over 192+ quality groups; then colour within the group. Never guesses between siblings.' },
  { icon: ShieldCheck, title: 'Validate', text: 'Price vs this customer\'s last transacted price (as of PO date, ≤180 days) or tier list price; UOM convertibility; quantity outliers; duplicate POs; contradicting remarks.' },
  { icon: Bot, title: 'Decide', text: 'A fixed 20-rung precedence ladder turns findings into one exception + one action. Only rungs 16–20 may auto-process.' },
  { icon: Database, title: 'Sales order', text: 'Auto lines become SO lines immediately (reference price replaces out-of-tolerance quotes); held lines wait for a reviewer, whose choices also teach customer codes.' },
]

export default function HowItWorks() {
  const { rules } = useStore()
  return (
    <div className="space-y-5">
      <PageHeader title="How the agent works"
        subtitle="A two-stage pipeline: an LLM for what LLMs are good at (reading messy documents), and a transparent rules engine for what must be auditable (commercial decisions)." />

      <Card title="Pipeline">
        <div className="grid gap-3 p-5 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((s, i) => (
            <div key={s.title} className="relative rounded-lg border border-slate-200 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-600"><s.icon className="h-4 w-4" /></span>{i + 1}. {s.title}
              </div>
              <p className="text-xs leading-relaxed text-slate-600">{s.text}</p>
              {i < STAGES.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-4 w-4 text-slate-300 xl:block" />}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Decision ladder" subtitle="Data-integrity blockers first, then identity risk, then commercial risk, then advisory flags. The first rung that fires decides the line.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2">#</th><th className="px-2 py-2">Condition</th><th className="px-2 py-2">Exception</th><th className="px-2 py-2">Action</th><th className="px-4 py-2">Auto?</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {LADDER.map(([n, c, e, a, auto]) => (
                  <tr key={n} className={auto ? 'bg-emerald-50/50' : ''}>
                    <td className="px-4 py-1.5 text-slate-400">{n}</td><td className="px-2 py-1.5">{c}</td><td className="px-2 py-1.5 text-slate-600">{e}</td>
                    <td className="px-2 py-1.5 font-medium">{a}</td><td className="px-4 py-1.5">{auto ? '✓' : '✗'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Price tolerance bands">
            <div className="space-y-2 p-5 text-sm">
              <div className="flex justify-between rounded-md bg-emerald-50 px-3 py-2"><span>|Δ| ≤ {rules.price_tolerance_auto_pct}%</span><b>within tolerance → straight through</b></div>
              <div className="flex justify-between rounded-md bg-amber-50 px-3 py-2"><span>{rules.price_tolerance_auto_pct}% &lt; |Δ| ≤ {rules.price_tolerance_flag_pct}%</span><b>auto, flagged for report</b></div>
              <div className="flex justify-between rounded-md bg-red-50 px-3 py-2"><span>|Δ| &gt; {rules.price_tolerance_flag_pct}%</span><b>price review; SO carries reference</b></div>
              <p className="pt-1 text-xs text-slate-500">Reference = this customer's last transacted price for the SKU as of the PO date (never a later transaction). Older than {rules.reference_price_max_age_days} days → usable but flagged stale. No history → list price less tier discount (A 12% · B 7% · C 3%).</p>
            </div>
          </Card>
          <Card title="Two safety rules worth defending">
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <p><b>New customers are never straight-through.</b> Their lines look easy — but there is no negotiated price and no payment behaviour to rely on. An over-eager agent auto-approves them.</p>
              <p><b>Never silently substitute a colour or pick between siblings.</b> A PO for “65/35 PC Poplin 120 GSM” with no colour maps to 2–6 real SKUs. Picking one is a failure even when it happens to be right. The agent returns the full candidate set.</p>
              <p><b>Never invent a quantity or a SKU.</b> Blank stays blank; hemp, silk or neoprene get rejected, not mapped to the nearest cotton.</p>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Deployment architecture" subtitle="Frontend-only. No server to run, scale or secure.">
        <div className="grid gap-4 p-5 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-1 flex items-center gap-2 font-semibold"><Globe className="h-4 w-4 text-brand-600" /> Static site (Vercel CDN)</div>
            <p className="text-xs leading-relaxed text-slate-600">React + Vite build. The agent engine, matching, pricing, decisions, evaluation and sales-order generation all run in the browser in &lt;1 s for 1,000 POs.</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-1 flex items-center gap-2 font-semibold"><Database className="h-4 w-4 text-brand-600" /> Parquet data files</div>
            <p className="text-xs leading-relaxed text-slate-600">Catalogue, customers, 7,500 transactions, 1,000 POs and labels ship as ~1.3 MB of Snappy-compressed Parquet in <code>/data</code>, read client-side with hyparquet. Reviews and uploads persist to localStorage.</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-1 flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-brand-600" /> Claude API (optional)</div>
            <p className="text-xs leading-relaxed text-slate-600">For real document extraction the browser calls the Anthropic API directly with the user's own key (Settings), using structured output so the response always fits the PO schema. Without a key, built-in extraction is used.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
