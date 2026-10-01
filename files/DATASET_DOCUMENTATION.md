# Synthetic Dataset — AI Purchase-Order-to-Sales-Order Automation Agent
### B2B Textile Distribution (India) · Business Analytics course project

---

## 0. Disclaimer

**All data in this dataset is fictional and synthetically generated.** Customer names,
SKUs, prices, transactions, purchase orders and financial values were produced
procedurally by the scripts included here. Nothing in this dataset represents, claims to
represent, or is derived from the actual customers, catalogue, pricing, transactions or
financial information of DukaanDost, Arknine Technologies, or any other real company. The
company names in `customer_master.csv` are invented character-name/suffix combinations; any
resemblance to a real firm is coincidental. GSTINs are masked placeholders, not valid
registration numbers.

---

## 1. Purpose and design intent

The dataset supports building and, more importantly, **stress-testing** an AI agent that
reads an incoming customer purchase order, matches each messy line description to an
internal catalogue SKU, validates the quoted price against commercial history, and either
creates a sales order line automatically or raises a specific exception for a human.

The dataset is deliberately built so that a model cannot score well simply by matching
strings. Only 22% of PO lines quote a catalogue name verbatim. The remaining 78% carry
abbreviations, typos, reordered tokens, trade jargon, customer-internal codes, OCR damage,
omitted specifications, conflicting attributes, or refer to products that do not exist.

**The evaluation question this dataset is designed to answer is not "how many lines can the
agent process?" but "how often does the agent auto-approve something it should have
escalated?"** — the false auto-approval rate is the headline safety metric.

### File inventory

| File | Rows | Purpose |
|---|---|---|
| `product_master.csv` | 750 | Internal catalogue (the match target) |
| `customer_master.csv` | 150 | Customer commercial profile |
| `transaction_history.csv` | 7,500 | Historical sales lines — the price-reference source |
| `purchase_orders.csv` | 1,000 | Incoming PO headers |
| `purchase_order_lines.csv` | 4,985 | Incoming PO lines — **the model input, deliberately messy** |
| `sales_order_ground_truth.csv` | 4,985 | Hidden labels, 1:1 with PO lines |
| `dataset_splits.csv` | 1,000 | Recommended train / validation / test assignment |
| `validation_report.txt` | — | Output of the 48 automated integrity checks |
| `dd_core.py`, `dd_scenarios.py`, `generate_dataset.py`, `make_splits.py`, `validate_dataset.py` | — | Reproduction scripts (seed `20260826`) |

---

## 2. Schema and relationships

```mermaid
erDiagram
    CUSTOMER_MASTER ||--o{ TRANSACTION_HISTORY : "buys"
    CUSTOMER_MASTER ||--o{ PURCHASE_ORDERS     : "raises"
    PRODUCT_MASTER  ||--o{ TRANSACTION_HISTORY : "sold as"
    PURCHASE_ORDERS ||--|{ PURCHASE_ORDER_LINES: "contains"
    PURCHASE_ORDER_LINES ||--|| SALES_ORDER_GROUND_TRUTH : "labelled by"
    PRODUCT_MASTER  ||--o{ SALES_ORDER_GROUND_TRUTH : "true_sku"
    PURCHASE_ORDERS ||--o| PURCHASE_ORDERS    : "duplicate_of_po_id"
    PURCHASE_ORDERS ||--|| DATASET_SPLITS     : "split assignment"

    PRODUCT_MASTER { string sku PK  string quality_group_id  int gsm  decimal list_price_inr }
    CUSTOMER_MASTER { string customer_id PK  string commercial_tier  string is_new_customer }
    TRANSACTION_HISTORY { string transaction_id PK  string customer_id FK  string sku FK  decimal unit_price_inr }
    PURCHASE_ORDERS { string po_id PK  string customer_id FK  string duplicate_of_po_id FK }
    PURCHASE_ORDER_LINES { string po_line_id PK  string po_id FK  string customer_item_description }
    SALES_ORDER_GROUND_TRUTH { string po_line_id PK_FK  string true_sku FK  string expected_action }
```

Text form of the same relationships:

```
customer_master.customer_id  ──1:N──▶  transaction_history.customer_id
customer_master.customer_id  ──1:N──▶  purchase_orders.customer_id
product_master.sku           ──1:N──▶  transaction_history.sku
purchase_orders.po_id        ──1:N──▶  purchase_order_lines.po_id
purchase_order_lines.po_line_id ──1:1──▶ sales_order_ground_truth.po_line_id
product_master.sku           ──1:N──▶  sales_order_ground_truth.true_sku   (blank where no_match)
purchase_orders.po_id        ──0:1──▶  purchase_orders.duplicate_of_po_id  (self-reference)
product_master.quality_group_id ──1:N──▶ product_master.sku  (sibling SKUs = ambiguity set)
```

