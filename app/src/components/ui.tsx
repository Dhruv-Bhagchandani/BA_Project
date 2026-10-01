import clsx from 'clsx'
import { CheckCircle2, CircleAlert, CircleHelp, CircleX, Copy, PauseCircle, PencilLine, ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { ACTION_META, TONE_CLASS, type Tone } from '../lib/format'
import type { Action } from '../lib/types'

export function Card({ children, className, title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={clsx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE_CLASS[tone], className)}>
      {children}
    </span>
  )
}

const TONE_ICON: Record<Tone, typeof CheckCircle2> = {
  good: CheckCircle2, flag: CircleAlert, review: ShieldAlert, clarify: CircleHelp, hold: Copy,
  reject: CircleX, manual: PencilLine, neutral: PauseCircle, info: CircleAlert,
}

export function ActionBadge({ action, short }: { action: Action; short?: boolean }) {
  const m = ACTION_META[action]
  const Icon = TONE_ICON[m.tone]
  return (
    <Badge tone={m.tone}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {short ? m.short : m.label}
    </Badge>
  )
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'neutral'; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium text-slate-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className={clsx('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight',
        tone === 'good' && 'text-emerald-700', tone === 'bad' && 'text-red-700', !tone && 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function Confidence({ value }: { value: number }) {
  const pctv = Math.round(value * 100)
  const color = value >= 0.85 ? 'bg-emerald-500' : value >= 0.6 ? 'bg-teal-500' : value >= 0.35 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2" title={`Match confidence ${pctv}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${pctv}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600">{pctv}%</span>
    </div>
  )
}

export function Button({ children, onClick, variant = 'primary', className, disabled, type = 'button', title }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  className?: string; disabled?: boolean; type?: 'button' | 'submit'; title?: string
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={clsx('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        variant === 'success' && 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700',
        className)}>
      {children}
    </button>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-sm text-slate-500">{children}</div>
}

export function Select({ value, onChange, options, className, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; label?: string }) {
  return (
    <label className={clsx('flex items-center gap-2 text-xs text-slate-500', className)}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('font-mono text-[0.8em]', className)}>{children}</span>
}
