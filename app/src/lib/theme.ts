import { useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'po2so.theme'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readTheme)
  useEffect(() => {
    applyTheme(pref)
    try {
      localStorage.setItem(KEY, pref)
    } catch { /* storage unavailable */ }
    const m = media()
    const onChange = () => pref === 'system' && applyTheme('system')
    m.addEventListener('change', onChange)
    // documents always print on white paper
    const before = () => document.documentElement.classList.remove('dark')
    const after = () => applyTheme(pref)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      m.removeEventListener('change', onChange)
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [pref])
  return [pref, setPref]
}
