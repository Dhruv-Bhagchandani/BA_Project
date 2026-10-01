# Raw-Document Benchmark — PO Extraction Stage
### Companion to the relational dataset · Business Analytics course project

---

## 0. Relationship to the existing dataset

**Nothing in the relational dataset was modified** — verified, not assumed: regenerating the
six CSVs from the original seed produces files with identical MD5 hashes to the ones on disk.
`purchase_orders.csv`,
`purchase_order_lines.csv`, `product_master.csv`, `customer_master.csv`,
`transaction_history.csv`, `sales_order_ground_truth.csv` and `dataset_splits.csv` are
byte-identical to what was delivered earlier; the build script opens them read-only.

This layer renders those same 1,000 purchase orders as **physical documents** — PDFs and
images — so the pipeline can be evaluated in two independent stages:

```
   RAW DOCUMENT  ──stage 1──▶  EXTRACTED FIELDS  ──stage 2──▶  SALES ORDER DECISION
   (this layer)   extraction    (compare against       matching /   (compare against
                                document_extraction_    validation   sales_order_
                                ground_truth.csv)                    ground_truth.csv)
```

Every character on every page comes verbatim from the existing CSVs. The renderer never
corrects a typo, expands an abbreviation, fills a blank quantity or normalises a UOM — so
`purchase_order_lines.csv` remains the single ground truth, and stage-1 accuracy is
measured as *"did the extractor recover exactly what the CSV says was on the page?"*

All content remains **fictional and synthetic**. The receiving supplier is a placeholder
entity, "Textile Distribution Co. (Demo Entity)", invented for this benchmark.

### New files

| File | Rows | Purpose |
|---|---|---|
| `po_documents/` | 1,000 files | The corpus (811 PDF · 164 JPG · 25 PNG), 67 MB |
| `po_documents.zip` | — | The same corpus as a single 57 MB download |
| `document_manifest.csv` | 1,000 | One row per document: layout, quality, format, pages, split |
| `document_extraction_ground_truth.csv` | 4,985 | One row per PO line — exactly what was printed, and where |
| `document_header_ground_truth.csv` | 1,000 | Header fields as printed, plus the printed order total |
| `document_validation_report.txt` | — | Output of the 26 document-layer checks |
| `doc_render.py`, `build_documents.py`, `validate_documents.py` | — | Reproduction scripts (seed `424242`) |

Filename convention: `PO00016__L5_handwritten_slip__q4_phone_photo.jpg` —
`<po_id>__<layout_id>__<quality_id>.<ext>`. The layout and quality are in the filename for
convenience when browsing, and **must not be parsed by the extractor** — treat them the way
you treat `scenario_type` in the relational layer.

---

## 1. Six layouts

Layout is not cosmetic. It changes *where* information lives, and therefore what the
extractor has to do. Two layouts have no amount column and no total, so there is nothing to
cross-check against; three embed colour and GSM inside the description text rather than in
their own columns, so the extractor must decide whether to split them out.

| ID | Layout | Structure | Colour / GSM | Amount & total | n |
|---|---|---|---|---|---:|
| `L1_classic_tabular` | Classic bordered PO on a plain letterhead | 8-column ruled table | own columns | both printed | 324 |
| `L2_exporter_letterhead` | Export-house indent, dark letterhead band | 7 columns, **rate before quantity** | inside description | both printed | 124 |
| `L3_email_body` | Order typed into an email body | no table at all, numbered prose lines | on a detail sub-line | **neither** | 109 |
| `L4_excel_grid` | Spreadsheet printed to PDF | 12 dense columns, 6.2 pt type | own columns | both printed | 211 |
| `L5_handwritten_slip` | Handwritten order-book slip on ruled paper | free-form, no columns | inside the written line | **neither** | 75 |
| `L6_erp_portal_print` | Machine-generated portal print-out | monospaced fixed-width, barcode | own columns | both printed | 157 |

Design details that matter for evaluation:

- **L2 reverses the natural column order** (rate, then quantity). An extractor that assumes
  quantity always precedes rate will silently swap the two on 124 documents — and because
  both are plausible numbers, nothing downstream will catch it except the price check.