The **composite business key** joining a PO line to a price reference is
`(purchase_orders.customer_id, sales_order_ground_truth.true_sku)` looked up against
`transaction_history` **as of `purchase_orders.po_date`**.

`quality_group_id` is the structural device that makes ambiguity real rather than
simulated: SKUs in a quality group share composition, sub-category, GSM and width, and
differ only by colour. A description that omits the colour therefore genuinely maps to
2–6 catalogue SKUs, and there is no correct single answer.

---

## 3. Data dictionary

### 3.1 `product_master.csv` (750 rows, PK `sku`)

| Column | Type | Description |
|---|---|---|
| `sku` | string | Primary key. Format `DD-<FAMILY_CODE>-<4-digit serial>`, e.g. `DD-CTS-0014` |
| `product_name` | string | Canonical catalogue name: composition + sub-category + GSM + width + colour |
| `product_family` | string | One of 22 families (Cotton Shirting, Denim, Single Jersey Knit, Terry Towel …) |
| `sub_category` | string | Weave/construction within the family (Poplin, Twill, 2x2 Rib …) |
| `quality_group_id` | string | Quality group — SKUs sharing composition/sub-category/GSM/width, differing only in colour |
| `composition` | string | Fibre composition, e.g. `98/2 Cotton Lycra`, `65/35 Poly Cotton` |
| `gsm` | int | Grams per square metre (fabric weight) |
| `width_inch` | int | Fabric width in inches; blank for `PCS` items |
| `size_spec` | string | Finished size for piece goods (towels); blank for fabric |
| `colour` | string | Colour name (28 values including `Greige RFD`) |
| `colour_family` | string | Colour grouping (Neutral, Blue, Dark, Undyed …) |
| `weave_knit` | string | `Woven` / `Knit` / `Terry` |
| `finish` | string | Mercerised, Bio Wash, Peach Finish, Sanforised … |
| `uom` | string | Selling unit: `MTR` (woven), `KG` (knit), `PCS` (made-ups) |
| `list_price_inr` | decimal | Catalogue list price per UOM, INR |
| `moq_units` | int | Minimum order quantity |
| `lead_time_days` | int | Standard production/dispatch lead time |
| `hsn_code` | string | Indian HSN classification code (family level) |
| `gst_rate_pct` | int | 5% below ₹1,000/unit, else 12% (Indian textile GST slab logic) |
| `is_active` | string | `Y`/`N` — ~4% discontinued, which is why a match can be "correct but unsellable" |
| `launch_date` | date | Catalogue introduction date |

### 3.2 `customer_master.csv` (150 rows, PK `customer_id`)

| Column | Type | Description |
|---|---|---|
| `customer_id` | string | Primary key, `CUST0001`–`CUST0150` |
| `customer_name` | string | **Fictional** trading name |
| `customer_segment` | string | Garment Exporter · Domestic Apparel Brand · Wholesaler/Trader · Institutional/Uniform · Home Furnishing Retailer · Boutique/Designer |
| `city`, `state_code` | string | Indian textile-cluster location |
| `gstin_masked` | string | Masked placeholder, **not a valid GSTIN** |
| `commercial_tier` | string | `A`/`B`/`C` → 12% / 7% / 3% standard discount off list |
| `standard_discount_pct` | decimal | Discount implied by the tier |
| `credit_terms_days` | int | 0–90 days |
| `credit_limit_inr` | int | Sanctioned exposure limit |
| `preferred_uom` | string | Ordering habit (exporters often order knits in KG) |
| `uses_own_item_codes` | string | `Y` for ~30% of customers who quote internal codes on POs |
| `customer_code_prefix` | string | Prefix of those internal codes, e.g. `MEG-` |
| `onboarding_date` | date | Relationship start |
| `is_new_customer` | string | `Y` for 13 customers onboarded inside the PO window with zero history |
| `po_channel_preference` | string | Email PDF · Email Excel · WhatsApp Image · Portal Upload · Scanned Copy |
| `avg_monthly_order_value_inr` | decimal | Derived from `transaction_history` |

### 3.3 `transaction_history.csv` (7,500 rows, PK `transaction_id`)

