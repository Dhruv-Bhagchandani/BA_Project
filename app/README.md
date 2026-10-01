# OrderPilot: PO → Sales Order agent

An AI agent that turns messy customer purchase orders (PDFs, scans, phone photos, emails) into validated sales orders for a B2B textile distributor. Lines that are safe are approved automatically. Lines that are not get a specific reason and go to a human.

The app is **frontend-only**: a static React site with no backend, no server and no database. It deploys to Vercel as-is.

> All data is synthetic (see `../files/DATASET_DOCUMENTATION.md`). No real customers, prices or companies.

---

## What you can demo

| Page | What it shows |
|---|---|
| **Dashboard** | Line and order straight-through rates, false auto-approval rate, value auto-booked, weekly outcomes, exceptions, automation by channel |
| **Process a PO** | Upload a PDF, scan or photo, pick one of 33 sample documents, pick an inbox PO, or paste an email. You see extraction, then an editable check of the extracted lines, then the agent run as a 6-stage pipeline |
| **PO detail** | Per line: what the agent read, the catalogue match and alternatives, the price check against the customer's own price history (chart), a step-by-step reasoning trace, the decision, and an optional **ground-truth comparison** |
| **Review queue** | Held lines grouped by the judgement they need (match, price, clarify, manual, duplicate, UOM, quantity). Approve (choose the SKU, qty and price), reject, or ask the customer. Approving a customer-coded line **teaches** the agent that code |
| **Sales orders** | One SO per PO: auto lines, flagged lines and reviewer-approved lines, with GST, HSN and totals. Print to PDF, or export CSV or ERP-style JSON |
| **Evaluation** | The dataset's full evaluation protocol: SKU accuracy, candidate recall, exception accuracy and recall, **false auto-approval** and **hallucination** (the safety metrics), STP at line and order level, sliced by difficulty and scenario, plus an action confusion matrix and the confidence-threshold trade-off. Live stage-1 extraction scoring when Claude is used |
| **Catalogue / Customers** | 750 SKUs grouped by quality group (why "no colour" means ambiguity); customer profiles with buying portfolio and price-history charts |
| **How it works** | Architecture, the 20-rung decision ladder, tolerance bands, and the safety rules |
| **Settings** | Claude API key and model, reviewer name, editable agent policy (tolerances, thresholds; re-runs all 1,000 POs), demo reset |

Agent results on the **test split** (199 POs, 1,000 lines):

- False auto-approval: 0.2%
- Hallucination: 0%
- Exception accuracy: 99.7%
- Line straight-through: 58.9% (ceiling 62.2%)
- SKU accuracy: 100%

These numbers are optimistic. The normalisation rules were written knowing how the synthetic data was generated, and the Evaluation page says so.

---

## Architecture

```
Browser (everything runs here)
├── /data/*.parquet   ~1.3 MB of master data, history, POs and labels  →  read with hyparquet
├── Stage 1: extraction
│   ├── Claude (your API key, called directly from the browser, structured JSON output)
│   └── Built-in: pdf.js text layer / tesseract.js OCR → identify the PO → benchmark lines
├── Stage 2: agent (src/lib/engine.ts) — deterministic and auditable
│   normalise → match quality group → colour within group → UOM / qty / price / duplicate
│   checks → 20-rung precedence ladder → exception + action → SO line
├── Evaluation (src/lib/evaluate.ts) — joins hidden labels only for scoring
└── localStorage — review decisions, learned customer codes, uploads, settings
```

**Why there is no backend.** The agent is pure TypeScript and processes all 1,000 POs in about 0.5 s in the browser. The data is static Parquet. The only external call is optional document extraction with Claude, which the browser makes directly to `api.anthropic.com` using the user's own key. There is nothing to host.

---

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
npm run eval -- test # headless evaluation of the agent (train | validation | test | all)
```

Regenerate the Parquet files and samples from the CSVs (only needed if the dataset changes; the output is already committed in `public/`):

```bash
pip install pandas pyarrow pypdfium2 pillow
npm run data         # reads ../files and "../files (2)" (incl. po_documents.zip)
```

## Deploy to Vercel (frontend only)

1. Push the project to GitHub, GitLab or Bitbucket. Alternatively, run `npx vercel` inside `app/`.
2. In Vercel, choose **New Project → import the repo**. If the repo root is the parent folder, set **Root Directory = `app`**.
3. The framework is auto-detected as **Vite**. Build command `npm run build`, output `dist` (already set in `vercel.json`).
4. Deploy. No environment variables are required.

`vercel.json` rewrites client-side routes to `index.html` (so `/po/PO00002` deep links work) and sets cache headers for `/data` and `/assets`.

### Environment variables (all optional)

| Variable | Purpose |
|---|---|
| `VITE_ANTHROPIC_API_KEY` | Pre-fills the Claude key. ⚠️ `VITE_` variables are **baked into the public JS bundle**. Use only for private demos with a spend-limited key. Prefer entering the key in **Settings** at runtime (stored only in that browser). |
| `VITE_CLAUDE_MODEL` | Default extraction model: `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-4-5` |

### Claude extraction details

`src/lib/claude.ts` uses the official `@anthropic-ai/sdk` with these settings:

- `dangerouslyAllowBrowser: true` (the user's own key goes straight to Anthropic).
- `client.beta.messages.parse` with a Zod schema, so the response always fits the PO line schema.
- PDFs are sent as `document` blocks and images as `image` blocks.
- Server-side refusal fallbacks are enabled (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).

Claude only **transcribes**. It is told never to fix typos, convert units or invent quantities. Every commercial decision stays in the deterministic engine.

---

## Project layout

```
src/lib/engine.ts      the agent: matching, validation, decision ladder, SO lines
src/lib/normalize.ts   abbreviations, colour synonyms, OCR-damage detection, qty/UOM/price parsing
src/lib/evaluate.ts    §10 evaluation protocol + threshold sweep + confusion matrix
src/lib/claude.ts      Claude document extraction (browser)
src/lib/docExtract.ts  pdf.js / tesseract.js built-in extraction + document register lookup
src/lib/salesOrder.ts  SO assembly from agent results + review decisions
src/lib/store.tsx      app state (Parquet load, inbox processing, localStorage)
src/pages/*            UI
scripts/build_data.py  CSV → Parquet + sample documents + thumbnails
scripts/eval.ts        headless evaluation
```
