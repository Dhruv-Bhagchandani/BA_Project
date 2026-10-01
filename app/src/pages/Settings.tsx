import { CheckCircle2, KeyRound, Loader2, RotateCcw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, PageHeader } from '../components/ui'
import { CLAUDE_MODELS } from '../lib/claude'
import { useStore } from '../lib/store'
import { DEFAULT_RULES, type Rules } from '../lib/types'

const RULE_FIELDS: { key: keyof Rules; label: string; hint: string; step: number; scale?: number; suffix: string }[] = [
  { key: 'confidence_threshold', label: 'Auto-approval confidence threshold', hint: 'Lines matched below this confidence go to review', step: 1, scale: 100, suffix: '%' },
  { key: 'price_tolerance_auto_pct', label: 'Price tolerance — straight through', hint: '|Δ| at or below this is clean', step: 0.5, suffix: '%' },
  { key: 'price_tolerance_flag_pct', label: 'Price tolerance — auto with flag', hint: 'Above this the line goes to price review', step: 0.5, suffix: '%' },
  { key: 'reference_price_max_age_days', label: 'Reference price max age', hint: 'Older references are used but flagged stale', step: 10, suffix: 'days' },
  { key: 'qty_outlier_multiple', label: 'Quantity outlier multiple', hint: '× customer\'s median line quantity', step: 1, suffix: '×' },
  { key: 'qty_outlier_abs_mtr', label: 'Quantity outlier (absolute)', hint: 'Any single line above this many metres', step: 1000, suffix: 'MTR' },
  { key: 'duplicate_window_days', label: 'Duplicate PO window', hint: 'Same customer + same lines within this many days', step: 1, suffix: 'days' },
]

export default function Settings() {
  const { settings, setSettings, rules, setRules, resetDemo, processing } = useStore()
  const [key, setKey] = useState(settings.apiKey)
  const [draft, setDraft] = useState<Rules>(rules)
  const [saved, setSaved] = useState(false)
  const envKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Settings" />

      <Card title={<span className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Claude document extraction</span>}
        subtitle="Optional. Without a key the app runs in offline demo mode (pdf.js / OCR + benchmark lookup).">
        <div className="space-y-3 p-5">
          <label className="block text-xs font-medium text-slate-600">Anthropic API key
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" />
          </label>
          <label className="block text-xs font-medium text-slate-600">Model
            <select value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">Reviewer name (shown on approvals)
            <input value={settings.reviewer} onChange={(e) => setSettings({ ...settings, reviewer: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => { setSettings({ ...settings, apiKey: key.trim() }); setSaved(true); setTimeout(() => setSaved(false), 2000) }}>Save key</Button>
            {settings.apiKey && <Button variant="ghost" onClick={() => { setKey(''); setSettings({ ...settings, apiKey: '' }) }}>Remove key</Button>}
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Saved in this browser</span>}
          </div>
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <div>The key is stored only in this browser's localStorage and sent only to <code>api.anthropic.com</code>. Use a key with a low spend limit for demos and remove it on shared machines.
              {envKey && <> A build-time key (<code>VITE_ANTHROPIC_API_KEY</code>) is also configured — anything in a <code>VITE_</code> variable is embedded in the public JavaScript bundle, so only do this for private demos.</>}</div>
          </div>
        </div>
      </Card>

      <Card title="Agent policy" subtitle="Changing these re-runs the agent over the entire inbox. Defaults are the dataset's business rules.">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {RULE_FIELDS.map((f) => (
            <label key={f.key} className="block text-xs font-medium text-slate-600">{f.label}
              <div className="mt-1 flex items-center gap-2">
                <input type="number" step={f.step} value={+(draft[f.key] * (f.scale ?? 1)).toFixed(2)}
                  onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) / (f.scale ?? 1) })}
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums" />
                <span className="text-slate-500">{f.suffix}</span>
              </div>
              <span className="mt-0.5 block font-normal text-slate-400">{f.hint}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
          <Button onClick={() => setRules(draft)} disabled={JSON.stringify(draft) === JSON.stringify(rules)}>Apply & re-run agent</Button>
          <Button variant="ghost" onClick={() => { setDraft(DEFAULT_RULES); setRules(DEFAULT_RULES) }}>Restore defaults</Button>
          {processing && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> re-running…</span>}
        </div>
      </Card>

      <Card title="Demo data">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-slate-600">
          <span>Clear review decisions, learned customer codes, uploads and policy changes in this browser.</span>
          <Button variant="danger" onClick={() => { if (confirm('Reset all local demo state?')) { resetDemo(); setDraft(DEFAULT_RULES) } }}><RotateCcw className="h-4 w-4" /> Reset demo</Button>
        </div>
      </Card>
    </div>
  )
}