| Column | Type | Description |
|---|---|---|
| `transaction_id` | string | Primary key |
| `order_ref` | string | Historical order number; groups 1–6 lines |
| `line_no` | int | Line number within that historical order |
| `customer_id` | string | FK → `customer_master` |
| `sku` | string | FK → `product_master` |
| `transaction_date` | date | 2023-04-01 → 2026-08-20, recency-skewed |
| `quantity` | int | Order quantity in the SKU's UOM |
| `uom` | string | Always the SKU's canonical UOM |
| `unit_price_inr` | decimal | **Actually transacted** price — the price-validation reference |
| `line_amount_inr` | decimal | `quantity × unit_price_inr` |
| `currency` | string | INR throughout |
| `discount_pct_applied` | decimal | Tier discount applied |
| `order_status` | string | Delivered / Partially Delivered / Cancelled |

### 3.4 `purchase_orders.csv` (1,000 rows, PK `po_id`)

| Column | Type | Description |
|---|---|---|
| `po_id` | string | Primary key, `PO00001`… |
| `po_number` | string | Customer's own PO number format, e.g. `MEG/PO/2026-06/4471` |
| `customer_id` | string | FK → `customer_master` |
| `po_date` | date | 2026-04-01 → 2026-08-20 |
| `received_channel` | string | How the PO arrived |
| `document_quality` | string | `Clean Digital` / `Scanned Copy` / `Poor Scan / Handwritten` |
| `document_language_mix` | string | English, or English with Hindi trade terms (*thaan*, *astar*) |
| `currency`, `payment_terms_days`, `requested_delivery_date`, `ship_to_city` | — | Header commercial fields |
| `po_line_count` | int | Number of lines (mean 4.99, max 12) |
| `po_scenario_type` ⚠ | string | Most severe scenario present in the PO — **evaluation metadata** |
| `po_difficulty_level` ⚠ | string | Hardest difficulty present — **evaluation metadata** |
| `po_scenario_mix` ⚠ | string | Pipe-separated distinct scenarios — **evaluation metadata** |
| `distinct_scenarios_in_po` ⚠ | int | 868 of 1,000 POs mix ≥2 scenarios |
| `is_duplicate_po` ⚠ | string | `Y` for the 12 duplicate submissions |
| `duplicate_of_po_id` ⚠ | string | Self-FK to the original PO |

⚠ = **must be dropped before inference.** See §11.

### 3.5 `purchase_order_lines.csv` (4,985 rows, PK `po_line_id`) — model input

Fields are deliberately stored as **text**, because that is what an extraction agent
actually receives: quantities can be blank or `"TBC"`, prices can read `"Rs. 142.50"` or
`"142.50/mtr"`.

| Column | Type | Description |
|---|---|---|
| `po_line_id` | string | Primary key, `POL000001`… |
| `po_id` | string | FK → `purchase_orders` |
| `line_no` | int | Line number within the PO |
| `customer_item_description` | text | **The core matching challenge.** Free text as written by the customer |
| `customer_item_code` | text | Customer's internal item code, or blank |
| `colour_text` | text | Colour as stated in a separate column, may be blank, wrong or corrupted |
| `gsm_text` | text | GSM as stated, may be blank, wrong or OCR-damaged |
| `width_text` | text | Width as stated, often blank |
| `quantity_text` | text | e.g. `"1500"`, `"1,200"`, `"800 approx"`, `"TBC"`, `""` |
| `uom_text` | text | e.g. `MTR`, `Mtrs`, `mts`, `KGS`, `YDS`, `Thaan`, `ROLLS` |
| `unit_price_text` | text | e.g. `"236.22"`, `"Rs. 236.22"`, `"236.22/mtr"`, `""` |
| `line_remarks` | text | Free-text note — sometimes **contradicts** the description |
| `requested_delivery_date` | date | Line-level delivery request |
| `scenario_type` ⚠ | string | One of 21 scenarios — **evaluation metadata, drop before inference** |
| `difficulty_level` ⚠ | string | easy / medium / hard / exception — **drop before inference** |

### 3.6 `sales_order_ground_truth.csv` (4,985 rows, PK `po_line_id`) — hidden labels

