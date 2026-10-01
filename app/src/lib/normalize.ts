// ---------------------------------------------------------------------------
// Text normalisation for messy textile PO descriptions.
// Handles: trade abbreviations, colour synonyms, GSM / width / ratio tokens,
// OCR damage signals, quantities, UOMs and price strings.
// ---------------------------------------------------------------------------
import type { Uom } from './types'

export const COLOURS = [
  'White', 'Off White', 'Cream', 'Ecru', 'Greige RFD', 'Black', 'Navy Blue', 'Royal Blue',
  'Sky Blue', 'Firozi', 'Teal', 'Grey Melange', 'Charcoal', 'Silver Grey', 'Beige', 'Camel',
  'Coffee Brown', 'Olive', 'Bottle Green', 'Mint', 'Sea Green', 'Maroon', 'Wine', 'Rust',
  'Mustard', 'Peach', 'Baby Pink', 'Lavender',
]

/** phrase (lower-case) -> canonical colour. Longest phrases are matched first. */
const COLOUR_PHRASES: Record<string, string> = {}
for (const c of COLOURS) COLOUR_PHRASES[c.toLowerCase()] = c
Object.assign(COLOUR_PHRASES, {
  'navy': 'Navy Blue', 'n.blue': 'Navy Blue', 'n. blue': 'Navy Blue', 'nevy blue': 'Navy Blue', 'dark blue': 'Navy Blue',
  'off-white': 'Off White', 'offwhite': 'Off White', 'ow': 'Off White', 'o/w': 'Off White',
  'melange grey': 'Grey Melange', 'mel. grey': 'Grey Melange', 'mel grey': 'Grey Melange', 'gray melange': 'Grey Melange', 'grey mel': 'Grey Melange',
  'rfd': 'Greige RFD', 'greige': 'Greige RFD', 'grey fabric (rfd)': 'Greige RFD',
  'ferozi': 'Firozi', 'turquoise': 'Firozi', 'firozee': 'Firozi',
  'b. green': 'Bottle Green', 'b.green': 'Bottle Green', 'dark green': 'Bottle Green', 'btl grn': 'Bottle Green',
  's. blue': 'Sky Blue', 's.blue': 'Sky Blue', 'light blue': 'Sky Blue',
  'r.blue': 'Royal Blue', 'r. blue': 'Royal Blue',
  'coffee': 'Coffee Brown', 'brown coffee': 'Coffee Brown',
  'lt pink': 'Baby Pink', 'light pink': 'Baby Pink', 'b.pink': 'Baby Pink', 'b. pink': 'Baby Pink',
  'charcoal grey': 'Charcoal', 'dark grey': 'Charcoal', 'charcl': 'Charcoal',
  'silver': 'Silver Grey', 'lt grey': 'Silver Grey', 'sil grey': 'Silver Grey',
  'marun': 'Maroon', 'dark maroon': 'Maroon',
  'musturd': 'Mustard', 'haldi': 'Mustard',
  'sea grn': 'Sea Green',
})
const COLOUR_KEYS = Object.keys(COLOUR_PHRASES).sort((a, b) => b.length - a.length)

/** Token-level trade abbreviations (reverse of the generator's ABBREV list). */
const ABBREV: Record<string, string[]> = {
  ctn: ['cotton'], cmbd: ['combed'], ply: ['poly'], polyester: ['poly'], vis: ['viscose'],
  viscos: ['viscose'], mel: ['melange'], shrt: ['shirting'], btm: ['bottomweight'], jsy: ['jersey'],
  intlk: ['interlock'], prt: ['printed'], cord: ['corduroy'], uph: ['upholstery'], curt: ['curtain'],
  lyc: ['lycra'], dnm: ['denim'], lin: ['linen'], mdl: ['modal'], lyo: ['lyocell'],
  pc: ['poly', 'cotton'], pv: ['poly', 'viscose'], gtte: ['georgette'], sattin: ['satin'],
  loopknit: ['loop', 'knit'], tencel: ['lyocell'], kgs: [], spandex: ['spandex'],
}

