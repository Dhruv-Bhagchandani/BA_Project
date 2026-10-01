"""
validate_documents.py -- integrity checks for the raw-document benchmark.
Usage: python3 validate_documents.py <dir>
Exit 0 = all checks passed.
"""
import os
import re
import sys
import random

import pandas as pd
from PIL import Image
from pypdf import PdfReader

d = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/outputs"
docs = os.path.join(d, "po_documents")
rng = random.Random(7)

O = pd.read_csv(f"{d}/purchase_orders.csv", keep_default_na=False)
L = pd.read_csv(f"{d}/purchase_order_lines.csv", keep_default_na=False)
M = pd.read_csv(f"{d}/document_manifest.csv", keep_default_na=False)
G = pd.read_csv(f"{d}/document_extraction_ground_truth.csv", keep_default_na=False)
H = pd.read_csv(f"{d}/document_header_ground_truth.csv", keep_default_na=False)

res = []


def chk(name, cond, detail=""):
    res.append((name, bool(cond), detail))


def norm(s):
    return re.sub(r"\s+", "", str(s)).upper()


def pdf_text(path):
    try:
        r = PdfReader(path)
        return " ".join((p.extract_text() or "") for p in r.pages)
    except Exception as e:
        return f"__ERROR__{e}"


# ---- 1. corpus integrity ---------------------------------------------------
chk("D1 one document per PO", len(M) == len(O) and M.po_id.is_unique, len(M))
chk("D2 manifest po_id set == purchase_orders", set(M.po_id) == set(O.po_id))
missing = [f for f in M.document_file if not os.path.exists(os.path.join(docs, f))]
chk("D3 every manifest file exists on disk", not missing, missing[:3])
chk("D4 no empty/near-empty files", (M.file_size_bytes > 1200).all(),
    int((M.file_size_bytes <= 1200).sum()))
chk("D5 file extension matches quality tier",
    ((M.quality_id.isin(["q1_clean_digital", "q2_print_scan", "q3_poor_scan"]) & (M.file_format == "pdf")) |
     ((M.quality_id == "q4_phone_photo") & (M.file_format == "jpg")) |
     ((M.quality_id == "q5_fax_bitonal") & (M.file_format == "png"))).all())
chk("D6 all six layouts and all five quality tiers present",
    M.layout_id.nunique() == 6 and M.quality_id.nunique() == 5)
cells = M.groupby(["layout_id", "quality_id"]).size()
chk("D7 at least 25 layout x quality cells populated", len(cells) >= 25, len(cells))

# ---- 2. ground-truth coverage ---------------------------------------------
chk("D8 extraction GT has one row per PO line", len(G) == len(L) and G.po_line_id.is_unique,
    f"{len(G)} vs {len(L)}")
chk("D9 GT po_line_id set == purchase_order_lines", set(G.po_line_id) == set(L.po_line_id))
chk("D10 every line was actually rendered", (G.line_rendered_on_document == "Y").all(),
    int((G.line_rendered_on_document != "Y").sum()))
chk("D11 header GT has one row per document", len(H) == len(M) and H.po_id.is_unique)

# ---- 3. fidelity: the document never normalises the source data ------------
j = G.merge(L, on=["po_line_id", "po_id"], suffixes=("", "_src"))
chk("D12 printed quantity == source quantity_text verbatim",
    (j.printed_quantity.astype(str) == j.quantity_text.astype(str)).all())
chk("D13 printed uom == source uom_text verbatim",
    (j.printed_uom.astype(str) == j.uom_text.astype(str)).all())
chk("D14 printed unit price == source unit_price_text verbatim",
    (j.printed_unit_price.astype(str) == j.unit_price_text.astype(str)).all())
chk("D15 printed colour/gsm == source verbatim",
    (j.printed_colour.astype(str) == j.colour_text.astype(str)).all() and
    (j.printed_gsm.astype(str) == j.gsm_text.astype(str)).all())