- **L3 and L5 print no amount and no total.** For those 184 documents the extractor has no
  arithmetic cross-check available; `total_printed_on_document` in the header ground truth
  tells you which documents offer one.
- **L1 folds the item code, width and line remarks into the description cell**, so a
  "conflicting information" line reads as one blob of text that must be split. L4 gives each
  of those its own column. Same underlying line, very different extraction difficulty.
- **67 documents are multi-page.** 61 carry a **terms-and-conditions annexure** — a full
  page of numbered clauses with no line items — and 8 have line items continuing onto a
  second page (2 documents have both). An extractor that treats every page as a line-item
  table will hallucinate rows from clause text; one that stops at page 1 will lose real
  lines. `has_terms_annexure_page` and `line_items_span_pages` in the manifest let you score
  the two failure modes separately.

---

## 2. Five quality tiers

| ID | Tier | Physical simulation | Format | Text layer | n |
|---|---|---|---|---|---:|
| `q1_clean_digital` | Native digital PDF | none — vector text | `.pdf` | **Yes** | 570 |
| `q2_print_scan` | Printed then scanned, 200 dpi | skew ±0.7°, light blur, low noise, punch holes, staple | `.pdf` (image-only) | No | 120 |
| `q3_poor_scan` | Poor scan, 150 dpi | skew ±2.4°, heavy blur, speckle, contrast loss, uneven light, fold line | `.pdf` (image-only) | No | 121 |
| `q4_phone_photo` | Photographed on a phone | perspective warp, shadow gradient, handheld blur, exposure drift | `.jpg` | No | 164 |
| `q5_fax_bitonal` | Fax / bitonal copy | 1-bit threshold, horizontal streaks, slipped rows | `.png` | No | 25 |

**570 documents can be read with a text extractor; 430 require OCR.** The q2/q3 tiers are
deliberately wrapped as *image-only PDFs* — a `.pdf` extension with no recoverable text
layer. This is the single most common trap in real PO automation: a pipeline that calls
`pdfplumber` on everything ending in `.pdf` returns empty strings for 241 documents and
silently produces zero lines. Check D22 in the validation report confirms all sampled
scanned PDFs return under 20 characters of text.

`degradation_params` in the manifest records the actual skew angle, threshold and effects
applied to each document, so you can regress accuracy against skew magnitude if you want a
finer-grained analysis than the five tiers.

### Coverage matrix (documents)

| | q1 clean | q2 scan | q3 poor scan | q4 photo | q5 fax |
|---|---:|---:|---:|---:|---:|
| L1 classic tabular | 162 | 50 | 46 | 54 | 12 |
| L2 exporter letterhead | 84 | 22 | 13 | 2 | 3 |
| L3 email body | 57 | 11 | 16 | 22 | 3 |
| L4 excel grid | 153 | 24 | 8 | 23 | 3 |
| L5 handwritten slip | 0 | 3 | 26 | 46 | 0 |
| L6 erp portal print | 114 | 10 | 12 | 17 | 4 |

28 of 30 cells are populated. The two empty cells are empty **by construction, not by
accident**: a handwritten slip cannot be a native digital PDF or a clean bitonal fax
original. Several cells are thin (L2×q4 = 2, L4×q5 = 3); report those per-cell numbers with
their sample size, or aggregate them into the tier margin rather than quoting a percentage
from two documents.

### How layout and quality were assigned

From the columns already in `purchase_orders.csv` — `received_channel` and
`document_quality` — so the raw corpus agrees with the relational dataset rather than
contradicting it:

| Source in `purchase_orders.csv` | Renders as |
|---|---|
| `Portal Upload` | L6, clean digital |
| `Email Excel` | L4, clean digital (12% scanned) |
| `Email PDF` | L1/L2/L3/L6, clean digital (14% scanned) |
| `Scanned Copy` | L1/L2/L4/L6/L5, print scan · poor scan · fax |
| `WhatsApp Image` | L1/L5/L3/L4/L6, phone photo (20% poor scan) |
| `document_quality = Poor Scan / Handwritten` | 45% handwritten slip, else any layout at poor-scan/fax/photo quality |

This means the 148 lines carrying the relational `poor_quality_document` scenario really do
sit on visually degraded pages — the two benchmarks corroborate each other instead of
telling different stories.

---