/** Family-level trade jargon — tells you the family but nothing more. */
export const FAMILY_JARGON: Record<string, string> = {
  'shirting cloth': 'Cotton Shirting', 'shirting fabric': 'Cotton Shirting', 'shirt material': 'Cotton Shirting',
  'bottom fabric': 'Cotton Bottomweight', 'trouser cloth': 'Cotton Bottomweight', 'pant material': 'Cotton Bottomweight',
  'pc shirting': 'Poly Cotton Shirting', 'blended shirting cloth': 'Poly Cotton Shirting',
  'rayon cloth': 'Viscose Rayon', 'viscos fabric': 'Viscose Rayon',
  'georgette material': 'Polyester Georgette', 'gtte fabric': 'Polyester Georgette',
  'denim cloth': 'Denim', 'jeans fabric': 'Denim',
  'linen cloth': 'Linen and Blends', 'linen material': 'Linen and Blends',
  'modal fabric': 'Modal and Lyocell', 'tencel type fabric': 'Modal and Lyocell',
  'suiting cloth': 'PV Suiting', 'uniform suiting': 'PV Suiting', 'pv cloth': 'PV Suiting',
  'satin cloth': 'Satin and Sateen', 'sattin fabric': 'Satin and Sateen',
  'sj knit': 'Single Jersey Knit', 'jersey knit fabric': 'Single Jersey Knit', 't-shirt knit': 'Single Jersey Knit',
  'rib fabric': 'Interlock and Rib Knit', 'interlock knit': 'Interlock and Rib Knit',
  'fleece cloth': 'Fleece and Loop Knit', 'loopknit fabric': 'Fleece and Loop Knit',
  'cord fabric': 'Corduroy and Velvet', 'velvet cloth': 'Corduroy and Velvet',
  'flannel cloth': 'Flannel and Winterwear', 'winter fabric': 'Flannel and Winterwear',
  'rubia cloth': 'Rubia and Lining', 'lining material': 'Rubia and Lining', 'astar cloth': 'Rubia and Lining',
  'print base': 'Print Base Fabric', 'printing cloth': 'Print Base Fabric',
  'curtain cloth': 'Curtain Fabric', 'casement fabric': 'Curtain Fabric',
  'sofa fabric': 'Upholstery Fabric', 'upholstery cloth': 'Upholstery Fabric',
  'bedsheet cloth': 'Bedsheet and Sheeting', 'sheeting fabric': 'Bedsheet and Sheeting',
  'terry towel pcs': 'Terry Towel', 'towel': 'Terry Towel',
  'canvas cloth': 'Canvas and Industrial', 'duck fabric': 'Canvas and Industrial',
}
const JARGON_KEYS = Object.keys(FAMILY_JARGON).sort((a, b) => b.length - a.length)

/** Materials we know we do NOT stock — any SKU proposed for these is a hallucination. */
export const NON_CATALOGUE_TERMS = [
  'hemp', 'bamboo', 'wool felt', 'felt', 'cupro', 'neoprene', 'scuba', 'kevlar', 'silk', 'organza',
  'leatherette', 'pu coated', 'nylon', 'ripstop', 'merino', 'jute', 'hessian', 'recycled pet', 'grs certified',
]

export const STOPWORDS = new Set([
  'fabric', 'cloth', 'material', 'quality', 'regular', 'medium', 'normal', 'one', 'usual', 'inch',
  'inches', 'in', 'gsm', 'item', 'as', 'per', 'our', 'code', 'same', 'last', 'time', 'the', 'of',
  'and', 'for', 'with', 'to', 'approx', 'type', 'pcs', 'width', 'colour', 'color', 'w', 'x', 'g',
  'm2', 'gm', 'your', 'note', 'mtr', 'mtrs', 'kg', 'nos', 'sample', 'given', 'order', 'repeat',
  'previous', 'discussed', 'qty', 'rate', 'please', 'supply', 'illegible', 'a', 'is', 'on',
])

const MALFORMED_PHRASES = [
  'same as last order', 'as per sample given', 'usual material', 'as discussed', 'repeat of previous',
  'same as last', 'as per sample', 'repeat order',
]

export interface ParsedDescription {
  raw: string
  lower: string
  gsm: number | null
  width: number | null
  ratios: string[]
  colours: string[]
  /** true when the colour was recovered by fuzzy matching a misspelling (less trustworthy) */
  colourFuzzy: boolean
  jargonFamily: string | null
  jargonPhrase: string | null
  customerCodes: string[]
  tokens: string[]           // content tokens after expansion
  corrected: { from: string; to: string }[]
  ocrSignals: string[]
  nonCatalogue: string[]
  malformed: boolean
}

