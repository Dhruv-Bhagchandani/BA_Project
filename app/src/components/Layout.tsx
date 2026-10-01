import clsx from 'clsx'
import {
  BarChart3, BookOpen, Boxes, ClipboardCheck, FileInput, Gauge, Inbox, Loader2, Menu, Monitor, Moon, ReceiptText, Settings, Sun, Users, X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../lib/store'
import { useTheme, type ThemePref } from '../lib/theme'
import { LogoMark, Wordmark } from './Logo'

const NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/process', label: 'Process a PO', icon: FileInput },
  { to: '/inbox', label: 'PO Inbox', icon: Inbox },
  { to: '/review', label: 'Review Queue', icon: ClipboardCheck, badge: 'review' as const },
  { to: '/sales-orders', label: 'Sales Orders', icon: ReceiptText },
  { to: '/evaluation', label: 'Evaluation', icon: BarChart3 },
  { to: '/catalogue', label: 'Catalogue', icon: Boxes },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/how-it-works', label: 'How it works', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { inbox, uploadResults, reviews, processing, settings } = useStore()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useTheme()
  const loc = useLocation()
  const pending = [...inbox, ...uploadResults.values()].reduce(
    (s, po) => s + po.lines.filter((l) => !l.autoProcess && l.action !== 'reject_line' && !reviews[l.input.po_line_id]).length, 0)

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
          className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
            isActive ? 'bg-[#2f6fd0] text-white shadow-sm' : 'text-side-text hover:bg-white/5 hover:text-white')}>
          <n.icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{n.label}</span>
          {n.badge && pending > 0 && (
            <span className="rounded-full bg-amber-400/90 px-1.5 text-[11px] font-semibold tabular-nums text-black">{pending > 999 ? '999+' : pending}</span>
          )}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className={clsx('no-print fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-white/5 bg-side transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Wordmark />
          <button className="ml-auto text-side-muted lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        {nav}
        <div className="mt-auto space-y-3 px-5 py-4 text-[11px] leading-relaxed text-side-muted">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1" role="radiogroup" aria-label="Theme">
            {([['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'Auto']] as [ThemePref, typeof Sun, string][]).map(([v, Icon, label]) => (
              <button key={v} role="radio" aria-checked={theme === v} onClick={() => setTheme(v)}
                className={clsx('flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium transition',
                  theme === v ? 'bg-white/15 text-white shadow-sm' : 'text-side-muted hover:text-white')}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={clsx('h-2 w-2 rounded-full', settings.apiKey ? 'bg-emerald-400' : 'bg-sky-400')} />
            {settings.apiKey ? 'Claude extraction enabled' : 'Built-in extraction'}
          </div>
          {processing && <div className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Agent processing inbox…</div>}
          <p>Synthetic data for an academic prototype. No real customers, prices or companies.</p>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5 text-slate-700" /></button>
          <span className="flex items-center gap-2 text-sm font-semibold"><LogoMark size={24} /> OrderPilot</span>
        </div>
        <main key={loc.pathname} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