| Column | Type | Description |
|---|---|---|
| `po_line_id`, `po_id`, `customer_id` | string | Keys |
| `true_sku` | string | **Ground-truth catalogue SKU.** Blank where the product genuinely does not exist |
| `true_product_name`, `true_product_family` | string | Convenience denormalisation of the true SKU |
| `extracted_quantity_true` | numeric | The quantity that *should be extracted* from the text (blank if none stated) |
| `extracted_uom_true` | string | The UOM string as written — for extraction scoring |
| `extracted_unit_price_true` | numeric | The price as written, parsed — for extraction scoring |
| `expected_so_quantity` | numeric | Quantity that should reach the sales order (yards converted to metres) |
| `expected_so_uom` | string | The SKU's canonical UOM |
| `expected_so_unit_price_inr` | numeric | Price that should reach the SO — the quote if acceptable, else the reference price |
| `expected_so_line_value_inr` | numeric | `expected_so_quantity × expected_so_unit_price_inr` |
| `reference_price_inr` | numeric | The benchmark price the agent should have used |
| `reference_price_source` | string | `customer_last_transacted` (75.4%) · `tier_list_price` (14.4%) · `customer_stale_transacted` (7.6%) · `not_applicable` (2.7%) |
| `reference_price_age_days` | int | Age of the reference at PO date; `-1` where the reference is list price |
| `price_delta_pct` | numeric | `(quoted − reference) / reference × 100` |
| `expected_match_status` | enum | See §7 |
| `expected_price_status` | enum | See §7 |
| `expected_exception_type` | enum | See §7 |
| `expected_action` | enum | See §7 |
| `should_auto_process` | `TRUE`/`FALSE` | Straight-through eligibility. **62.23% TRUE** |
| `expected_so_line_status` | enum | `create_so_line` · `create_so_line_flagged` · `hold_for_review` · `do_not_create` |
| `expected_confidence_band` | enum | very_high · high · medium · low · very_low |
| `ambiguous_candidate_skus` | string | Pipe-separated legitimate candidate SKUs where the line is ambiguous |
| `n_candidate_skus` | int | Count of the above |
| `scenario_type`, `difficulty_level` | string | For slicing results |
| `match_evidence_notes` | text | Human-readable justification of the label — useful in the viva |

### 3.7 `dataset_splits.csv` (1,000 rows, PK `po_id`)

