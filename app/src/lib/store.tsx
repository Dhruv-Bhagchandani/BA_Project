// Global app state. Everything lives in the browser: master data comes from
// Parquet, user actions (reviews, uploads, settings) persist to localStorage.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadDataset, type Dataset } from './data'
import { buildContext, processPO, registerPO, type EngineContext, type POResult } from './engine'
import type { ReviewDecision } from './salesOrder'
import { DEFAULT_RULES, type Customer, type POInput, type Rules } from './types'

export interface UploadRecord {
  id: string
  createdAt: string
  fileName: string
  method: 'claude' | 'benchmark' | 'manual'
  notes: string
  input: POInput
}

/** What the Add customer form collects; the store fills in id, discount and "new customer" status. */
export type NewCustomer = Pick<Customer, 'customer_name' | 'customer_segment' | 'city' | 'state_code' | 'commercial_tier'
  | 'credit_terms_days' | 'credit_limit_inr' | 'preferred_uom' | 'uses_own_item_codes' | 'customer_code_prefix'
  | 'po_channel_preference'> & { gstin: string }

export const TIER_DISCOUNT_PCT: Record<Customer['commercial_tier'], number> = { A: 12, B: 7, C: 3 }

export interface Settings {
  apiKey: string
  model: string
  reviewer: string
}

interface Store {
  status: 'loading' | 'ready' | 'error'
  progress: { done: number; total: number; label: string }
  error: string | null
  data: Dataset | null
  ctx: EngineContext | null
  rules: Rules
  setRules: (r: Rules) => void
  inbox: POResult[]
  inboxById: Map<string, POResult>
  uploads: UploadRecord[]
  uploadResults: Map<string, POResult>
  addUpload: (u: Omit<UploadRecord, 'id' | 'createdAt'>) => string
  removeUpload: (id: string) => void
  reviews: Record<string, ReviewDecision>
  decide: (poLineId: string, d: Omit<ReviewDecision, 'reviewer' | 'at'>, learn?: { customerId: string; code: string }) => void
  undoDecision: (poLineId: string) => void
  resetDemo: () => void
  settings: Settings
  setSettings: (s: Settings) => void
  getPO: (id: string) => POResult | undefined
  processing: boolean
  /** Customers added through the app (kept in this browser), already included in data.customers. */
  customCustomers: Customer[]
  addCustomer: (c: NewCustomer) => Customer
  removeCustomer: (id: string) => void
}

const Ctx = createContext<Store | null>(null)

function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...initial, ...JSON.parse(raw) } : initial
    } catch {
      return initial
    }
  })
  const set = useCallback((nv: T) => {
    setV(nv)
    try {
      localStorage.setItem(key, JSON.stringify(nv))
    } catch {
      /* storage may be unavailable (private mode) — state still works in memory */
    }
  }, [key])
  return [v, set]
}

function useLocalArray<T>(key: string): [T[], (v: T[]) => void] {
  const [v, setV] = useState<T[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]')
    } catch {
      return []
    }
  })
  const set = useCallback((nv: T[]) => {
    setV(nv)
    try {
      localStorage.setItem(key, JSON.stringify(nv))
    } catch { /* ignore */ }
  }, [key])
  return [v, set]
}