export function levenshtein(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]
    prev[0] = i
    let rowMin = prev[0]
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = tmp
      if (prev[j] < rowMin) rowMin = prev[j]
    }
    if (rowMin > max) return max + 1
  }
  return prev[b.length]
}

/** Damerau-style: treat a single adjacent transposition as distance 1. */
function editDistance(a: string, b: string, max = 2): number {
  const d = levenshtein(a, b, max)
  if (d === 2 && a.length === b.length) {
    const diff: number[] = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
    if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return 1
  }
  return d
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseRegex(p: string) {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(p)}(?=$|[^a-z0-9])`, 'i')
}
const COLOUR_RES = COLOUR_KEYS.map((k) => [k, phraseRegex(k)] as const)
const JARGON_RES = JARGON_KEYS.map((k) => [k, phraseRegex(k)] as const)

const GSM_RES = [
  /(\d{2,3})\s*(?:g\s*\/\s*m2|gsm|sgm|gms|gsn|gm|g\.s\.m)(?![a-z])/i,
  /\bgsm\s*[:-]?\s*(\d{2,3})\b/i,
]
const WIDTH_RES = [
  /\bw-(\d{2,3})\b/i,
  /(\d{2,3})\s*(?:"|''|inches|inch|in\b|')/i,
]

export function parseGsm(s: string): number | null {
  for (const re of GSM_RES) {
    const m = s.match(re)
    if (m) return Number(m[1])
  }
  return null
}

export function parseWidth(s: string): number | null {
  for (const re of WIDTH_RES) {
    const m = s.match(re)
    if (m) return Number(m[1])
  }
  return null
}

/** Canonicalise a colour string (column value or phrase), tolerant of typos. */
export function canonicalColour(s: string): string | null {
  const t = s.trim().toLowerCase()
  if (!t) return null
  if (COLOUR_PHRASES[t]) return COLOUR_PHRASES[t]
  let best: string | null = null
  let bestD = 99
  for (const k of COLOUR_KEYS) {
    if (k.length < 4) continue
    const d = editDistance(t, k, 2)
    const allowed = k.length >= 8 ? 2 : 1
    if (d <= allowed && d < bestD) {
      bestD = d
      best = COLOUR_PHRASES[k]
    }
  }
  if (best) return best
  for (const [k, re] of COLOUR_RES) if (k.length > 2 && re.test(t)) return COLOUR_PHRASES[k]
  return null
}

export function detectOcrSignals(s: string): string[] {
  const sig: string[] = []
  if (/###|~~|\(illegible\)|\.\.\.\.|\s\|\s*$/.test(s)) sig.push('scan artefact marker')
  const words = s.split(/[\s,/-]+/).filter(Boolean)
  for (const w of words) {
    if (/^[a-z]{3}$/i.test(w) || /^\d+%?$/.test(w)) continue
    // OCR swaps LETTERS for look-alike DIGITS (O→0, l→1, S→5, B→8, G→6); typists garble letters.
    const unitTail = (t: string) => /^(g+s*m*|s+m+|g+m+s?|gs+m+|gms|sgm|i+n*|n+i+|in+ch(es)?|inhces|inches|on|im|m|mtrs?|kgs?|yds|pcs|wale|x)$/i.test(t)
    const m = w.match(/^([a-z]?)(\d+)([a-z]*)$/i)
    if (m && (m[3] === '' || unitTail(m[3]))) continue // "58in", "n58in", "295GS", "160gs" are typos, not OCR
    if (/[a-z][015680]{1,2}[a-z]/i.test(w) && !/\d{3}/.test(w)) sig.push(`digit inside word "${w}"`)
    else if (/^[a-z]{3,}[01]{1,2}$/i.test(w)) sig.push(`digit for letter "${w}"`)
    else if (/^[015680]{1,2}[a-z]+$/i.test(w) && !unitTail(w.replace(/^\d+/, ''))) sig.push(`digit for letter "${w}"`)
    else if (/\d(6sm|g5m|65m)\b|^(6sm|g5m|65m)$/i.test(w)) sig.push(`damaged GSM "${w}"`)
    else if (/\w\?\w|\w\?$/.test(w)) sig.push(`unreadable glyph "${w}"`)
  }
  return sig
}

/** OCR confuses t/f and rn/m — typists don't. Corrections of that shape point to a scan. */
export function ocrLikeCorrections(c: { from: string; to: string }[]) {
  return c.filter(({ from, to }) => from.length === to.length && [...from].every((ch, i) => ch === to[i] || (ch === 'f' && to[i] === 't')) && from !== to)
}

let VOCAB: Set<string> = new Set()
let VOCAB_LIST: string[] = []
export function setVocabulary(words: Iterable<string>) {
  VOCAB = new Set(words)
  for (const w of STOPWORDS) VOCAB.add(w)
  for (const k of Object.keys(ABBREV)) VOCAB.add(k)
  for (const j of JARGON_KEYS) for (const w of j.split(/\s+/)) VOCAB.add(w)
  VOCAB_LIST = [...VOCAB].filter((w) => w.length >= 4)
}

const SHORT_ABBREV = ['ctn', 'ply', 'vis', 'lyo', 'mdl', 'lin', 'dnm', 'lyc', 'mel', 'jsy', 'btm', 'prt', 'uph', 'pc', 'pv']
function correctToken(t: string): string {
  if (VOCAB.has(t) || /\d/.test(t)) return t
  const ocrFix = t.replace(/f/g, 't')
  if (ocrFix !== t && VOCAB.has(ocrFix)) return ocrFix
  if (t.length === 3) {
    const hits = SHORT_ABBREV.filter((a) => a.length === 3 && editDistance(t, a, 1) <= 1)
    return hits.length === 1 ? hits[0] : t
  }
  if (t.length < 4) return t
  let best = t
  let bestD = 99
  const allowed = t.length >= 7 ? 2 : 1
  for (const v of VOCAB_LIST) {
    if (Math.abs(v.length - t.length) > allowed) continue
    const d = editDistance(t, v, allowed)
    if (d <= allowed && d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

/** Turn a quality description into canonical content tokens (shared by catalogue + POs). */
export function qualityTokens(s: string): string[] {
  let x = s.toLowerCase()
  x = x.replace(/(\d+)\s+wale/g, '$1wale').replace(/(\d)\s*x\s*(\d)/g, '$1x$2')
  x = x.replace(/p\/w/g, 'poly wool')
  x = x.replace(/\b(\d{2,3})\s*\/\s*(\d{1,2})\b/g, ' r$1_$2 ')
  x = x.replace(/100\s*%/g, ' r100 ')
  x = x.replace(/[^a-z0-9_]+/g, ' ')
  const out: string[] = []
  for (const t of x.split(/\s+/)) {
    if (!t) continue
    if (/^\d+$/.test(t)) continue
    if (ABBREV[t]) out.push(...ABBREV[t])
    else out.push(t)
  }
  return out
}

export function parseDescription(desc: string): ParsedDescription {
  const raw = desc ?? ''
  let lower = ' ' + raw.toLowerCase().replace(/\s+/g, ' ') + ' '
  const ocrSignals = detectOcrSignals(raw)

  const customerCodes = [...raw.matchAll(/\b[A-Z]{3}-\d{4}\b/g)].map((m) => m[0])
  for (const c of customerCodes) lower = lower.replace(c.toLowerCase(), ' ')
  lower = lower.replace(/\(your code:\s*\)/, ' ')

  const gsm = parseGsm(lower)
  const width = parseWidth(lower.replace(/\b\d{2,3}\s*(?:gsm|gm|g\/m2)\b/g, ' '))
  const ratios = [...lower.matchAll(/\b(\d{2,3})\s*\/\s*(\d{1,2})\b/g)].map((m) => `${m[1]}/${m[2]}`)

  // strip numeric attribute tokens so they don't pollute matching
  let work = lower
    .replace(/(\d{2,3})\s*(?:g\s*\/\s*m2|gsm|sgm|gms|gsn|gm)(?![a-z])/gi, ' ')
    .replace(/\bgsm\s*[:-]?\s*\d{2,3}\b/gi, ' ')
    .replace(/\bw-\d{2,3}\b/gi, ' ')
    .replace(/\b(\d{2,3})\s*(?:"|''|inches|inch|in\b|')/gi, ' ')

  const nonCatalogue = NON_CATALOGUE_TERMS.filter((t) => phraseRegex(t).test(work))

  let jargonFamily: string | null = null
  let jargonPhrase: string | null = null
  for (const [k, re] of JARGON_RES) {
    if (re.test(work)) {
      jargonFamily = FAMILY_JARGON[k]
      jargonPhrase = k
      break
    }
  }

  // colours: phrase match first, removing as we go so "navy blue" isn't also "navy"
  const colours: string[] = []
  for (const [k, re] of COLOUR_RES) {
    if (k === 'ow' && !/(^|[\s,/-])ow([\s,/-]|$)/.test(work)) continue
    const m = work.match(re)
    if (m) {
      const c = COLOUR_PHRASES[k]
      if (!colours.includes(c)) colours.push(c)
      work = work.replace(re, '$1 ')
    }
  }

  // tokens + fuzzy correction against the catalogue vocabulary
  const corrected: { from: string; to: string }[] = []
  const toks: string[] = []
  for (const t of qualityTokens(work)) {
    const c = correctToken(t)
    if (c !== t) corrected.push({ from: t, to: c })
    const expanded = ABBREV[c] ?? [c]
    for (const e of expanded) if (!STOPWORDS.has(e)) toks.push(e)
  }

  // a typo'd colour can survive phrase matching — try bigrams/unigrams that are not vocab words
  let colourFuzzy = false
  if (colours.length === 0) {
    const words = work.replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean)
    for (let i = 0; i < words.length && colours.length === 0; i++) {
      const bi = i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : ''
      for (const cand of [bi, words[i]]) {
        if (!cand || cand.length < 4 || VOCAB.has(cand)) continue
        if (cand === words[i] && correctToken(cand) !== cand) continue // a misspelt quality word, not a colour
        if (cand === bi && (VOCAB.has(words[i]) || VOCAB.has(words[i + 1]))) continue
        const c = canonicalColour(cand)
        if (c) {
          colours.push(c)
          colourFuzzy = true
          break
        }
      }
    }
  }

  const contentToks = toks.filter((t) => !STOPWORDS.has(t))
  const malformed =
    MALFORMED_PHRASES.some((p) => lower.includes(p)) && contentToks.length <= 1 && gsm === null
      ? true
      : raw.trim().length <= 2 || (contentToks.length === 0 && gsm === null && !jargonFamily && colours.length === 0)

  return {
    raw, lower: lower.trim(), gsm, width, ratios, colours, colourFuzzy, jargonFamily, jargonPhrase, customerCodes,
    tokens: contentToks, corrected, ocrSignals: [...ocrSignals, ...ocrLikeCorrections(corrected).map((c) => `OCR-style misread "${c.from}"`)], nonCatalogue, malformed,
  }
}

// ---------------------------------------------------------------------------
// Quantity / UOM / price
// ---------------------------------------------------------------------------
export interface ParsedQty { value: number | null; approx: boolean; raw: string }
export function parseQuantity(s: string): ParsedQty {
  const raw = (s ?? '').trim()
  const approx = /approx|~|about|around/i.test(raw)
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return { value: null, approx, raw }
  const v = Number(m[0])
  return { value: Number.isFinite(v) && v > 0 ? v : null, approx, raw }
}

export type UomNorm = Uom | 'YDS' | 'ROLLS' | 'BALES' | 'THAAN' | 'UNKNOWN'
export function normaliseUom(s: string): UomNorm | null {
  const t = (s ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!t) return null
  if (/^(m|mt|mts|mtr|mtrs|meter|meters|metre|metres)$/.test(t)) return 'MTR'
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(t)) return 'KG'
  if (/^(pc|pcs|piece|pieces|nos|no|units?)$/.test(t)) return 'PCS'
  if (/^(yd|yds|yard|yards)$/.test(t)) return 'YDS'
  if (/^rolls?$/.test(t)) return 'ROLLS'
  if (/^bales?$/.test(t)) return 'BALES'
  if (/^thaans?$/.test(t)) return 'THAAN'
  return 'UNKNOWN'
}

export function parsePrice(s: string): number | null {
  const raw = (s ?? '').replace(/,/g, '')
  const m = raw.match(/\d+(?:\.\d+)?/)
  if (!m) return null
  const v = Number(m[0])
  return Number.isFinite(v) && v > 0 ? v : null
}

export const YARDS_PER_METRE = 1.09361