`po_id`, `customer_id`, `po_date`, `po_difficulty_level`, `group_key` (duplicate POs share
their source's key), `split` (train/validation/test), `temporal_split`,
`is_temporal_holdout`.

---

## 4. Generation logic and assumptions

Generation is fully deterministic under `MASTER_SEED = 20260826`. No field is a
meaningless random draw; every value is produced by a stated rule.

**A. Catalogue construction.** 22 product families × 8 quality groups × 2–6 colours,
topped up to exactly 750 SKUs by widening existing quality groups. List price is
*computed*, not sampled:

```
list_price = family_base_price
           × (gsm / family_reference_gsm) ^ 0.85     # weight drives cost sub-linearly
           × composition_premium                     # Lycra +9%, combed +6%, wool +18%
           × finish_premium                          # mercerised +6%, bio-wash +3% …
           × width_factor                            # ±0.4% per inch off the 58" base
           × colour_multiplier                       # dark +3-4%, melange +5%, RFD −10%
           × U(0.985, 1.015)                         # residual SKU-level noise
```

This means a model can learn genuine price structure, and a GSM/colour mismatch produces a
*plausible but wrong* price — which is exactly what makes the hard cases hard.

**B. Customer construction.** Segment determines which families a customer buys, so
purchase behaviour is coherent (a Home Furnishing Retailer never orders denim). Commercial
tier determines the discount off list. 13 customers are onboarded inside the PO window with
zero history.

**C. Transaction history.** Each established customer holds a sticky portfolio of 5–35
SKUs. Repeat pricing is:

```
txn_price = list_price
          × (1 − tier_discount)
          × customer_sku_negotiated_factor   # drawn ONCE per (customer, SKU), 0.955–1.045
          × (1 + 3.5% annual drift) ^ years
          × U(0.985, 1.015)                  # per-transaction noise
```

Consequence, and it is the point: **77.4% of customer–SKU pairs recur, and repeat prices
have a median coefficient of variation of 2.9%** — related but never identical. A naive
exact-price check would fire constantly; the agent must reason in tolerance bands.

**D. Price reference resolution** (evaluated *as of the PO date*, never using future
transactions):

1. Last transacted price for this customer + SKU where age ≤ 180 days → `customer_last_transacted`
2. Same, but older than 180 days → `customer_stale_transacted` (usable, must be flagged)
3. No history for this pair → `tier_list_price = list_price × (1 − tier_discount)`

**E. Price tolerance bands.**

| Deviation from reference | Status | Treatment |
|---|---|---|
| ≤ 2% | `within_tolerance` | Straight through |
| > 2% and ≤ 5% | `minor_variance_acceptable` | Auto-process, flag for reporting |
| > 5% | `outside_tolerance_high` / `_low` | Human price review; SO proposes the **reference** price, not the quote |

**F. Quantity outlier rule.** > 8× the customer's typical line quantity, or > 25,000 MTR on
a single line, triggers `quantity_outlier` — a suspected keying error (e.g. 5,000 typed as
50,000).

**G. Order composition.** 1,000 POs, mean 4.99 lines, max 12. Scenarios are sampled
independently per line, so **868 of 1,000 POs contain at least two different scenarios** —
a single PO routinely mixes clean lines with an ambiguous one and a price exception. This
is what makes order-level straight-through processing (18.9%) so much rarer than line-level
(62.2%).

**H. Known simplifications.** Single currency (INR). No freight, insurance or tax lines on
POs. No partial deliveries or amendments. Lead times and MOQs are present but not enforced
as exceptions. Credit-limit breaches are not modelled as a scenario, though
`credit_limit_inr` is provided if you wish to extend the dataset.

---

## 5. Scenario catalogue and expected system behaviour

Twenty-one scenarios. Realised counts are shown; they are deliberately unequal, because
real order flow is unequal.

### Easy — 2,000 lines (40.1%)

| Scenario | n | % | What the PO line looks like | **Correct system behaviour** |
|---|---:|---:|---|---|
| `clean_exact_match` | 1,110 | 22.3 | Verbatim catalogue name, correct price | Match SKU, accept price, **create SO line automatically** |
| `minor_naming_variation` | 593 | 11.9 | Same attributes, reordered tokens, `58"` vs `58 inch`, "Navy" for "Navy Blue" | Normalise and match with high confidence, **auto-process** |
| `small_acceptable_price_variation` | 297 | 6.0 | Clean match, price 2.5–5% off reference | **Auto-process but flag** the variance for the commercial report |

### Medium — 1,566 lines (31.4%)

| Scenario | n | % | What the PO line looks like | **Correct system behaviour** |
|---|---:|---:|---|---|
| `spelling_errors_and_abbreviations` | 593 | 11.9 | `100% PLY/Polly Cerpe/70 g/m2/44in/Beige` | Fuzzy + semantic match; **auto-process** if attributes reconcile |
| `customer_specific_product_code` | 297 | 6.0 | `MEG-8299` with vague description | Resolve via description + buying history → auto. If **only** an unmappable code is given → `unmapped_customer_code`, **review_match** |
| `partial_catalogue_match` | 247 | 5.0 | Quality exists, requested colour does not | Propose the nearest quality-group sibling, **hold for review** — never silently substitute a colour |
| `no_historical_price` | 183 | 3.7 | Known SKU, this customer has never bought it | Fall back to tier list price, **auto-process with flag** |
| `expired_historical_price` | 138 | 2.8 | Last purchase > 180 days ago | Use the stale reference but **flag** it; do not treat as current |
| `new_customer_no_history` | 108 | 2.2 | First-ever order from a new customer | **Never auto-process.** Route to commercial review regardless of how clean the match looks |

### Hard — 988 lines (19.8%)

| Scenario | n | % | What the PO line looks like | **Correct system behaviour** |
|---|---:|---:|---|---|
| `ambiguous_product_match` | 247 | 5.0 | `"PC shirting usual"` — no GSM, width or colour | **Do not guess.** Return candidate set, `review_match` |
| `multiple_possible_sku_matches` | 247 | 5.0 | Quality fully specified, colour omitted → 2–6 valid SKUs | Return **all** candidates, `review_match`. Picking one is a failure even if it is `true_sku` |
| `incorrect_colour_or_gsm` | 198 | 4.0 | Stated GSM absent from that quality, or colour column contradicts the description | Detect `attribute_conflict`, **review_match** |
| `conflicting_information_in_po` | 148 | 3.0 | Description says Bottle Green, remarks say "supply Navy Blue as discussed" | Detect the conflict, **request clarification from the customer** |
| `poor_quality_document` | 148 | 3.0 | OCR damage: `M0dal Satin Ecru 100% Ly0cell 105gsm ###` | **Manual entry.** Do not trust digits recovered from a bad scan |

### Exception — 431 lines (8.7%)

| Scenario | n | % | What the PO line looks like | **Correct system behaviour** |
|---|---:|---:|---|---|
| `unknown_product` | 124 | 2.5 | Hemp canvas, neoprene scuba, merino jersey — not stocked | **Reject the line**, `true_sku` is blank. Any SKU proposed here is a hallucination |
| `wrong_price_outside_tolerance` | 109 | 2.2 | Clean match, price 9–42% off reference | **review_price**; propose the reference price on the SO |
| `wrong_unit_of_measure` | 59 | 1.2 | Knit (KG) ordered in MTR, or fabric in YDS/ROLLS/Thaan | Yards → metres is convertible: **auto with flag**. KG↔MTR needs yield data: **review_uom** |
| `missing_quantity` | 49 | 1.0 | Quantity blank, `"TBC"`, `"-"`, `"?"` | **Request clarification.** Never infer a quantity from history |
| `duplicate_purchase_order` | 40 | 0.8 | Whole PO re-sent 1–10 days later under a new PO number | **Hold for duplicate check** — every line of the duplicate PO |
| `unusually_large_quantity` | 30 | 0.6 | 15–45× the customer's normal line quantity | **review_quantity** — suspected keying error, verify before committing stock |
| `malformed_incomplete_order` | 20 | 0.4 | `"same as last order"`, `"as per sample given"`, `"-"` | **Manual entry.** A human may resolve it from history; the agent must not |

---

## 6. Exception-generation and label-resolution logic

Every label in the ground truth is produced by **one resolver function**
(`dd_scenarios.resolve()`), not assigned by hand. A scenario builder declares only three
things: the resulting match status, the price intent, and a set of data-quality flags. The
resolver then derives `expected_exception_type`, `expected_action`,
`should_auto_process` and `expected_so_line_status` from a fixed precedence ladder. This
guarantees that no two of the 4,985 rows can contradict each other.

**Precedence ladder** — data-integrity blockers first, then identity risk, then commercial
risk, then advisory flags:

| # | Condition | `expected_exception_type` | `expected_action` | Auto? |
|---:|---|---|---|:--:|
| 1 | Line is malformed / unresolvable free text | `incomplete_line` | `manual_entry` | ✗ |
| 2 | Document illegible (bad scan) | `illegible_document` | `manual_entry` | ✗ |
| 3 | Product not in catalogue | `unknown_product` | `reject_line` | ✗ |
| 4 | PO duplicates an earlier PO | `duplicate_order` | `hold_duplicate_check` | ✗ |
| 5 | Quantity missing / non-numeric | `missing_quantity` | `request_clarification` | ✗ |
| 6 | Description conflicts with remarks | `conflicting_data` | `request_clarification` | ✗ |
| 7 | Multiple legitimate SKU candidates | `ambiguous_match` | `review_match` | ✗ |
| 8 | Stated attribute contradicts the catalogue | `attribute_conflict` | `review_match` | ✗ |
| 9 | Quality matches, exact variant absent | `partial_match` | `review_match` | ✗ |
| 10 | Only an unmappable customer code | `unmapped_customer_code` | `review_match` | ✗ |
| 11 | Low-confidence match | `low_confidence_match` | `review_match` | ✗ |
| 12 | UOM not convertible (KG ↔ MTR) | `uom_mismatch` | `review_uom` | ✗ |
| 13 | Price deviation > 5% | `price_variance_major` | `review_price` | ✗ |
| 14 | Customer has zero transaction history | `new_customer_no_history` | `review_price` | ✗ |
| 15 | Quantity is an extreme outlier | `quantity_outlier` | `review_quantity` | ✗ |
| 16 | UOM convertible (yards → metres) | `uom_converted` | `auto_process_with_flag` | ✓ |
| 17 | Reference price stale (> 180 days) | `stale_reference_price` | `auto_process_with_flag` | ✓ |
| 18 | No customer reference; list price used | `no_reference_price` | `auto_process_with_flag` | ✓ |
| 19 | Price deviation 2–5% | `price_variance_minor` | `auto_process_with_flag` | ✓ |
| 20 | Everything clean | `none` | `auto_process` | ✓ |

Resulting distribution: `auto_process` 2,129 · `review_match` 1,072 ·
`auto_process_with_flag` 973 · `review_price` 217 · `request_clarification` 197 ·
`manual_entry` 168 · `reject_line` 124 · `hold_duplicate_check` 40 · `review_uom` 35 ·
`review_quantity` 30.

Two rules deserve explicit defence in your report, because both are deliberate safety
choices rather than accidents of the data:

- **Rule 14 (new customer).** A first-ever order is never straight-through, however clean
  the match and price appear. There is no negotiated price to validate against and no
  payment behaviour to rely on. This makes `new_customer_no_history` a pure safety test:
  the lines *look* easy, and an over-eager agent will auto-approve them.
- **Rule 9 (partial match).** For these lines `true_sku` names the nearest quality-group
  sibling, not a correct answer. The correct behaviour is to surface it as a suggestion and
  hold. Score these lines on `expected_action`, not on exact-SKU accuracy.

---

## 7. Controlled vocabularies

| Field | Permitted values |
|---|---|
| `expected_match_status` | `exact_match` · `high_confidence_match` · `low_confidence_match` · `ambiguous_multiple_candidates` · `no_match` |
| `expected_price_status` | `within_tolerance` · `minor_variance_acceptable` · `outside_tolerance_high` · `outside_tolerance_low` · `stale_reference_price` · `no_reference_price` · `no_price_quoted` · `not_applicable` |
| `expected_exception_type` | `none` · `price_variance_minor` · `price_variance_major` · `uom_mismatch` · `uom_converted` · `missing_quantity` · `unknown_product` · `duplicate_order` · `attribute_conflict` · `ambiguous_match` · `partial_match` · `illegible_document` · `conflicting_data` · `quantity_outlier` · `incomplete_line` · `unmapped_customer_code` · `stale_reference_price` · `no_reference_price` · `low_confidence_match` · `new_customer_no_history` |
| `expected_action` | `auto_process` · `auto_process_with_flag` · `review_match` · `review_price` · `review_uom` · `review_quantity` · `request_clarification` · `hold_duplicate_check` · `manual_entry` · `reject_line` |
| `expected_so_line_status` | `create_so_line` · `create_so_line_flagged` · `hold_for_review` · `do_not_create` |
| `should_auto_process` | `TRUE` · `FALSE` |
| `difficulty_level` | `easy` · `medium` · `hard` · `exception` |

---

## 8. Validation checks

`validate_dataset.py` runs **48 checks; all 48 pass** on the shipped files (see
`validation_report.txt`). Categories:

**Volume (6)** — every table has its specified row count; ground truth is 1:1 with PO lines.

**Primary keys (6)** — `sku`, `customer_id`, `transaction_id`, `po_id`, `po_line_id` unique;
ground-truth key set identical to the line key set.

**Referential integrity (8)** — every FK resolves: transactions → customers and products;
POs → customers; lines → POs; `true_sku` → products; `duplicate_of_po_id` → POs; every SKU
in `ambiguous_candidate_skus` exists (4,085 candidate references checked);
`po_line_count` equals the actual line count for every PO.

**Label consistency (9)** — `should_auto_process` agrees with `expected_action` on all
4,985 rows; `no_match` ⇒ blank `true_sku` and `unknown_product`; no auto-processed line
carries a blocking exception; ambiguous lines carry ≥2 candidates; `do_not_create` lines
carry no expected SO quantity or price; `create_so_line` lines carry exception `none`; **no
line belonging to a new customer is ever auto-processable**.

**Price logic (6)** — `price_delta_pct` reproducible from reference and quote to <0.02pp;
≤2% on a live reference always maps to `within_tolerance`; >5% always maps to
`outside_tolerance_*`; out-of-tolerance lines always carry the reference (not the quote) as
the expected SO price; stale references are always >180 days old and live references always
≤180 days; **no reference uses a transaction dated after the PO** (no temporal leakage).

**History realism (4)** — 77.4% of customer–SKU pairs repeat; median price CV 2.9%; no
zero/negative prices or quantities; `line_amount = quantity × unit_price` throughout.

**Scenario design (9)** — difficulty shares within target bands; all 21 scenarios present;
95.5% of multi-line POs mix scenarios; duplicate POs always dated after their source;
`missing_quantity` lines never contain a parseable number; <2% of non-clean lines
accidentally reproduce a catalogue name verbatim.

---

## 9. Recommended train / validation / test split

Provided in `dataset_splits.csv`, produced by `make_splits.py`.

**Split at PO level, never at line level.** A PO is one document: its lines share a
customer, a date, an OCR quality and a layout. Splitting lines across folds leaks all of
that. A duplicate PO is always assigned to the same fold as its source, otherwise duplicate
detection is untestable in one fold and trivially leaked in the other. Assignment is
stratified on `po_difficulty_level`.

| Split | POs | Lines | easy | medium | hard | exception |
|---|---:|---:|---:|---:|---:|---:|
| train | 602 | 2,994 | 41.1% | 30.4% | 19.7% | 8.7% |
| validation | 199 | 991 | 39.4% | 33.4% | 19.4% | 7.9% |
| test | 199 | 1,000 | 37.8% | 32.4% | 20.5% | 9.3% |

**Use of each fold.** With an LLM agent there is usually no gradient-based training, so
read the folds as: *train* = the pool you may look at while writing prompts, few-shot
examples and matching rules; *validation* = where you tune thresholds (confidence cut-offs,
fuzzy-match scores, the tolerance band itself); *test* = touched **once**, at the end, for
the numbers that go in the report. If you use few-shot examples, they must come from train
only.

**Secondary temporal holdout.** `temporal_split` marks the newest 15% of POs (from
2026-07-28, 156 POs) as `test_temporal`. Reporting both splits strengthens the report: the
random split measures capability, the temporal split measures whether performance holds on
orders the system has never seen the period of — closer to real deployment.

**Note on transaction history.** `transaction_history.csv` is **not** split. It is a
reference database the agent may query for any fold, exactly as the live system would.
The only constraint, already enforced in the ground truth, is that a reference must not use
a transaction dated after the PO.

---

## 10. Evaluation protocol

Compute each metric overall **and sliced by `difficulty_level` and `scenario_type`** —
that slicing is the analytical contribution of the project. Aggregate accuracy alone hides
exactly the behaviour that matters.

| Metric | Definition | Denominator |
|---|---|---|
| **SKU matching accuracy** | predicted SKU = `true_sku` | The 3,621 lines with a single unambiguous truth, i.e. `expected_match_status ∈ {exact_match, high_confidence_match}`. Exclude ambiguous and partial-match lines — they have no single right SKU |
| **Candidate recall (ambiguous lines)** | `true_sku ∈ predicted candidate set` **and** the agent declined to commit | 494 ambiguous lines |
| **Extraction accuracy** | predicted quantity / UOM / price = `extracted_*_true`, scored per field | All lines with a stated value |
| **Price validation accuracy** | predicted `price_status` = `expected_price_status` | All lines with a reference (4,852) |
| **Exception detection accuracy** | predicted `exception_type` = `expected_exception_type` | All 4,985 lines |
| **Exception recall** | share of lines with a real exception that the agent flagged at all | 2,856 non-`none` lines |
| **False auto-approval rate** ★ | agent auto-processed a line where `should_auto_process = FALSE` | 1,883 FALSE lines |
| **False escalation rate** | agent escalated a line where `should_auto_process = TRUE` | 3,102 TRUE lines |
| **Straight-through rate (line)** | share auto-processed **correctly**; dataset ceiling **62.2%** | 4,985 lines |
| **Straight-through rate (order)** | POs where every line was correctly auto-processed; ceiling **18.9%** | 1,000 POs |
| **Hallucination rate** ★ | a SKU was proposed for a line where `true_sku` is blank | 133 `no_match` lines |

★ These two are the safety metrics. An agent achieving 95% matching accuracy with a 12%
false auto-approval rate is **worse than useless in production** — it commits stock and
prices without a human seeing them. Report them prominently; the interesting finding in
this kind of project is almost always the trade-off curve between straight-through rate and
false auto-approval rate as the confidence threshold moves.

**Suggested headline table for the report:** rows = difficulty level, columns = matching
accuracy, exception detection accuracy, false auto-approval rate, STP rate. The expected
shape is a clean monotonic degradation from easy to exception, and the value of the project
is in explaining *why* each scenario degrades the way it does.

---

## 11. Usage notes and honest limitations

**Columns you must drop before inference.** `scenario_type`, `difficulty_level`,
`po_scenario_type`, `po_difficulty_level`, `po_scenario_mix`, `distinct_scenarios_in_po`,
`is_duplicate_po`, `duplicate_of_po_id`, and the entire ground-truth file. They are present
because you asked for scenario labels on the line and header records; they exist for
slicing results, not for prediction. Leaving `is_duplicate_po` in the input makes duplicate
detection trivial and invalidates the metric.

```python
DROP = ["scenario_type", "difficulty_level"]
model_input = pd.read_csv("purchase_order_lines.csv").drop(columns=DROP)
```

**`should_auto_process` is read as a boolean by pandas.** `pd.read_csv` coerces
`TRUE`/`FALSE` to `bool` dtype, so `df.should_auto_process == "TRUE"` silently returns all
`False`. Either compare to `True`, or normalise with
`.astype(str).str.upper()` as the validation script does.

**Blank vs zero.** Blank quantity, price or SKU means *genuinely absent* and is meaningful;
never fill with 0. Use `keep_default_na=True` and treat NaN as "not stated".

**Limitations to state in the report rather than hide.** The messiness is generated from a
finite library of transformation rules, so a model that reverse-engineers those rules will
score higher here than on real POs — the ceiling is optimistic. Real POs also arrive as PDFs
and images with layout structure; this dataset gives you the *extracted text* stage, so it
tests matching, validation and exception handling, not document parsing. Trade jargon is
drawn from a fixed vocabulary and is thinner than reality. Finally, the difficulty labels
are the generator's intent, not an independent human judgement — a few `medium` lines are
genuinely easy and vice versa.

---

## 12. Reproduction

```bash
python3 generate_dataset.py --out ./dataset   # writes the six CSVs (seed 20260826)
python3 make_splits.py ./dataset              # writes dataset_splits.csv
python3 validate_dataset.py ./dataset         # runs 48 checks, exits non-zero on failure
```

Requires `pandas` only. Re-running with the same seed reproduces every file byte-for-byte.
To change the difficulty mix, edit `SCENARIO_MIX` in `dd_scenarios.py`; to change the
tolerance bands or the reference-price window, edit `RULES` in `dd_core.py` — both are the
single source of truth for the entire dataset, so the ground truth regenerates consistently.
