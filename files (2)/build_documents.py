"""
build_documents.py
==================
Renders every PO in purchase_orders.csv into a raw document (PDF or image) in
one of six layouts and one of five quality tiers, then writes:

    po_documents/<files>                        the corpus
    document_manifest.csv                       one row per document
    document_extraction_ground_truth.csv        one row per PO line, as printed
    document_header_ground_truth.csv            one row per document, header fields

The existing relational CSVs are opened READ-ONLY and are never rewritten.
Deterministic under DOC_SEED.

Usage: python3 build_documents.py --data <dir with the 6 CSVs> --out <dir>
"""

import argparse
import io
import json
import os
import random

import pandas as pd
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as rl_canvas

import doc_render as R

DOC_SEED = 424242

LAYOUT_NAMES = {
    "L1_classic_tabular": "Classic bordered tabular PO on plain letterhead",
    "L2_exporter_letterhead": "Export-house indent, dark letterhead band, rate before qty",
    "L3_email_body": "Order typed into an email body, no table, no totals",
    "L4_excel_grid": "Spreadsheet printed to PDF, dense grid, 12 columns",
    "L5_handwritten_slip": "Handwritten order-book slip, ruled paper",
    "L6_erp_portal_print": "Machine-generated portal print-out, monospaced, barcode",
}
QUALITY_NAMES = {
    "q1_clean_digital": "Native digital PDF with a real text layer",
    "q2_print_scan": "Printed then scanned at 200 dpi, light skew and noise, image-only PDF",
    "q3_poor_scan": "Poor scan: heavy skew, blur, speckle, fold line, contrast loss",
    "q4_phone_photo": "Phone photo: perspective warp, shadow gradient, handheld blur",
    "q5_fax_bitonal": "Fax/bitonal: 1-bit threshold, streaks, slipped rows",
}
QUALITY_DPI = {"q1_clean_digital": None, "q2_print_scan": 200, "q3_poor_scan": 150,
               "q4_phone_photo": 150, "q5_fax_bitonal": 200}
TEXT_LAYER = {"q1_clean_digital": "Y", "q2_print_scan": "N", "q3_poor_scan": "N",
              "q4_phone_photo": "N", "q5_fax_bitonal": "N"}


def choose_profile(po, rng, max_slip_lines=6):
    """Layout + quality follow the channel and document_quality already recorded
    in purchase_orders.csv, so the raw corpus is consistent with the relational
    dataset rather than contradicting it."""
    ch, dq = po["received_channel"], po["document_quality"]
    def ok(lay):   # a handwritten slip only holds a short order
        return lay != "L5_handwritten_slip" or po["po_line_count"] <= max_slip_lines
    if dq == "Poor Scan / Handwritten":
        if rng.random() < 0.45 and ok("L5_handwritten_slip"):
            return "L5_handwritten_slip", rng.choices(
                ["q3_poor_scan", "q4_phone_photo", "q2_print_scan"], weights=[48, 40, 12])[0]
        lay = rng.choices(["L1_classic_tabular", "L3_email_body", "L2_exporter_letterhead",
                           "L4_excel_grid", "L6_erp_portal_print"],
                          weights=[42, 18, 16, 12, 12])[0]
        return lay, rng.choices(["q3_poor_scan", "q5_fax_bitonal", "q4_phone_photo"],
                                weights=[55, 20, 25])[0]
    if ch == "WhatsApp Image":
        lay = rng.choices(["L1_classic_tabular", "L5_handwritten_slip", "L3_email_body",
                           "L4_excel_grid", "L6_erp_portal_print"],
                          weights=[34, 26, 14, 14, 12])[0]
        lay = lay if ok(lay) else "L1_classic_tabular"
        return lay, rng.choices(["q4_phone_photo", "q3_poor_scan"], weights=[80, 20])[0]
    if ch == "Scanned Copy":
        lay = rng.choices(["L1_classic_tabular", "L2_exporter_letterhead", "L4_excel_grid",
                           "L6_erp_portal_print", "L5_handwritten_slip"],
                          weights=[34, 22, 18, 16, 10])[0]
        lay = lay if ok(lay) else "L2_exporter_letterhead"
        return lay, rng.choices(["q2_print_scan", "q3_poor_scan", "q5_fax_bitonal"],
                                weights=[52, 33, 15])[0]
    if ch == "Email Excel":
        return "L4_excel_grid", rng.choices(["q1_clean_digital", "q2_print_scan"],
                                            weights=[88, 12])[0]
    if ch == "Portal Upload":
        return "L6_erp_portal_print", "q1_clean_digital"
    # Email PDF
    lay = rng.choices(["L1_classic_tabular", "L2_exporter_letterhead", "L3_email_body",
                       "L6_erp_portal_print"], weights=[46, 27, 17, 10])[0]
    return lay, rng.choices(["q1_clean_digital", "q2_print_scan"], weights=[86, 14])[0]


