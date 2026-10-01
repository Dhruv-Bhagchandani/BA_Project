// ---------------------------------------------------------------------------
// Stage 1 — document extraction with Claude, called straight from the browser.
//
// There is no backend: the user's own API key (entered in Settings, kept in this
// browser's localStorage) is sent directly to api.anthropic.com. Claude only
// TRANSCRIBES the document; every matching / pricing / approval decision is
// made by the deterministic agent in engine.ts so it stays auditable.
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default, most accurate)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
]

const LineSchema = z.object({
  line_no: z.number().describe('Line / serial number as printed, or the order of appearance'),
  customer_item_description: z.string().describe('Item description VERBATIM. Remove only text you moved into another field (colour, GSM, width, item code, remarks).'),
  customer_item_code: z.string().describe("Buyer's own item code (e.g. 'MEG-8299', 'Your Code: KAV-2334' -> 'KAV-2334'), else empty"),
  colour_text: z.string().describe('Colour exactly as written in a colour column or a "Colour:" label, else empty'),
  gsm_text: z.string().describe('GSM exactly as written in a GSM column or "GSM:" label, else empty'),
  width_text: z.string().describe('Width exactly as written in a width column or "Width:" label, else empty'),
  quantity_text: z.string().describe('Quantity exactly as written incl. "approx", "~", "TBC", "-", "?" — empty if absent. NEVER invent one.'),
  uom_text: z.string().describe('Unit exactly as written: MTR, Mtrs, mts, M, Meters, KGS, Kilo, YDS, PCS, NOS, Thaan, Bales ...'),
  unit_price_text: z.string().describe('Rate exactly as written incl. "Rs.", "INR", "/mtr", "per unit" — empty if absent'),
  line_remarks: z.string().describe('Line-level remarks / notes / REMARKS: rows, verbatim, else empty'),
  requested_delivery_date: z.string().describe('Line delivery date if printed (YYYY-MM-DD), else empty'),
  legibility: z.enum(['clear', 'uncertain', 'illegible']).describe('How confidently every character of this line could be read'),
})

const ExtractionSchema = z.object({
  po_number: z.string(),
  po_date: z.string().describe('YYYY-MM-DD'),
  customer_name: z.string().describe('Buyer company name (the party SENDING the PO, not the supplier)'),
  customer_city: z.string(),
  ship_to_city: z.string(),
  delivery_date: z.string().describe('YYYY-MM-DD or empty'),
  payment_terms_days: z.string().describe('Number of days as written, or empty'),
  currency: z.string(),
  printed_total: z.string().describe('Order total exactly as printed, or empty if none is printed'),
  document_notes: z.string().describe('Anything a reviewer should know: blur, skew, handwriting, annexure pages skipped, fields cut off'),
  lines: z.array(LineSchema),
})

export type ClaudeExtraction = z.infer<typeof ExtractionSchema>

const SYSTEM = `You transcribe customer purchase orders for a B2B textile distributor.
You are the extraction stage only: a separate rules engine will match products and validate prices, so your job is to report exactly what is printed.

Rules:
- Transcribe verbatim. Never correct spelling, expand abbreviations, convert units, normalise prices or fill blanks. "800 approx", "Rs. 236.22", "TBC", "Kilo" stay as written.
- A blank or non-numeric quantity must stay blank/as written. Never infer a quantity.
- Some layouts print rate BEFORE quantity — read the column headers.
- Colour / GSM / width embedded in the description as labelled sub-lines (e.g. "Colour: Navy | GSM: 160") go into their own fields and are removed from the description. Unlabelled attributes inside the description stay in the description.
- Item codes such as "(Your Code: KAV-2334)" go into customer_item_code. "REMARKS:"/"Note:" text goes into line_remarks.
- Ignore terms & conditions / annexure pages — they contain no line items. Line items can continue onto a second page.
- If characters are unreadable, transcribe your best reading and mark legibility "uncertain" or "illegible". Do not guess silently.`

export async function extractWithClaude(opts: {
  apiKey: string
  model: string
  file?: { base64: string; mediaType: string }
  text?: string
}): Promise<{ data: ClaudeExtraction; model: string; usage: { input: number; output: number } }> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true })
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (opts.file) {
    if (opts.file.mediaType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.file.base64 } })
    } else {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: opts.file.mediaType as 'image/png' | 'image/jpeg', data: opts.file.base64 },
      })
    }
  }
  content.push({
    type: 'text',
    text: opts.text
      ? `Extract the purchase order from this text (e.g. an email body):\n\n${opts.text}`
      : 'Extract the purchase order header and every line item from this document.',
  })

  const response = await client.beta.messages.parse({
    model: opts.model,
    max_tokens: 16000,
    system: SYSTEM,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: betaZodOutputFormat(ExtractionSchema), effort: 'medium' },
    messages: [{ role: 'user', content }],
  })
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this document.')
  if (!response.parsed_output) throw new Error(`Claude returned no structured output (stop_reason: ${response.stop_reason}).`)
  return {
    data: response.parsed_output,
    model: response.model,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  }
}
