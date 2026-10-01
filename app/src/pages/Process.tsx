import clsx from 'clsx'
import {
  ArrowRight, Bot, Check, ClipboardType, FileSearch, FileUp, Images, Inbox, KeyRound, Loader2, Plus, ScanText,
  ShieldCheck, Sparkles, Trash2, Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sessionFiles } from '../components/POView'
import { Badge, Button, Card, Mono, PageHeader } from '../components/ui'
import { extractWithClaude } from '../lib/claude'
import { benchmarkLookup, emptyLine, fileToBase64, findPoNumbers, fromClaude, fuzzyIdentify, ocr, pdfText, renderPdfPage } from '../lib/docExtract'
import { human } from '../lib/format'
import { useStore, type UploadRecord } from '../lib/store'
import type { POInput, POLineInput } from '../lib/types'

type Tab = 'upload' | 'samples' | 'inbox' | 'text'
type Phase = 'pick' | 'extracting' | 'edit' | 'running'

const STAGES = [
  { key: 'ingest', label: 'Ingest', icon: FileUp, desc: 'Receive document' },
  { key: 'extract', label: 'Extract', icon: ScanText, desc: 'Read header & lines' },
  { key: 'match', label: 'Match', icon: FileSearch, desc: 'Catalogue SKU' },
  { key: 'validate', label: 'Validate', icon: ShieldCheck, desc: 'Price · UOM · qty · dupes' },
  { key: 'decide', label: 'Decide', icon: Bot, desc: 'Auto or human' },
  { key: 'so', label: 'Sales Order', icon: Check, desc: 'Draft SO lines' },
]

function Stepper({ active, done }: { active: number; done: boolean }) {
  return (
    <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {STAGES.map((s, i) => {
        const state = done || i < active ? 'done' : i === active ? 'active' : 'todo'
        return (
          <li key={s.key} className={clsx('rounded-lg border px-3 py-2.5 transition',
            state === 'done' && 'border-emerald-200 bg-emerald-50', state === 'active' && 'border-brand-300 bg-brand-50 shadow-sm',
            state === 'todo' && 'border-slate-200 bg-surface')}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              {state === 'done' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <s.icon className="h-3.5 w-3.5 text-slate-400" />}
              {s.label}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">{s.desc}</div>
          </li>
        )
      })}
    </ol>
  )
}

const FIELDS: { key: keyof POLineInput; label: string; w: string }[] = [
  { key: 'customer_item_description', label: 'Description (as written)', w: 'min-w-[260px]' },
  { key: 'customer_item_code', label: 'Cust. code', w: 'w-24' },
  { key: 'colour_text', label: 'Colour', w: 'w-24' },
  { key: 'gsm_text', label: 'GSM', w: 'w-16' },
  { key: 'width_text', label: 'Width', w: 'w-16' },
  { key: 'quantity_text', label: 'Qty', w: 'w-24' },
  { key: 'uom_text', label: 'UOM', w: 'w-20' },
  { key: 'unit_price_text', label: 'Rate', w: 'w-28' },
  { key: 'line_remarks', label: 'Remarks', w: 'min-w-[160px]' },
]

function ExtractionEditor({ draft, setDraft }: { draft: POInput; setDraft: (d: POInput) => void }) {
  const { data } = useStore()
  const h = draft.header
  const setH = (k: keyof POInput['header'], v: string) => setDraft({ ...draft, header: { ...h, [k]: v } })
  const setL = (i: number, k: keyof POLineInput, v: string) =>
    setDraft({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) })
  const input = 'w-full rounded-md border border-slate-300 bg-surface px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-[11px] text-slate-500 lg:col-span-2">Buyer (customer master)
          <select className={input} value={h.customer_id} onChange={(e) => setDraft({ ...draft, header: { ...h, customer_id: e.target.value } })}>
            <option value="">— not matched{draft.customer_name_text ? `: "${draft.customer_name_text}"` : ''} —</option>
            {data?.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name} · {c.city} ({c.customer_id})</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-500">PO number<input className={input} value={h.po_number} onChange={(e) => setH('po_number', e.target.value)} /></label>
        <label className="text-[11px] text-slate-500">PO date<input type="date" className={input} value={h.po_date} onChange={(e) => setH('po_date', e.target.value)} /></label>
        <label className="text-[11px] text-slate-500">Delivery by<input type="date" className={input} value={h.requested_delivery_date} onChange={(e) => setH('requested_delivery_date', e.target.value)} /></label>
        <label className="text-[11px] text-slate-500">Ship to<input className={input} value={h.ship_to_city} onChange={(e) => setH('ship_to_city', e.target.value)} /></label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-2 py-2">#</th>{FIELDS.map((f) => <th key={f.key} className="px-1 py-2 font-medium">{f.label}</th>)}<th /></tr>
          </thead>
          <tbody>
            {draft.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 text-slate-400">{i + 1}{l.legibility && l.legibility !== 'clear' && <Badge tone="clarify" className="ml-1">{l.legibility}</Badge>}</td>
                {FIELDS.map((f) => (
                  <td key={f.key} className={clsx('px-1 py-1', f.w)}>
                    <input className={clsx(input, 'font-mono')} value={String(l[f.key] ?? '')} onChange={(e) => setL(i, f.key, e.target.value)} />
                  </td>
                ))}
                <td className="px-1"><button className="text-slate-400 hover:text-red-600" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} aria-label="Remove line"><Trash2 className="h-3.5 w-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine(draft.lines.length + 1)] })}><Plus className="h-4 w-4" /> Add line</Button>
    </div>
  )
}

