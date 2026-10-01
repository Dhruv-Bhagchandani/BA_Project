// ---------------------------------------------------------------------------
// Built-in document helpers (no API key needed):
//  - pdf.js reads the text layer of native-digital PDFs
//  - tesseract.js OCRs images and image-only (scanned) PDFs, in the browser
// With built-in extraction we use the recovered text to identify the PO number and
// look the order up in the benchmark (whose extracted lines are the oracle
// "perfect extractor" output). With a Claude key, Claude does real extraction.
// ---------------------------------------------------------------------------
import type { ClaudeExtraction } from './claude'
import type { Dataset } from './data'
import type { POInput, POLineInput } from './types'

export async function fileToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk))
  return btoa(bin)
}

async function pdfjs() {
  const lib = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib
}

export async function pdfText(blob: Blob): Promise<{ text: string; pages: number }> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    text += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
  }
  return { text, pages: doc.numPages }
}

export async function renderPdfPage(blob: Blob, pageNo = 1, scale = 2.2): Promise<HTMLCanvasElement> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  const page = await doc.getPage(pageNo)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
  return canvas
}

export async function ocr(image: HTMLCanvasElement | Blob, onProgress?: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress)
    },
  })
  try {
    const { data } = await worker.recognize(image)
    return data.text
  } finally {
    await worker.terminate()
  }
}

/** PO numbers look like MEG/PO/2026-06/7044 — tolerant of OCR spacing and O/0 swaps. */
export function findPoNumbers(text: string): string[] {
  const out: string[] = []
  const re = /([A-Z]{3})\s*\/\s*P\s*[O0]\s*\/\s*(\d{4})\s*-\s*(\d{2})\s*\/\s*(\d{2,5})/gi
  for (const m of text.matchAll(re)) out.push(`${m[1].toUpperCase()}/PO/${m[2]}-${m[3]}/${m[4]}`)
  return [...new Set(out)]
}

export function benchmarkLookup(data: Dataset, poNumber: string): POInput | null {
  const header = data.headers.find((h) => h.po_number === poNumber)
  if (!header) return null
  return { header: { ...header }, lines: (data.linesByPo.get(header.po_id) ?? []).map((l) => ({ ...l })), source: 'upload' }
}

/**
 * When the PO number itself is unreadable (blurry phone photos), identify the
 * order from other printed evidence: buyer name, PO date, serial digits and
 * how many of the order's line descriptions can be recognised in the OCR text.
 */
export function fuzzyIdentify(data: Dataset, text: string): { poNumber: string; evidence: string[] } | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const words = new Set(t.split(/[^a-z0-9/%]+/).filter((w) => w.length >= 4))
  const digits = new Set(t.match(/\d{3,5}/g) ?? [])
  const custName = new Map(data.customers.map((c) => [c.customer_id, c.customer_name.toLowerCase()]))
  const scored: { poNumber: string; evidence: string[]; score: number }[] = []
  for (const h of data.headers) {
    const ev: string[] = []
    let score = 0
    const name = custName.get(h.customer_id) ?? ''
    const first = name.split(' ')[0]
    if (name && t.includes(name)) { ev.push(`buyer "${name}"`); score += 2 }
    else if (first.length > 3 && t.includes(first)) { ev.push(`buyer "${first}"`); score += 1 }
    if (score === 0) continue
    const day = h.po_date.slice(8)
    if (t.includes(h.po_date)) { ev.push(`date ${h.po_date}`); score += 1 }
    else if (new RegExp(`(^|[^0-9])${day}([^0-9]|$)`).test(t) && t.includes(h.po_date.slice(0, 6))) { ev.push(`date fragment …-${day}`); score += 0.5 }
    const serial = h.po_number.split('/').pop() ?? ''
    if (serial.length >= 3 && digits.has(serial)) { ev.push(`serial ${serial}`); score += 1 }
    // continuous evidence: share of each line's description words visible in the (noisy) OCR text
    const lines = data.linesByPo.get(h.po_id) ?? []
    let frac = 0
    for (const l of lines) {
      const toks = [...new Set(`${l.customer_item_description} ${l.colour_text}`.toLowerCase().split(/[^a-z0-9/%]+/).filter((w) => w.length >= 4))]
      if (toks.length) frac += toks.filter((w) => words.has(w)).length / toks.length
    }
    const avg = lines.length ? frac / lines.length : 0
    if (avg > 0) { ev.push(`${Math.round(avg * 100)}% of line wording recognised`); score += 3 * avg }
    scored.push({ poNumber: h.po_number, evidence: ev, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const [best, second] = scored
  return best && best.score >= 2.8 && best.score - (second?.score ?? 0) >= 0.4 ? { poNumber: best.poNumber, evidence: best.evidence } : null
}

export function emptyLine(n: number): POLineInput {
  return {
    po_line_id: '', po_id: '', line_no: n, customer_item_description: '', customer_item_code: '', colour_text: '',
    gsm_text: '', width_text: '', quantity_text: '', uom_text: 'MTR', unit_price_text: '', line_remarks: '',
    requested_delivery_date: '',
  }
}

export function fromClaude(x: ClaudeExtraction, data: Dataset): POInput {
  const cust = data.customers.find((c) => c.customer_name.toLowerCase() === x.customer_name.trim().toLowerCase())
  // if this is a benchmark document, remember which dataset lines it corresponds to (for scoring only)
  const known = data.headers.find((h) => h.po_number === x.po_number.trim())
  const refLines = known ? data.linesByPo.get(known.po_id) ?? [] : []
  return {
    header: {
      po_id: '', po_number: x.po_number, customer_id: cust?.customer_id ?? '', po_date: x.po_date,
      received_channel: 'Upload', document_quality: '', document_language_mix: '', currency: x.currency || 'INR',
      payment_terms_days: x.payment_terms_days, requested_delivery_date: x.delivery_date,
      ship_to_city: x.ship_to_city || x.customer_city, po_line_count: x.lines.length,
    },
    customer_name_text: x.customer_name,
    lines: x.lines.map((l, i) => ({
      po_line_id: '', po_id: '', line_no: l.line_no || i + 1,
      customer_item_description: l.customer_item_description, customer_item_code: l.customer_item_code,
      colour_text: l.colour_text, gsm_text: l.gsm_text, width_text: l.width_text, quantity_text: l.quantity_text,
      uom_text: l.uom_text, unit_price_text: l.unit_price_text, line_remarks: l.line_remarks,
      requested_delivery_date: l.requested_delivery_date || x.delivery_date, legibility: l.legibility,
      ref_line_id: refLines.length === x.lines.length ? refLines[i]?.po_line_id : refLines.find((r) => r.line_no === l.line_no)?.po_line_id,
    })),
    source: 'upload',
  }
}