## 3. Ground truth for the extraction stage

### `document_extraction_ground_truth.csv` (4,985 rows, PK `po_line_id`)

| Column | Description |
|---|---|
| `po_line_id`, `po_id` | Keys back to `purchase_order_lines.csv` |
| `document_file`, `layout_id`, `quality_id` | Which document this line appears on |
| `page_no` | Page the line was printed on (1-based) |
| `table_row_index` | Its position in the printed sequence — for evaluating line ordering |
| `printed_description` | **The exact string drawn in the description position**, reported by the renderer itself, not reconstructed afterwards. On L2/L5 this includes the appended `Colour: X \| GSM: Y`; on L1 it includes the item code, width and any note |
| `printed_item_code`, `printed_colour`, `printed_gsm`, `printed_width` | The values as they appear on the page |
| `printed_quantity`, `printed_uom`, `printed_unit_price` | Verbatim from the source CSV, including `"800 approx"`, `"TBC"`, `"Rs. 236.22"`, and blanks |
| `printed_amount` | Line amount, only where the layout has an amount column |
| `printed_remarks` | Line remarks as printed |
| `colour_rendered_in`, `gsm_rendered_in`, `width_rendered_in`, `item_code_rendered_in`, `remarks_rendered_in` | Where each attribute lives on this layout: `column` · `inline_description` · `inline_detail_line` · `labelled_sub_line` · `inline_note` |
| `line_rendered_on_document` | `Y` for all 4,985 rows — no line was lost to page overflow |

The `*_rendered_in` columns are what let you ask the sharper question: *is the extractor
worse at pulling colour out of free text than out of a column?* Same field, same values,
different presentation — and the dataset gives you both.

### `document_header_ground_truth.csv` (1,000 rows, PK `po_id`)

`printed_po_number`, `printed_po_date`, `printed_customer_name`, `printed_customer_city`,
`printed_supplier_name`, `printed_ship_to_city`, `printed_delivery_date`,
`printed_payment_terms_days`, `printed_currency`, `printed_line_count`,
`printed_order_total_inr`, `total_printed_on_document`, `amount_column_present`.

`printed_line_count` is the count an extractor should recover — the basis for line-detection
recall. `printed_order_total_inr` supports a reconciliation check: on the 816 documents that
print a total, a correct extraction should satisfy Σ(qty × rate) = total for the lines whose
quantity and rate both parse.

### `document_manifest.csv` (1,000 rows, PK `po_id`)

`document_file`, `file_format`, `layout_id`, `layout_name`, `quality_id`, `quality_name`,
`has_text_layer`, `requires_ocr`, `render_dpi`, `n_pages`, `n_lines`, `lines_rendered`,
`has_terms_annexure_page`, `line_items_span_pages`, `source_channel`,
`source_document_quality`, `degradation_params`, `file_size_bytes`, `split`.

The `split` column carries the **same train/validation/test assignment** as
`dataset_splits.csv`, so stage-1 and stage-2 results are computed over identical folds and
can be composed without leakage.

---

## 4. Evaluation protocol for the extraction stage

Compute everything **sliced by `layout_id` and `quality_id`**, and report the
`has_text_layer = Y` and `= N` populations separately — mixing them produces a single
average that describes no real operating condition.

### Field-level

| Metric | Definition |
|---|---|
| Field exact-match accuracy | Extracted string equals the `printed_*` value character for character. Compute per field: description, quantity, UOM, unit price, colour, GSM, item code, remarks |
| Description CER | Character error rate (Levenshtein ÷ reference length) against `printed_description`. Exact match is too brittle for OCR tiers; CER shows *how far* off it was |
| Normalised numeric accuracy | Quantity and price parsed to a number and compared with tolerance 0 — tests whether `"1,200"`, `"800 approx"` and `"Rs. 236.22"` were handled |
| Blank fidelity ★ | Where `printed_quantity` is blank or `"TBC"`, did the extractor return blank rather than inventing a number? Measured over the 49 `missing_quantity` lines |

### Line-level and document-level