chk("D16 printed description carries the source description",
    j.apply(lambda r: norm(r.customer_item_description) in norm(r.printed_description)
            or not str(r.customer_item_description).strip(), axis=1).all(),
    int((~j.apply(lambda r: norm(r.customer_item_description) in norm(r.printed_description)
                  or not str(r.customer_item_description).strip(), axis=1)).sum()))
hh = H.merge(O, on="po_id", suffixes=("", "_src"))
chk("D17 header GT matches purchase_orders",
    (hh.printed_po_number == hh.po_number).all() and (hh.printed_po_date == hh.po_date).all()
    and (hh.printed_ship_to_city == hh.ship_to_city).all())
chk("D18 printed line count == actual line count",
    (H.set_index("po_id").printed_line_count.sort_index() ==
     O.set_index("po_id").po_line_count.sort_index()).all())
chk("D19 order total printed only where an amount column exists",
    ((H.total_printed_on_document == "Y") == (H.printed_order_total_inr != "")).all())

# ---- 4. text-layer behaviour (the point of the quality tiers) --------------
q1 = M[M.quality_id == "q1_clean_digital"].sample(min(40, (M.quality_id == "q1_clean_digital").sum()),
                                                  random_state=1)
ok_num = ok_desc = 0
for r in q1.itertuples():
    t = norm(pdf_text(os.path.join(docs, r.document_file)))
    if norm(r.po_number) in t:
        ok_num += 1
    g0 = G[G.po_id == r.po_id].iloc[0]
    frag = norm(g0.printed_description)[:20]
    if frag and frag in t:
        ok_desc += 1
chk("D20 clean digital PDFs expose the PO number in the text layer",
    ok_num >= len(q1) * 0.95, f"{ok_num}/{len(q1)}")
chk("D21 clean digital PDFs expose line descriptions in the text layer",
    ok_desc >= len(q1) * 0.90, f"{ok_desc}/{len(q1)}")

scan = M[M.quality_id.isin(["q2_print_scan", "q3_poor_scan"])].sample(25, random_state=2)
empt = sum(1 for r in scan.itertuples()
           if len(pdf_text(os.path.join(docs, r.document_file)).strip()) < 20)
chk("D22 scanned PDFs have NO text layer (OCR mandatory)", empt == len(scan), f"{empt}/{len(scan)}")

imgs = M[M.file_format.isin(["jpg", "png"])].sample(25, random_state=3)
dims_ok = True
for r in imgs.itertuples():
    with Image.open(os.path.join(docs, r.document_file)) as im:
        if min(im.size) < 700:
            dims_ok = False
chk("D23 image documents are legible resolution (min side >= 700 px)", dims_ok)

# ---- 5. page structure -----------------------------------------------------
chk("D24 multi-page documents exist", (M.n_pages > 1).sum() >= 25, int((M.n_pages > 1).sum()))
chk("D25 page_no never exceeds the document's page count",
    (G.merge(M[["po_id", "n_pages"]], on="po_id").eval("page_no <= n_pages")).all())
chk("D26 annexure pages carry no line items",
    (G.merge(M[["po_id", "n_pages", "has_terms_annexure_page"]], on="po_id")
      .query("has_terms_annexure_page=='Y'").eval("page_no < n_pages")).all())

w = max(len(n) for n, _, _ in res)
fails = 0
for n, ok, det in res:
    if not ok:
        fails += 1
    print(f"{n:<{w}}  {'PASS' if ok else 'FAIL'}   {det}")
print(f"\n{len(res)-fails}/{len(res)} checks passed.")
print("\nLayout x quality:")
print(pd.crosstab(M.layout_id, M.quality_id).to_string())
print("\nCorpus size: %.1f MB across %d files" % (M.file_size_bytes.sum() / 1e6, len(M)))
print("OCR required:", M.requires_ocr.value_counts().to_dict())
print("Multi-page:", int((M.n_pages > 1).sum()), "| with T&C annexure:",
      int((M.has_terms_annexure_page == "Y").sum()),
      "| line items spanning pages:", int((M.line_items_span_pages == "Y").sum()))
sys.exit(1 if fails else 0)