const ENV_KEY = (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ?? ''

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Store['status']>('loading')
  const [progress, setProgress] = useState({ done: 0, total: 1, label: 'starting' })
  const [error, setError] = useState<string | null>(null)
  const [baseData, setBaseData] = useState<Dataset | null>(null)
  const [ctx, setCtx] = useState<EngineContext | null>(null)
  const [rules, setRulesState] = useLocal<Rules>('po2so.rules', DEFAULT_RULES)
  const [reviews, setReviews] = useLocal<Record<string, ReviewDecision>>('po2so.reviews', {})
  const [learned, setLearned] = useLocal<Record<string, string>>('po2so.learnedCodes', {})
  const [uploads, setUploads] = useLocalArray<UploadRecord>('po2so.uploads')
  const [customCustomers, setCustomCustomers] = useLocalArray<Customer>('po2so.customCustomers')
  const [settings, setSettingsState] = useLocal<Settings>('po2so.settings', {
    apiKey: '', model: (import.meta.env.VITE_CLAUDE_MODEL as string) || 'claude-opus-5-5', reviewer: 'Order Desk',
  })
  const [inbox, setInbox] = useState<POResult[]>([])
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    loadDataset((done, total, label) => setProgress({ done, total, label }))
      .then((d) => {
        setBaseData(d)
        setStatus('ready')
      })
      .catch((e) => {
        setError(String(e?.message ?? e))
        setStatus('error')
      })
  }, [])

  // Master data = the shipped customers plus any added in the app.
  const data = useMemo<Dataset | null>(
    () => (baseData ? { ...baseData, customers: [...baseData.customers, ...customCustomers] } : null),
    [baseData, customCustomers],
  )

  // The inbox: every PO is processed in arrival order, so duplicate detection only
  // ever sees POs that had already been received (no look-ahead).
  useEffect(() => {
    if (!data) return
    setProcessing(true)
    const t = setTimeout(() => {
      const fresh = buildContext(data.products, data.customers, data.txns)
      const out: POResult[] = []
      for (const h of data.headers) {
        const ls = data.linesByPo.get(h.po_id) ?? []
        out.push(processPO(fresh, rules, { header: h, lines: ls, source: 'inbox' }))
        registerPO(fresh, h, ls)
      }
      setInbox(out)
      setCtx((c) => {
        const next = fresh
        next.learnedCodes = c?.learnedCodes ?? new Map()
        return next
      })
      setProcessing(false)
    }, 30)
    return () => clearTimeout(t)
  }, [data, rules])

  useEffect(() => {
    if (ctx) ctx.learnedCodes = new Map(Object.entries(learned))
  }, [ctx, learned])

  const inboxById = useMemo(() => new Map(inbox.map((p) => [p.input.header.po_id, p])), [inbox])

  const uploadResults = useMemo(() => {
    const m = new Map<string, POResult>()
    if (!ctx) return m
    ctx.learnedCodes = new Map(Object.entries(learned))
    for (const u of uploads) m.set(u.id, processPO(ctx, rules, u.input))
    return m
  }, [ctx, rules, uploads, learned])

  const addUpload: Store['addUpload'] = (u) => {
    const n = uploads.length ? Math.max(...uploads.map((x) => Number(x.id.replace(/\D/g, '')) || 0)) + 1 : 1
    const id = `UP${String(n).padStart(4, '0')}`
    const input: POInput = {
      ...u.input,
      header: { ...u.input.header, po_id: id },
      lines: u.input.lines.map((l, i) => ({ ...l, ref_line_id: l.ref_line_id ?? (l.po_line_id || undefined), po_id: id, po_line_id: `${id}-L${i + 1}`, line_no: l.line_no || i + 1 })),
    }
    setUploads([{ ...u, input, id, createdAt: new Date().toISOString() }, ...uploads])
    return id
  }

  const decide: Store['decide'] = (poLineId, d, learn) => {
    setReviews({ ...reviews, [poLineId]: { ...d, reviewer: settings.reviewer || 'Reviewer', at: new Date().toISOString() } })
    if (learn && d.status === 'approved' && d.sku && learn.code) setLearned({ ...learned, [`${learn.customerId}|${learn.code}`]: d.sku })
  }
  const undoDecision = (poLineId: string) => {
    const next = { ...reviews }
    delete next[poLineId]
    setReviews(next)
  }

  const addCustomer: Store['addCustomer'] = (c) => {
    const ids = [...(baseData?.customers ?? []), ...customCustomers].map((x) => Number(x.customer_id.replace(/\D/g, '')) || 0)
    const id = `CUST${String(Math.max(0, ...ids) + 1).padStart(4, '0')}`
    const tail = c.gstin.trim() || '00XXXXX0000X1Z0'
    const created: Customer = {
      customer_id: id, customer_name: c.customer_name.trim(), customer_segment: c.customer_segment, city: c.city.trim(),
      state_code: c.state_code.trim().toUpperCase(), gstin_masked: tail.toUpperCase(), commercial_tier: c.commercial_tier,
      standard_discount_pct: TIER_DISCOUNT_PCT[c.commercial_tier], credit_terms_days: c.credit_terms_days,
      credit_limit_inr: c.credit_limit_inr, preferred_uom: c.preferred_uom, uses_own_item_codes: c.uses_own_item_codes,
      customer_code_prefix: c.uses_own_item_codes ? c.customer_code_prefix.trim().toUpperCase() : '',
      onboarding_date: new Date().toISOString().slice(0, 10),
      // brand-new buyers have no history: the agent never auto-approves their first orders
      is_new_customer: true, po_channel_preference: c.po_channel_preference, avg_monthly_order_value_inr: 0,
    }
    setCustomCustomers([...customCustomers, created])
    return created
  }

  const value: Store = {
    status, progress, error, data, ctx, rules, setRules: setRulesState, inbox, inboxById, uploads, uploadResults,
    addUpload, removeUpload: (id) => setUploads(uploads.filter((u) => u.id !== id)),
    reviews, decide, undoDecision,
    resetDemo: () => {
      setReviews({})
      setLearned({})
      setUploads([])
      setCustomCustomers([])
      setRulesState(DEFAULT_RULES)
    },
    settings: { ...settings, apiKey: settings.apiKey || ENV_KEY },
    setSettings: setSettingsState,
    getPO: (id) => inboxById.get(id) ?? uploadResults.get(id),
    processing, customCustomers, addCustomer,
    removeCustomer: (id) => setCustomCustomers(customCustomers.filter((c) => c.customer_id !== id)),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}