const blankDraft = (): POInput => ({
  header: {
    po_id: '', po_number: '', customer_id: '', po_date: new Date().toISOString().slice(0, 10), received_channel: 'Manual',
    document_quality: '', document_language_mix: '', currency: 'INR', payment_terms_days: '', requested_delivery_date: '',
    ship_to_city: '', po_line_count: 0,
  },
  lines: [emptyLine(1)],
  source: 'manual',
})

export default function Process() {
  const { data, settings, addUpload, uploads, uploadResults, removeUpload } = useStore()
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('samples')
  const [phase, setPhase] = useState<Phase>('pick')
  const [stage, setStage] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [rawText, setRawText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<POInput | null>(null)
  const [meta, setMeta] = useState<{ fileName: string; method: UploadRecord['method']; notes: string; file?: { url: string; type: string; name: string } } | null>(null)
  const [useClaude, setUseClaude] = useState(!!settings.apiKey)
  const [inboxQuery, setInboxQuery] = useState('')
  const [pasted, setPasted] = useState('')
  const [sampleFilter, setSampleFilter] = useState('all')
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  useEffect(() => setUseClaude(!!settings.apiKey), [settings.apiKey])
  const say = (s: string) => setLog((l) => [...l, s])

  const reset = () => {
    setPhase('pick'); setStage(0); setLog([]); setRawText(''); setErr(null); setDraft(null); setMeta(null)
  }

  async function handleFile(blob: Blob, name: string) {
    if (!data) return
    reset()
    setPhase('extracting')
    const type = blob.type || (name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg')
    const url = URL.createObjectURL(blob)
    const file = { url, type, name }
    setStage(0)
    say(`Received ${name} (${(blob.size / 1024).toFixed(0)} KB, ${type})`)
    await new Promise((r) => setTimeout(r, 250))
    setStage(1)
    try {
      if (useClaude && settings.apiKey) {
        say(`Sending to ${settings.model} for extraction… (direct from your browser)`)
        const res = await extractWithClaude({ apiKey: settings.apiKey, model: settings.model, file: { base64: await fileToBase64(blob), mediaType: type } })
        say(`Claude returned ${res.data.lines.length} lines · ${res.usage.input.toLocaleString()} in / ${res.usage.output.toLocaleString()} out tokens`)
        if (res.data.document_notes) say(`Notes: ${res.data.document_notes}`)
        setDraft(fromClaude(res.data, data))
        setMeta({ fileName: name, method: 'claude', notes: res.data.document_notes, file })
      } else {
        let text = ''
        if (type.includes('pdf')) {
          const t = await pdfText(blob)
          text = t.text
          say(`PDF has ${t.pages} page(s); text layer: ${text.trim().length > 40 ? `${text.trim().length} characters` : 'NONE (image-only scan)'}`)
          if (text.trim().length <= 40) {
            say('Rendering page 1 and running OCR (tesseract.js, in-browser)…')
            text = await ocr(await renderPdfPage(blob), (p) => setLog((l) => [...l.slice(0, -1), `OCR ${(p * 100).toFixed(0)}%`]))
            say('OCR complete')
          }
        } else {
          say('Image document — running OCR (tesseract.js, in-browser)…')
          say('OCR 0%')
          text = await ocr(blob, (p) => setLog((l) => [...l.slice(0, -1), `OCR ${(p * 100).toFixed(0)}%`]))
        }
        setRawText(text)
        const nums = findPoNumbers(text)
        say(nums.length ? `Found PO number ${nums.join(', ')}` : 'PO number not legible in the OCR text')
        if (!nums.some((n) => data.headers.some((h) => h.po_number === n))) {
          const fz = fuzzyIdentify(data, text)
          if (fz) {
            say(`Identified ${fz.poNumber} from other printed evidence: ${fz.evidence.join(', ')}`)
            nums.push(fz.poNumber)
          }
        }
        const hit = nums.map((n) => benchmarkLookup(data, n)).find(Boolean)
        if (hit) {
          say(`Matched ${hit.header.po_number} in the document register — loaded ${hit.lines.length} lines`)
          setDraft(hit)
          setMeta({ fileName: name, method: 'benchmark', notes: 'Built-in extraction — document recognised and its lines loaded from the document register', file })
        } else {
          say('This document is not in the register. Enable Claude extraction in Settings to read any PO, or enter the lines below.')
          setDraft({ ...blankDraft(), source: 'upload' })
          setMeta({ fileName: name, method: 'manual', notes: text.slice(0, 300), file })
        }
      }
      setPhase('edit')
    } catch (e) {
      setErr(String((e as Error).message ?? e))
      setPhase('pick')
    }
  }

  async function runAgent(input: POInput, m: NonNullable<typeof meta>) {
    setPhase('running')
    for (let i = 2; i <= 5; i++) {
      setStage(i)
      await new Promise((r) => setTimeout(r, 380))
    }
    const id = addUpload({ fileName: m.fileName, method: m.method, notes: m.notes, input: { ...input, source: 'upload' } })
    if (m.file) sessionFiles.set(id, m.file)
    nav(`/po/${id}`)
  }

  async function runInbox(poId: string) {
    reset()
    setPhase('running')
    for (let i = 0; i <= 5; i++) {
      setStage(i)
      await new Promise((r) => setTimeout(r, 260))
    }
    nav(`/po/${poId}`)
  }

  async function handleText() {
    if (!data) return
    reset()
    if (!pasted.trim()) { setDraft(blankDraft()); setMeta({ fileName: 'Manual entry', method: 'manual', notes: '' }); setPhase('edit'); return }
    setPhase('extracting'); setStage(1)
    try {
      if (!settings.apiKey) throw new Error('Pasted-text extraction needs a Claude API key (Settings). You can still enter lines manually.')
      say(`Sending text to ${settings.model}…`)
      const res = await extractWithClaude({ apiKey: settings.apiKey, model: settings.model, text: pasted })
      say(`Claude returned ${res.data.lines.length} lines`)
      setDraft(fromClaude(res.data, data))
      setMeta({ fileName: 'Pasted text', method: 'claude', notes: res.data.document_notes })
      setPhase('edit')
    } catch (e) {
      setErr(String((e as Error).message ?? e)); setPhase('pick')
    }
  }

  const samples = useMemo(() => (data?.samples ?? []).filter((s) => sampleFilter === 'all' || s.quality_id === sampleFilter || s.layout_id === sampleFilter), [data, sampleFilter])
  const inboxHits = useMemo(() => {
    if (!data) return []
    const q = inboxQuery.toLowerCase()
    const cust = new Map(data.customers.map((c) => [c.customer_id, c.customer_name]))
    return data.headers.filter((h) => !q || `${h.po_id} ${h.po_number} ${cust.get(h.customer_id)}`.toLowerCase().includes(q)).slice(0, 12)
      .map((h) => ({ h, name: cust.get(h.customer_id) ?? '' }))
  }, [data, inboxQuery])

  const TABS: { k: Tab; label: string; icon: typeof Upload }[] = [
    { k: 'samples', label: 'Sample documents', icon: Images },
    { k: 'upload', label: 'Upload a PO', icon: Upload },
    { k: 'inbox', label: 'From the inbox', icon: Inbox },
    { k: 'text', label: 'Paste email / manual', icon: ClipboardType },
  ]

  return (
    <div>
      <PageHeader title="Process a purchase order"
        subtitle="Drop in a customer PO — PDF, scan, phone photo or email text. The agent extracts it, matches every line to the catalogue, validates price, unit and quantity against history, and decides what can become a sales order automatically." />

      <Card className="mb-5 p-4"><Stepper active={phase === 'pick' ? -1 : stage} done={false} /></Card>

      {phase === 'pick' && (
        <Card>
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 pt-3">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={clsx('flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium',
                  tab === t.k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
                <t.icon className="h-4 w-4" />{t.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-2 text-xs">
              <span className="text-slate-500">Extraction:</span>
              <button onClick={() => settings.apiKey && setUseClaude(true)} disabled={!settings.apiKey}
                className={clsx('rounded-md px-2 py-1 font-medium', useClaude ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600', !settings.apiKey && 'opacity-50')}>
                <Sparkles className="mr-1 inline h-3 w-3" />Claude
              </button>
              <button onClick={() => setUseClaude(false)} className={clsx('rounded-md px-2 py-1 font-medium', !useClaude ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>Built-in</button>
              {!settings.apiKey && <Link to="/settings" className="flex items-center gap-1 text-brand-600 hover:underline"><KeyRound className="h-3 w-3" />add key</Link>}
            </div>
          </div>

          {err && <div className="mx-5 mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</div>}

          <div className="p-5">
            {tab === 'upload' && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f, f.name) }}
                onClick={() => fileRef.current?.click()}
                className={clsx('grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50')}>
                <Upload className="mb-2 h-8 w-8 text-slate-400" />
                <div className="text-sm font-medium text-slate-800">Drop a PO here, or click to browse</div>
                <div className="mt-1 text-xs text-slate-500">PDF (digital or scanned), PNG, JPG · any of the 1,000 benchmark documents in <Mono>po_documents.zip</Mono> works without an API key</div>
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, f.name); e.target.value = '' }} />
              </div>
            )}

            {tab === 'samples' && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">Filter:</span>
                  {['all', 'q1_clean_digital', 'q2_print_scan', 'q3_poor_scan', 'q4_phone_photo', 'q5_fax_bitonal', 'L5_handwritten_slip', 'L3_email_body'].map((f) => (
                    <button key={f} onClick={() => setSampleFilter(f)} className={clsx('rounded-full px-2.5 py-1', sampleFilter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                      {f === 'all' ? 'All' : human(f.replace(/^(q\d|L\d)_/, ''))}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {samples.map((s) => (
                    <button key={s.document_file} onClick={async () => {
                      const blob = await fetch(`${import.meta.env.BASE_URL}samples/${s.document_file}`).then((r) => r.blob())
                      handleFile(blob, s.document_file)
                    }} className="group rounded-xl border border-slate-200 bg-surface p-3 text-left transition hover:border-brand-400 hover:shadow-md">
                      <div className="mb-2 grid h-36 place-items-center overflow-hidden rounded-lg bg-slate-100">
                        <img src={`${import.meta.env.BASE_URL}samples/thumbs/${s.document_file.replace(/\.\w+$/, '.jpg')}`} alt={`Preview of ${s.po_number}`} loading="lazy" className="h-full w-full object-cover object-top" />
                      </div>
                      <div className="font-mono text-xs font-medium text-slate-800">{s.po_number}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone="info">{s.layout_name.split(/[,(]/)[0].replace('Classic bordered tabular PO on plain letterhead', 'Classic tabular')}</Badge>
                        <Badge tone={s.has_text_layer === 'Y' ? 'good' : 'review'}>{human(s.quality_id.replace(/^q\d_/, ''))}</Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{s.file_format.toUpperCase()} · {s.n_pages} page{s.n_pages !== '1' && 's'} · {s.n_lines} lines · {s.has_text_layer === 'Y' ? 'has text layer' : 'needs OCR'}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-slate-500">Filenames carry layout/quality for browsing only — the extractor never reads them.</p>
              </>
            )}

            {tab === 'inbox' && (
              <div>
                <input value={inboxQuery} onChange={(e) => setInboxQuery(e.target.value)} placeholder="Search PO id, PO number or customer…"
                  className="mb-3 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <p className="mb-3 text-xs text-slate-500">Inbox POs arrive already extracted (oracle input) — this runs only the matching / validation / decision stages.</p>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {inboxHits.map(({ h, name }) => (
                    <button key={h.po_id} onClick={() => runInbox(h.po_id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                      <Mono className="w-16 text-slate-500">{h.po_id}</Mono>
                      <Mono className="w-44 text-slate-800">{h.po_number}</Mono>
                      <span className="flex-1 truncate">{name}</span>
                      <span className="text-xs text-slate-500">{h.po_date} · {h.po_line_count} lines</span>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'text' && (
              <div className="space-y-3">
                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={9}
                  placeholder={'Paste an order email, e.g.\n\nDear Sir, please supply the following against our PO MEG/PO/2026-09/1182 dated 2026-09-12:\n1) 100% Cotton Poplin 120 GSM 58" Navy — 1,200 mtrs @ Rs. 118.50\n2) PC shirting usual — 800 mtr\n…'}
                  className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs" />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleText} disabled={!pasted.trim()}><Sparkles className="h-4 w-4" /> Extract with Claude</Button>
                  <Button variant="secondary" onClick={() => { setPasted(''); setDraft(blankDraft()); setMeta({ fileName: 'Manual entry', method: 'manual', notes: '' }); setPhase('edit') }}>Enter lines manually</Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {(phase === 'extracting' || phase === 'running') && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800"><Loader2 className="h-4 w-4 animate-spin text-brand-600" /> {phase === 'extracting' ? 'Reading the document…' : 'Agent is matching, validating and deciding…'}</div>
          <ul className="mt-3 space-y-1 font-mono text-xs text-slate-600">{log.map((l, i) => <li key={i}>› {l}</li>)}</ul>
        </Card>
      )}

      {phase === 'edit' && draft && meta && (
        <div className={clsx('grid gap-5', meta.file && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
          <Card title="Check the extraction" subtitle={meta.method === 'claude' ? 'Claude transcribed the document verbatim. Fix anything misread before the agent runs — in production this step is optional.' : meta.method === 'benchmark' ? 'Built-in extraction recognised this document and loaded its lines. Check them before the agent runs.' : 'Enter or correct the lines as written on the PO.'}
            action={<Badge tone={meta.method === 'claude' ? 'info' : meta.method === 'benchmark' ? 'hold' : 'neutral'}>{meta.method === 'claude' ? 'Claude extraction' : meta.method === 'benchmark' ? 'Built-in extraction' : 'Manual'}</Badge>}>
            <div className="p-5">
              {log.length > 0 && <ul className="mb-4 space-y-0.5 rounded-lg bg-slate-50 p-3 font-mono text-[11px] text-slate-600">{log.map((l, i) => <li key={i}>› {l}</li>)}</ul>}
              {rawText && (
                <details className="mb-4 text-xs">
                  <summary className="cursor-pointer text-slate-500">Raw text recovered from the document ({rawText.length} chars)</summary>
                  <pre data-testid="raw-text" className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0d1117] p-3 font-mono text-[11px] text-[#e6edf3]">{rawText}</pre>
                </details>
              )}
              <ExtractionEditor draft={draft} setDraft={setDraft} />
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <Button onClick={() => runAgent(draft, meta)} disabled={!draft.lines.some((l) => l.customer_item_description.trim())}>
                  <Bot className="h-4 w-4" /> Run the agent <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" onClick={reset}>Cancel</Button>
              </div>
            </div>
          </Card>
          {meta.file && (
            <Card title="Source document" subtitle={meta.file.name}>
              <div className="h-[620px] overflow-auto bg-slate-100">
                {meta.file.type.includes('pdf') ? <iframe src={meta.file.url} title="document" className="h-full w-full" /> : <img src={meta.file.url} alt="" className="w-full" />}
              </div>
            </Card>
          )}
        </div>
      )}

      {phase === 'pick' && uploads.length > 0 && (
        <Card className="mt-5" title="Processed in this browser" subtitle="Uploads and manual entries are kept locally (localStorage); source files are kept for this session only.">
          <div className="divide-y divide-slate-100">
            {uploads.map((u) => {
              const r = uploadResults.get(u.id)
              return (
                <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                  <Mono className="text-slate-500">{u.id}</Mono>
                  <Link to={`/po/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.input.header.po_number || u.fileName}</Link>
                  <span className="truncate text-slate-500">{r?.customer?.customer_name ?? u.input.customer_name_text}</span>
                  <Badge tone={u.method === 'claude' ? 'info' : 'neutral'}>{u.method === 'claude' ? 'Claude' : u.method === 'benchmark' ? 'built-in' : 'manual'}</Badge>
                  {r && <span className="text-xs text-slate-500">{r.summary.auto + r.summary.autoFlagged}/{r.summary.lines} lines auto</span>}
                  <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => removeUpload(u.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
