import { useId } from 'react'

/** OrderPilot mark: a purchase order sheet carrying an approval badge. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="OrderPilot">
      <defs>
        <linearGradient id={`${id}bg`} x1="2" y1="1" x2="30" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4c9bff" />
          <stop offset="1" stopColor="#1d3fa8" />
        </linearGradient>
        <linearGradient id={`${id}ok`} x1="17" y1="17" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill={`url(#${id}bg)`} />
      <path d="M9.6 6.2h7.9l4.6 4.6v10.6a2.2 2.2 0 0 1-2.2 2.2H9.6a2.2 2.2 0 0 1-2.2-2.2V8.4a2.2 2.2 0 0 1 2.2-2.2Z" fill="#fff" />
      <path d="M17.5 6.2v3.5a1.1 1.1 0 0 0 1.1 1.1h3.5" fill="#c9dcfb" />
      <rect x="10.2" y="12.4" width="7.4" height="1.7" rx=".85" fill="#9cbcf0" />
      <rect x="10.2" y="15.8" width="9.2" height="1.7" rx=".85" fill="#9cbcf0" />
      <rect x="10.2" y="19.2" width="5" height="1.7" rx=".85" fill="#9cbcf0" />
      <circle cx="22.6" cy="22.6" r="6.4" fill={`url(#${id}ok)`} stroke="#1d3fa8" strokeWidth="1.6" />
      <path d="m19.8 22.7 1.9 1.9 3.6-3.9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Wordmark({ dark = true }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={34} />
      <span className="leading-tight">
        <span className={`block text-[15px] font-semibold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>
          Order<span className={dark ? 'text-[#7fb3ff]' : 'text-brand-600'}>Pilot</span>
        </span>
        <span className={`block text-[11px] ${dark ? 'text-side-muted' : 'text-slate-500'}`}>PO → Sales Order agent</span>
      </span>
    </span>
  )
}