| Metric | Definition |
|---|---|
| Line detection recall | Lines correctly located ÷ `printed_line_count`. The headline OCR metric |
| Line detection precision | Correct lines ÷ lines returned. Catches hallucinated rows — especially from the 61 T&C annexure pages |
| Line ordering accuracy | Extracted sequence matches `table_row_index` |
| Perfect-line rate | All fields of a line correct simultaneously |
| Perfect-document rate | Header plus every line correct — the only metric that reflects what a human reviewer experiences |
| Header field accuracy | Per field against `document_header_ground_truth.csv` |
| Total reconciliation pass rate | Σ(qty × rate) matches `printed_order_total_inr`, over the 816 documents that print one |
| Empty-output rate ★ | Documents where the extractor returned nothing. Expect a spike on the 241 image-only PDFs if OCR was not triggered |

### End-to-end composition — the analysis worth writing up

Run stage 2 twice and difference the results:

1. **Oracle input.** Feed `purchase_order_lines.csv` directly to the matching agent. These
   are the numbers from the relational benchmark: 62.2% line straight-through, and whatever
   false auto-approval rate your agent achieves.
2. **Real input.** Feed your stage-1 extraction output to the same agent.

The gap is **extraction-induced degradation**, and it decomposes by quality tier. The
finding to look for is not that accuracy drops — it obviously will — but *where the errors
land*. An OCR error inside a description usually pushes a line from a confident match to a
low-confidence one, which is safe: the agent escalates. An OCR error inside a **price or
quantity** is dangerous: `136.12` misread as `186.12` is still a plausible number, it passes
every format check, and it will be quietly auto-approved if the tolerance band happens to
absorb it. Report false auto-approval rate for oracle input versus each quality tier; a
system that is safe on clean PDFs and unsafe on phone photos is the realistic outcome, and
saying so precisely is the contribution.

---

## 5. Limitations, stated plainly

- **The handwriting is simulated, not real.** L5 uses an oblique serif face drawn word by
  word with baseline jitter and ±2.6° rotation. It defeats naive OCR and looks convincing at
  a glance, but it does not reproduce genuine cursive letterforms, ligature variation or
  pen-pressure physics. Results on L5 are indicative, not a substitute for testing on real
  handwritten orders.
- **Degradations are synthetic.** Gaussian blur and noise, an affine skew and a perspective
  warp approximate scanning and photography; they do not reproduce moiré, JPEG blocking from
  a real camera pipeline, rolling-shutter distortion, or ink bleed on absorbent paper.
- **No OCR verification was run** during generation — Tesseract is not installed in this
  environment. The text-layer checks (D20–D22) confirm what is and is not machine-readable,
  but nobody has measured how a specific OCR engine performs on this corpus. That
  measurement is the project.
- **English only, one supplier, A4 only.** Real Indian POs mix Hindi and Gujarati trade
  terms in the body text, arrive on letterheads of many sizes, and sometimes come as
  photographs of a screen showing a PDF. `document_language_mix` in `purchase_orders.csv`
  flags 18% of orders as containing Hindi terms, but the rendered body text is English.
- **Thin cells.** L2×q4 and L4×q5 hold 2 and 3 documents. Do not quote percentages from
  them.
- **Filename leakage.** Layout and quality are in the filename. Strip them before inference
  if your pipeline reads paths.

---

## 6. Reproduction

```bash
python3 build_documents.py --data <dir with the 6 CSVs> --out <dir>   # seed 424242
python3 validate_documents.py <dir>                                   # 26 checks
```

Requires `pandas`, `reportlab`, `pypdfium2`, `Pillow`, `numpy`, `pypdf`. The build takes
about four minutes and is deterministic: same seed, same 1,000 documents.

To change the mix, edit `choose_profile()` in `build_documents.py` (layout/quality
assignment) or `degrade()` in `doc_render.py` (the physical effects). Both regenerate the
manifest and ground truth consistently, because the ground truth is emitted by the renderer
as it draws rather than assembled afterwards.

**26 of 26 validation checks pass**, including: every manifest file exists and is non-empty;
one document per PO and one ground-truth row per PO line; every line rendered on a page;
printed quantity, UOM, price, colour and GSM identical to the source CSV character for
character; the source description recoverable inside every printed description; clean PDFs
expose the PO number and line descriptions in their text layer (40/40); scanned PDFs expose
no text layer at all (25/25); and annexure pages carry no line items.