def main(data_dir, out_dir):
    rng = random.Random(DOC_SEED)
    docdir = os.path.join(out_dir, "po_documents")
    os.makedirs(docdir, exist_ok=True)

    O = pd.read_csv(os.path.join(data_dir, "purchase_orders.csv"), keep_default_na=False)
    L = pd.read_csv(os.path.join(data_dir, "purchase_order_lines.csv"), keep_default_na=False)
    C = pd.read_csv(os.path.join(data_dir, "customer_master.csv"), keep_default_na=False)
    try:
        S = pd.read_csv(os.path.join(data_dir, "dataset_splits.csv"))[["po_id", "split"]]
        split_of = dict(zip(S.po_id, S.split))
    except FileNotFoundError:
        split_of = {}
    cust_of = {r["customer_id"]: r for _, r in C.iterrows()}
    lines_of = {k: v.sort_values("line_no").to_dict("records") for k, v in L.groupby("po_id")}

    manifest, gt_lines, gt_head = [], [], []

    for idx, po in enumerate(O.to_dict("records")):
        cust = cust_of[po["customer_id"]]
        lines = lines_of[po["po_id"]]
        layout, quality = choose_profile(po, rng)
        stem = f"{po['po_id']}__{layout}__{quality}"

        # ---------------- render ----------------
        opts = {}
        if layout == "L5_handwritten_slip":
            img, page_of, place, desc_texts = R.render_handwritten_slip(po, cust, lines, rng)
            pages = 1
            base_images = [img]
        else:
            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=A4)
            opts = {}
            if layout in ("L1_classic_tabular", "L2_exporter_letterhead"):
                opts["short_page"] = bool(len(lines) >= 6 and rng.random() < 0.45)
                opts["annexure"] = bool(rng.random() < 0.12)
            pages, page_of, place, desc_texts = R.LAYOUTS_PDF[layout](c, po, cust, lines, **opts)
            c.save()
            pdf_bytes = buf.getvalue()
            base_images = None

        # ---------------- quality tier ----------------
        params = {}
        if quality == "q1_clean_digital":
            fname = stem + ".pdf"
            with open(os.path.join(docdir, fname), "wb") as f:
                f.write(pdf_bytes)
        else:
            if base_images is None:
                dpi = QUALITY_DPI[quality]
                base_images = []
                for p in range(pages):
                    im, _ = R.pdf_to_image(pdf_bytes, dpi, page=p)
                    base_images.append(im)
            deg = []
            for im in base_images:
                im2, params = R.degrade(im, quality, rng)
                deg.append(im2)
            if quality in ("q2_print_scan", "q3_poor_scan"):
                fname = stem + ".pdf"                      # image-only PDF, no text layer
                R.image_only_pdf(deg, os.path.join(docdir, fname))
            elif quality == "q4_phone_photo":
                fname = stem + ".jpg"
                if len(deg) == 1:
                    deg[0].convert("L").save(os.path.join(docdir, fname), quality=45,
                                             optimize=True)
                else:                                       # multi-page photo -> stacked
                    W = max(i.width for i in deg)
                    Hs = sum(i.height for i in deg)
                    from PIL import Image as _I
                    canvas_img = _I.new("L", (W, Hs), 250)
                    yy = 0
                    for i in deg:
                        canvas_img.paste(i, (0, yy))
                        yy += i.height
                    canvas_img.save(os.path.join(docdir, fname), quality=45, optimize=True)
            else:                                           # q5_fax_bitonal
                fname = stem + ".png"
                deg[0].convert("1").save(os.path.join(docdir, fname), optimize=True)
                if len(deg) > 1:
                    for k, im in enumerate(deg[1:], start=2):
                        im.convert("1").save(
                            os.path.join(docdir, stem + f"_p{k}.png"), optimize=True)

        size = os.path.getsize(os.path.join(docdir, fname))

        # ---------------- ground truth ----------------
        total = 0.0
        for i, ln in enumerate(lines):
            q = R.parse_num(ln["quantity_text"])
            r = R.parse_num(ln["unit_price_text"])
            amt = q * r if (q is not None and r is not None) else None
            if amt:
                total += amt
            # exact string drawn in the description position, reported by the renderer
            desc_printed = desc_texts[i] if i < len(desc_texts) else ""
            on_doc = i < len(page_of)
            gt_lines.append({
                "po_line_id": ln["po_line_id"], "po_id": po["po_id"],
                "document_file": fname, "layout_id": layout, "quality_id": quality,
                "page_no": page_of[i] if i < len(page_of) else pages,
                "table_row_index": i + 1,
                "printed_description": desc_printed,
                "printed_item_code": ln["customer_item_code"],
                "printed_colour": ln["colour_text"],
                "printed_gsm": ln["gsm_text"],
                "printed_width": ln["width_text"],
                "printed_quantity": ln["quantity_text"],
                "printed_uom": ln["uom_text"],
                "printed_unit_price": ln["unit_price_text"],
                "printed_amount": R.money(amt) if place["amount"] == "column" else "",
                "printed_remarks": ln["line_remarks"],
                "colour_rendered_in": place["colour"],
                "gsm_rendered_in": place["gsm"],
                "width_rendered_in": place["width"],
                "item_code_rendered_in": place["item_code"],
                "remarks_rendered_in": place["remarks"],
                "line_rendered_on_document": "Y" if on_doc else "N",
            })
        gt_head.append({
            "po_id": po["po_id"], "document_file": fname, "layout_id": layout,
            "quality_id": quality,
            "printed_po_number": po["po_number"], "printed_po_date": po["po_date"],
            "printed_customer_name": cust["customer_name"],
            "printed_customer_city": cust["city"],
            "printed_supplier_name": R.SUPPLIER["name"],
            "printed_ship_to_city": po["ship_to_city"],
            "printed_delivery_date": po["requested_delivery_date"],
            "printed_payment_terms_days": po["payment_terms_days"],
            "printed_currency": po["currency"],
            "printed_line_count": len(lines),
            "printed_order_total_inr": R.money(total) if place["total"] == "printed" else "",
            "total_printed_on_document": "Y" if place["total"] == "printed" else "N",
            "amount_column_present": "Y" if place["amount"] == "column" else "N",
        })
        manifest.append({
            "po_id": po["po_id"], "po_number": po["po_number"],
            "customer_id": po["customer_id"], "po_date": po["po_date"],
            "document_file": fname,
            "file_format": os.path.splitext(fname)[1].lstrip("."),
            "layout_id": layout, "layout_name": LAYOUT_NAMES[layout],
            "quality_id": quality, "quality_name": QUALITY_NAMES[quality],
            "has_text_layer": TEXT_LAYER[quality],
            "requires_ocr": "N" if quality == "q1_clean_digital" else "Y",
            "render_dpi": QUALITY_DPI[quality] or "",
            "n_pages": pages, "n_lines": len(lines),
            "has_terms_annexure_page": "Y" if opts.get("annexure") else "N",
            "line_items_span_pages": "Y" if (len(set(page_of)) > 1) else "N",
            "lines_rendered": min(len(lines), len(page_of)),
            "source_channel": po["received_channel"],
            "source_document_quality": po["document_quality"],
            "degradation_params": json.dumps(params, separators=(",", ":")) if params else "",
            "file_size_bytes": size,
            "split": split_of.get(po["po_id"], ""),
        })
        if (idx + 1) % 100 == 0:
            print(f"  rendered {idx+1}/{len(O)}")

    pd.DataFrame(manifest).to_csv(os.path.join(out_dir, "document_manifest.csv"), index=False)
    pd.DataFrame(gt_lines).to_csv(
        os.path.join(out_dir, "document_extraction_ground_truth.csv"), index=False)
    pd.DataFrame(gt_head).to_csv(
        os.path.join(out_dir, "document_header_ground_truth.csv"), index=False)

    M = pd.DataFrame(manifest)
    print(f"\n{len(M)} documents, {M.file_size_bytes.sum()/1e6:.1f} MB total")
    print("\nLayout x quality coverage:")
    print(pd.crosstab(M.layout_id, M.quality_id).to_string())
    print("\nFormats:", M.file_format.value_counts().to_dict())
    print("Requires OCR:", M.requires_ocr.value_counts().to_dict())
    print("Multi-page docs:", int((M.n_pages > 1).sum()))
    print("Lines dropped by slip overflow:", int((M.n_lines - M.lines_rendered).sum()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/mnt/user-data/outputs")
    ap.add_argument("--out", default="/mnt/user-data/outputs")
    a = ap.parse_args()
    main(a.data, a.out)
