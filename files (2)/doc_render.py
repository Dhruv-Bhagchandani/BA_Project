"""
doc_render.py
=============
Layout renderers + physical-degradation library for the raw purchase-order
document benchmark.

Six layouts x five quality tiers. Every character printed on a page comes
verbatim from purchase_orders.csv / purchase_order_lines.csv / customer_master.csv --
this module never invents, corrects or normalises line content, so the existing
relational dataset remains the single ground truth.

ALL CONTENT IS FICTIONAL AND SYNTHETIC.
"""

import io
import math
import os
import random
import re

import numpy as np
from PIL import (Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter,
                 ImageFont, ImageOps)
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
import pypdfium2 as pdfium

PW, PH = A4                       # 595.28 x 841.89 pt

# Fictional supplier receiving these POs (the ERP owner in the scenario)
SUPPLIER = {
    "name": "Textile Distribution Co. (Demo Entity)",
    "addr": "Unit 14, Textile Trade Centre, Mumbai 400013",
    "gst": "27XXXXX4471X1Z6",
    "email": "orders@textiledistribution-demo.example",
}

FONT_CANDIDATES = {
    "hand": ["/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
             "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf"],
    "handbold": ["/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf"],
    "plain": ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
}


def _font(kind, size):
    for p in FONT_CANDIDATES[kind]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# numeric helpers -- used ONLY to compute a printed Amount / Total column.
# They never rewrite the description, quantity or rate strings.
# ---------------------------------------------------------------------------
def parse_num(s):
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    t = re.sub(r"(?i)\b(rs\.?|inr|approx|per unit|each)\b", " ", t)
    t = t.replace("~", " ").replace(",", "")
    t = re.sub(r"(?i)/\s*(mtr|kg|pc|pcs|yd|yds|m)\b", " ", t)
    m = re.search(r"-?\d+(?:\.\d+)?", t)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def money(v):
    return "" if v is None else f"{v:,.2f}"


# ---------------------------------------------------------------------------
# reportlab drawing helpers
# ---------------------------------------------------------------------------
def wrap(c, text, font, size, width):
    text = "" if text is None else str(text)
    if not text:
        return [""]
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if c.stringWidth(t, font, size) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    out = []
    for ln in lines:                       # hard-break very long tokens
        while c.stringWidth(ln, font, size) > width and len(ln) > 4:
            k = max(4, int(len(ln) * width / max(c.stringWidth(ln, font, size), 1)))
            out.append(ln[:k])
            ln = ln[k:]
        out.append(ln)
    return out


def cell(c, text, x, y, w, font, size, align="l", leading=None):
    leading = leading or size + 1.6
    lines = wrap(c, text, font, size, w - 4)
    c.setFont(font, size)
    for i, ln in enumerate(lines):
        yy = y - i * leading
        if align == "r":
            c.drawRightString(x + w - 2, yy, ln)
        elif align == "c":
            c.drawCentredString(x + w / 2, yy, ln)
        else:
            c.drawString(x + 2, yy, ln)
    return len(lines) * leading


def n_lines(c, text, font, size, w):
    return len(wrap(c, text, font, size, w - 4))


def barcode(c, x, y, w, h, seed_text):
    rnd = random.Random(seed_text)
    xx = x
    c.setFillGray(0)
    while xx < x + w:
        bw = rnd.choice([0.7, 0.7, 1.1, 1.6])
        if rnd.random() < 0.62:
            c.rect(xx, y, bw, h, stroke=0, fill=1)
        xx += bw + rnd.choice([0.7, 1.0])


# ---------------------------------------------------------------------------
# LAYOUTS
# Each returns (n_pages, page_of_line[list], field_placement dict)
# field_placement records WHERE each attribute was printed so the extraction
# benchmark knows what was recoverable from the page.
# ---------------------------------------------------------------------------
def _inline_desc(ln, include_colour, include_gsm, include_width, sep=" | "):
    """Append attributes into the description text when the layout has no
    dedicated column for them -- nothing is ever dropped."""
    parts = [str(ln["customer_item_description"] or "")]
    if include_colour and ln["colour_text"]:
        parts.append(f"Colour: {ln['colour_text']}")
    if include_gsm and ln["gsm_text"]:
        parts.append(f"GSM: {ln['gsm_text']}")
    if include_width and ln["width_text"]:
        parts.append(f"Width: {ln['width_text']}")
    return sep.join(parts)


def layout_classic_tabular(c, po, cust, lines, short_page=False, annexure=False):
    """L1 -- bordered tabular PO on a plain letterhead. The commonest format."""
    F, FB = "Helvetica", "Helvetica-Bold"
    pages, page_of = 1, []
    x0, x1 = 32, PW - 32

    def header(first):
        y = PH - 40
        c.setFont(FB, 13.5)
        c.drawString(x0, y, cust["customer_name"])
        c.setFont(F, 7.6)
        c.drawString(x0, y - 12, f"{cust['city']}, {cust['state_code']}  |  GSTIN: {cust['gstin_masked']}")
        c.setLineWidth(1.1)
        c.line(x0, y - 20, x1, y - 20)
        c.setFont(FB, 12)
        c.drawCentredString(PW / 2, y - 38, "PURCHASE ORDER")
        c.setFont(F, 8)
        c.drawString(x0, y - 58, "To:")
        c.setFont(FB, 8.6)
        c.drawString(x0 + 18, y - 58, SUPPLIER["name"])
        c.setFont(F, 7.6)
        c.drawString(x0 + 18, y - 68, SUPPLIER["addr"])
        c.drawString(x0 + 18, y - 77, f"GSTIN: {SUPPLIER['gst']}")
        bx = PW - 32 - 190
        c.rect(bx, y - 84, 190, 44, stroke=1, fill=0)
        c.setFont(F, 8)
        c.drawString(bx + 5, y - 51, "PO No.")
        c.drawString(bx + 5, y - 63, "PO Date")
        c.drawString(bx + 5, y - 75, "Delivery By")
        c.setFont(FB, 8)
        c.drawString(bx + 72, y - 51, str(po["po_number"]))
        c.setFont(F, 8)
        c.drawString(bx + 72, y - 63, str(po["po_date"]))
        c.drawString(bx + 72, y - 75, str(po["requested_delivery_date"]))
        if not first:
            c.setFont(F, 7.5)
            c.drawRightString(x1, y - 95, "(continued)")
        return y - 100

    cols = [("Sr", 24, "c"), ("Item Description", 214, "l"), ("Colour", 62, "l"),
            ("GSM", 34, "c"), ("Qty", 48, "r"), ("UOM", 32, "c"),
            ("Rate", 52, "r"), ("Amount", 65, "r")]
    xs, acc = [], x0
    for _, w, _a in cols:
        xs.append(acc)
        acc += w
    tw = acc - x0

    def table_head(y):
        c.setFillGray(0.88)
        c.rect(x0, y - 14, tw, 14, stroke=1, fill=1)
        c.setFillGray(0)
        c.setFont(FB, 7.8)
        for (name, w, a), x in zip(cols, xs):
            if a == "r":
                c.drawRightString(x + w - 3, y - 10.5, name)
            elif a == "c":
                c.drawCentredString(x + w / 2, y - 10.5, name)
            else:
                c.drawString(x + 3, y - 10.5, name)
        return y - 14

    y = header(True)
    y = table_head(y)
    total = 0.0
    desc_texts = []
    c.setFont(F, 7.6)
    for i, ln in enumerate(lines, start=1):
        desc = str(ln["customer_item_description"] or "")
        if ln["customer_item_code"]:
            desc += f"  (Your Code: {ln['customer_item_code']})"
        if ln["width_text"]:
            desc += f"  Width {ln['width_text']}"
        if ln["line_remarks"]:
            desc += f"\nNote: {ln['line_remarks']}"
        desc_texts.append(desc)
        seg = desc.split("\n")
        nl = sum(n_lines(c, s, F, 7.6, 214) for s in seg)
        rh = max(15, nl * 9.4 + 5)
        if y - rh < (470 if short_page else 128):
            c.setFont(F, 7.4)
            c.drawRightString(x1, y - 12, "Contd. on next page ...")
            c.showPage()
            pages += 1
            y = header(False)
            y = table_head(y)
            c.setFont(F, 7.6)
        q, r = parse_num(ln["quantity_text"]), parse_num(ln["unit_price_text"])
        amt = q * r if (q is not None and r is not None) else None
        if amt:
            total += amt
        vals = [str(i), None, str(ln["colour_text"] or ""), str(ln["gsm_text"] or ""),
                str(ln["quantity_text"] or ""), str(ln["uom_text"] or ""),
                str(ln["unit_price_text"] or ""), money(amt)]
        top = y - 9
        for (name, w, a), x, v in zip(cols, xs, vals):
            if v is None:
                yy = top
                for seg_text in seg:
                    for wl in wrap(c, seg_text, F, 7.6, w - 4):
                        c.setFont(F, 7.6)
                        c.drawString(x + 2, yy, wl)
                        yy -= 9.4
            else:
                cell(c, v, x, top, w, F, 7.6, a, 9.4)
        c.setLineWidth(0.4)
        c.rect(x0, y - rh, tw, rh, stroke=1, fill=0)
        for x in xs[1:]:
            c.line(x, y - rh, x, y)
        y -= rh
        page_of.append(pages)

    c.setFont(FB, 8)
    c.rect(x0, y - 16, tw, 16, stroke=1, fill=0)
    c.drawRightString(xs[6] + 52 - 3, y - 11, "Total")
    c.drawRightString(x1 - 3, y - 11, money(total))
    y -= 34
    c.setFont(F, 7.4)
    for t in ["Terms: Payment %s days from invoice date. Goods once dispatched will not be returned." % po["payment_terms_days"],
              "Please confirm acceptance of this order by return mail. Quality to be as per approved swatch.",
              "Ship to: %s" % po["ship_to_city"]]:
        c.drawString(x0, y, t)
        y -= 10
    c.setFont(F, 7.6)
    c.drawRightString(x1, y - 22, "For %s" % cust["customer_name"])
    c.drawRightString(x1, y - 48, "Authorised Signatory")
    if annexure:
        c.showPage()
        pages += 1
        terms_page(c, po, cust, F, FB)
    return pages, page_of, {"colour": "column", "gsm": "column", "width": "inline_description",
                            "item_code": "inline_description", "remarks": "inline_description",
                            "amount": "column", "total": "printed"}, desc_texts


def layout_exporter_letterhead(c, po, cust, lines, short_page=False, annexure=False):
    """L2 -- export-house indent. Rate column BEFORE quantity, code column first."""
    F, FB = "Times-Roman", "Times-Bold"
    pages, page_of = 1, []
    x0, x1 = 40, PW - 40

    def header(first):
        c.setFillGray(0.15)
        c.rect(x0, PH - 78, x1 - x0, 40, stroke=0, fill=1)
        c.setFillGray(1)
        c.setFont(FB, 15)
        c.drawString(x0 + 12, PH - 62, cust["customer_name"].upper())
        c.setFont(F, 8)
        c.drawString(x0 + 12, PH - 73, f"{cust['city']} · {cust['state_code']} · EXPORT DIVISION")
        c.setFillGray(0)
        c.setFont(FB, 11)
        c.drawCentredString(PW / 2, PH - 96, "PURCHASE ORDER / INDENT")
        yb = PH - 108
        c.setLineWidth(0.7)
        c.rect(x0, yb - 52, (x1 - x0) / 2 - 4, 52, stroke=1, fill=0)
        c.rect(x0 + (x1 - x0) / 2 + 4, yb - 52, (x1 - x0) / 2 - 4, 52, stroke=1, fill=0)
        c.setFont(FB, 7.6)
        c.drawString(x0 + 5, yb - 11, "SUPPLIER")
        c.drawString(x0 + (x1 - x0) / 2 + 9, yb - 11, "ORDER DETAILS")
        c.setFont(F, 7.8)
        c.drawString(x0 + 5, yb - 22, SUPPLIER["name"])
        c.drawString(x0 + 5, yb - 32, SUPPLIER["addr"])
        c.drawString(x0 + 5, yb - 42, SUPPLIER["email"])
        bx = x0 + (x1 - x0) / 2 + 9
        c.drawString(bx, yb - 22, f"Order No : {po['po_number']}")
        c.drawString(bx, yb - 32, f"Dated    : {po['po_date']}")
        c.drawString(bx, yb - 42, f"Ship By  : {po['requested_delivery_date']}  ({po['ship_to_city']})")
        return yb - 62

    cols = [("Sr", 20, "c"), ("Buyer Code", 62, "l"), ("Material Description", 210, "l"),
            ("Rate", 52, "r"), ("Qty", 50, "r"), ("Unit", 34, "c"), ("Value INR", 68, "r")]
    xs, acc = [], x0
    for _, w, _a in cols:
        xs.append(acc)
        acc += w
    tw = acc - x0

    def table_head(y):
        c.setFont(FB, 7.6)
        c.setLineWidth(0.9)
        c.line(x0, y, x0 + tw, y)
        for (name, w, a), x in zip(cols, xs):
            c.drawString(x + 2, y - 10, name)
        c.line(x0, y - 13, x0 + tw, y - 13)
        return y - 13

    y = header(True)
    y = table_head(y)
    total = 0.0
    desc_texts = []
    for i, ln in enumerate(lines, start=1):
        desc = _inline_desc(ln, True, True, True)
        if ln["line_remarks"]:
            desc += f"  [{ln['line_remarks']}]"
        desc_texts.append(desc)
        rh = max(14, n_lines(c, desc, F, 7.6, 210) * 9.2 + 5)
        if y - rh < (455 if short_page else 120):
            c.showPage()
            pages += 1
            y = header(False)
            y = table_head(y)
        q, r = parse_num(ln["quantity_text"]), parse_num(ln["unit_price_text"])
        amt = q * r if (q is not None and r is not None) else None
        if amt:
            total += amt
        vals = [str(i), str(ln["customer_item_code"] or "-"), desc,
                str(ln["unit_price_text"] or ""), str(ln["quantity_text"] or ""),
                str(ln["uom_text"] or ""), money(amt)]
        for (name, w, a), x, v in zip(cols, xs, vals):
            cell(c, v, x, y - 9, w, F, 7.6, a, 9.2)
        y -= rh
        c.setLineWidth(0.25)
        c.setStrokeGray(0.75)
        c.line(x0, y, x0 + tw, y)
        c.setStrokeGray(0)
        page_of.append(pages)
    c.setFont(FB, 8.4)
    c.drawRightString(x0 + tw - 2, y - 13, f"TOTAL ORDER VALUE : INR {money(total)}")
    y -= 34
    c.setFont(F, 7.6)
    c.drawString(x0, y, f"Payment Terms : {po['payment_terms_days']} days   |   Currency : {po['currency']}")
    c.drawString(x0, y - 11, "Packing : Roll-wise packed, each roll to carry lot no. and metreage tag.")
    c.drawString(x0, y - 22, "Inspection : Pre-dispatch inspection at supplier premises.")
    c.setFont(FB, 7.6)
    c.drawString(x0, y - 44, "For %s" % cust["customer_name"].upper())
    if annexure:
        c.showPage()
        pages += 1
        terms_page(c, po, cust, F, FB)
    return pages, page_of, {"colour": "inline_description", "gsm": "inline_description",
                            "width": "inline_description", "item_code": "column",
                            "remarks": "inline_description", "amount": "column",
                            "total": "printed"}, desc_texts


def layout_email_body(c, po, cust, lines):
    """L3 -- order typed into an email body. No table, no borders, no totals."""
    F, FB, FM = "Helvetica", "Helvetica-Bold", "Courier"
    pages, page_of = 1, []
    x0 = 46
    y = PH - 52
    c.setFont(FB, 9)
    c.drawString(x0, y, "From:")
    c.drawString(x0, y - 12, "To:")
    c.drawString(x0, y - 24, "Date:")
    c.drawString(x0, y - 36, "Subject:")
    c.setFont(F, 9)
    handle = re.sub(r"[^a-z]", "", cust["customer_name"].split()[0].lower())
    c.drawString(x0 + 48, y, f"purchase@{handle}.example")
    c.drawString(x0 + 48, y - 12, SUPPLIER["email"])
    c.drawString(x0 + 48, y - 24, str(po["po_date"]))
    c.drawString(x0 + 48, y - 36, f"Purchase Order {po['po_number']} - {cust['customer_name']}")
    c.setStrokeGray(0.6)
    c.line(x0, y - 46, PW - 46, y - 46)
    c.setStrokeGray(0)
    y -= 66
    c.setFont(F, 9)
    for t in ["Dear Sir,", "",
              "Kindly process the following order. Material required by %s at our %s unit."
              % (po["requested_delivery_date"], po["ship_to_city"]), ""]:
        c.drawString(x0, y, t)
        y -= 13

    desc_texts = []
    for i, ln in enumerate(lines, start=1):
        desc_texts.append(str(ln["customer_item_description"] or ""))
        bits = [f"{i}. {ln['customer_item_description']}"]
        det = []
        if ln["customer_item_code"]:
            det.append(f"our code {ln['customer_item_code']}")
        if ln["colour_text"]:
            det.append(f"colour {ln['colour_text']}")
        if ln["gsm_text"]:
            det.append(f"gsm {ln['gsm_text']}")
        if ln["width_text"]:
            det.append(f"width {ln['width_text']}")
        det.append(f"qty {ln['quantity_text']} {ln['uom_text']}".strip())
        if ln["unit_price_text"]:
            det.append(f"rate {ln['unit_price_text']}")
        body = "   - " + ", ".join(x for x in det if x.strip())
        rem = f"     ({ln['line_remarks']})" if ln["line_remarks"] else None
        need = 13 * (len(wrap(c, bits[0], FM, 8.4, PW - 2 * x0)) +
                     len(wrap(c, body, FM, 8.4, PW - 2 * x0)) + (1 if rem else 0)) + 6
        if y - need < 110:
            c.showPage()
            pages += 1
            y = PH - 60
            c.setFont(F, 9)
            c.drawString(x0, y, f"...contd. {po['po_number']}")
            y -= 22
        c.setFont(FM, 8.4)
        for s in ([bits[0], body] + ([rem] if rem else [])):
            for w_ in wrap(c, s, FM, 8.4, PW - 2 * x0):
                c.drawString(x0, y, w_)
                y -= 11.6
        y -= 4
        page_of.append(pages)

    y -= 8
    c.setFont(F, 9)
    for t in ["", "Please send proforma invoice for advance processing.", "",
              "Regards,", cust["customer_name"],
              f"{cust['city']} | Payment terms: {cust['credit_terms_days']} days"]:
        c.drawString(x0, y, t)
        y -= 13
    return pages, page_of, {"colour": "inline_detail_line", "gsm": "inline_detail_line",
                            "width": "inline_detail_line", "item_code": "inline_detail_line",
                            "remarks": "inline_note", "amount": "absent",
                            "total": "absent"}, desc_texts


def layout_excel_grid(c, po, cust, lines):
    """L4 -- spreadsheet printed to PDF. Dense gridlines, tiny type, extra columns."""
    F, FB = "Helvetica", "Helvetica-Bold"
    pages, page_of = 1, []
    x0 = 22
    cols = [("S.NO", 22, "c"), ("ITEM DESCRIPTION", 158, "l"), ("CUST CODE", 50, "l"),
            ("COLOUR", 52, "l"), ("GSM", 26, "c"), ("WIDTH", 30, "c"), ("QTY", 40, "r"),
            ("UOM", 26, "c"), ("RATE", 42, "r"), ("AMOUNT", 55, "r"),
            ("DELIVERY", 48, "c"), ("REMARKS", 102, "l")]
    xs, acc = [], x0
    for _, w, _a in cols:
        xs.append(acc)
        acc += w
    tw = acc - x0

    def header(pg):
        y = PH - 34
        c.setFont(FB, 9)
        c.drawString(x0, y, f"{cust['customer_name']} - PURCHASE ORDER")
        c.setFont(F, 7)
        c.drawString(x0, y - 10, f"PO NO: {po['po_number']}    PO DATE: {po['po_date']}    "
                                 f"SUPPLIER: {SUPPLIER['name']}    SHIP TO: {po['ship_to_city']}    "
                                 f"TERMS: {po['payment_terms_days']} DAYS")
        y -= 22
        c.setFillGray(0.82)
        c.rect(x0, y - 12, tw, 12, stroke=1, fill=1)
        c.setFillGray(0)
        c.setFont(FB, 6.2)
        for (name, w, a), x in zip(cols, xs):
            c.drawString(x + 2, y - 8.5, name)
        for x in xs[1:]:
            c.line(x, y - 12, x, y)
        return y - 12

    y = header(1)
    total = 0.0
    desc_texts = []
    for i, ln in enumerate(lines, start=1):
        q, r = parse_num(ln["quantity_text"]), parse_num(ln["unit_price_text"])
        amt = q * r if (q is not None and r is not None) else None
        if amt:
            total += amt
        desc_texts.append(str(ln["customer_item_description"] or ""))
        vals = [str(i), str(ln["customer_item_description"] or ""), str(ln["customer_item_code"] or ""),
                str(ln["colour_text"] or ""), str(ln["gsm_text"] or ""), str(ln["width_text"] or ""),
                str(ln["quantity_text"] or ""), str(ln["uom_text"] or ""),
                str(ln["unit_price_text"] or ""), money(amt),
                str(ln["requested_delivery_date"] or ""), str(ln["line_remarks"] or "")]
        rh = max(11, max(n_lines(c, vals[1], F, 6.2, 158),
                         n_lines(c, vals[11], F, 6.2, 102)) * 8 + 3)
        if y - rh < 70:
            c.showPage()
            pages += 1
            y = header(pages)
        for (name, w, a), x, v in zip(cols, xs, vals):
            cell(c, v, x, y - 7.5, w, F, 6.2, a, 8)
        c.setLineWidth(0.3)
        c.rect(x0, y - rh, tw, rh, stroke=1, fill=0)
        for x in xs[1:]:
            c.line(x, y - rh, x, y)
        y -= rh
        page_of.append(pages)
    c.setFont(FB, 6.8)
    c.rect(x0, y - 12, tw, 12, stroke=1, fill=0)
    c.drawRightString(xs[9] + 55 - 2, y - 8.5, money(total))
    c.drawString(xs[8] - 30, y - 8.5, "TOTAL")
    c.setFont(F, 6)
    c.drawString(x0, 44, f"Sheet1    Page {pages}    Printed on {po['po_date']}    {po['po_number']}.xlsx")
    return pages, page_of, {"colour": "column", "gsm": "column", "width": "column",
                            "item_code": "column", "remarks": "column",
                            "amount": "column", "total": "printed"}, desc_texts


def layout_erp_portal(c, po, cust, lines):
    """L6 -- machine-generated portal print-out. Monospaced, fixed-width columns."""
    FM, FMB = "Courier", "Courier-Bold"
    pages, page_of = 1, []
    x0 = 34

    def header(pg):
        y = PH - 40
        c.setFont(FMB, 10)
        c.drawString(x0, y, "PURCHASE ORDER - SYSTEM GENERATED")
        barcode(c, PW - 34 - 150, y - 6, 150, 22, str(po["po_number"]))
        c.setFont(FM, 6.4)
        c.drawRightString(PW - 34, y - 14, str(po["po_number"]))
        y -= 30
        c.setFont(FM, 7.6)
        rows = [("PO NUMBER", po["po_number"], "PO DATE", po["po_date"]),
                ("BUYER", cust["customer_name"], "BUYER CODE", cust["customer_id"]),
                ("SUPPLIER", SUPPLIER["name"], "CURRENCY", po["currency"]),
                ("SHIP TO", po["ship_to_city"], "DELIVERY DUE", po["requested_delivery_date"]),
                ("PAYMENT TERMS", f"{po['payment_terms_days']} DAYS", "CHANNEL", po["received_channel"])]
        for a, b, d, e in rows:
            c.drawString(x0, y, f"{a:<15}: {str(b)[:34]:<36}{d:<14}: {e}")
            y -= 10
        y -= 4
        c.setFont(FM, 7)
        c.drawString(x0, y, "-" * 118)
        c.setFont(FMB, 7)
        c.drawString(x0, y - 10, f"{'LN':<3}{'DESCRIPTION':<52}{'COLOUR':<14}{'GSM':<6}{'QTY':>10}{'UOM':>6}{'RATE':>12}{'VALUE':>14}")
        c.setFont(FM, 7)
        c.drawString(x0, y - 20, "-" * 118)
        return y - 30

    y = header(1)
    total = 0.0
    desc_texts = []
    c.setFont(FM, 7)
    for i, ln in enumerate(lines, start=1):
        q, r = parse_num(ln["quantity_text"]), parse_num(ln["unit_price_text"])
        amt = q * r if (q is not None and r is not None) else None
        if amt:
            total += amt
        d = str(ln["customer_item_description"] or "")
        desc_texts.append(d)
        chunks = [d[k:k + 52] for k in range(0, max(len(d), 1), 52)] or [""]
        extra = []
        if ln["customer_item_code"]:
            extra.append(f"   CUST-ITEM-CODE: {ln['customer_item_code']}")
        if ln["width_text"]:
            extra.append(f"   WIDTH: {ln['width_text']}")
        if ln["line_remarks"]:
            extra.append(f"   REMARKS: {ln['line_remarks']}")
        need = (len(chunks) + len(extra)) * 9.4 + 4
        if y - need < 90:
            c.setFont(FM, 7)
            c.drawString(x0, y, "-" * 118)
            c.showPage()
            pages += 1
            y = header(pages)
            c.setFont(FM, 7)
        c.drawString(x0, y, f"{i:<3}{chunks[0]:<52}{str(ln['colour_text'] or '')[:13]:<14}"
                            f"{str(ln['gsm_text'] or '')[:5]:<6}{str(ln['quantity_text'] or ''):>10}"
                            f"{str(ln['uom_text'] or ''):>6}{str(ln['unit_price_text'] or ''):>12}{money(amt):>14}")
        y -= 9.4
        for ch in chunks[1:]:
            c.drawString(x0, y, f"{'':<3}{ch}")
            y -= 9.4
        for e in extra:
            c.drawString(x0, y, e)
            y -= 9.4
        y -= 3
        page_of.append(pages)
    c.setFont(FM, 7)
    c.drawString(x0, y, "-" * 118)
    c.setFont(FMB, 7.4)
    c.drawString(x0, y - 12, f"{'':<93}TOTAL{money(total):>20}")
    c.setFont(FM, 6.4)
    c.drawString(x0, 52, "*** This is a system generated document and does not require signature. ***")
    c.drawString(x0, 42, f"Generated from buyer portal | Document ref {po['po_id']} | Page {pages}")
    return pages, page_of, {"colour": "column", "gsm": "column", "width": "labelled_sub_line",
                            "item_code": "labelled_sub_line", "remarks": "labelled_sub_line",
                            "amount": "column", "total": "printed"}, desc_texts


def terms_page(c, po, cust, F, FB):
    """Annexure page: terms only, no line items. A distractor for extractors
    that assume every page of a PO carries order lines."""
    x0, x1 = 40, PW - 40
    c.setFont(FB, 10.5)
    c.drawString(x0, PH - 52, "ANNEXURE - TERMS AND CONDITIONS OF PURCHASE")
    c.setFont(F, 7.6)
    c.drawString(x0, PH - 66, f"Forms part of Purchase Order {po['po_number']} dated {po['po_date']} "
                              f"issued by {cust['customer_name']}")
    c.setLineWidth(0.7)
    c.line(x0, PH - 74, x1, PH - 74)
    y = PH - 96
    terms = [
        ("1. Quality", "Material shall conform to the approved swatch and to the specification stated on the order. "
                       "Shade continuity across lots is the supplier's responsibility."),
        ("2. Tolerance", "Metreage tolerance +/- 1.5 percent per roll. GSM tolerance +/- 5 percent. "
                         "Width shortfall beyond 1 inch is liable to rejection."),
        ("3. Packing", "Each roll to carry a metreage tag, lot number and shade band. Rolls to be poly wrapped."),
        ("4. Delivery", f"Delivery on or before the date stated on the order at our {po['ship_to_city']} unit. "
                        "Part delivery only with prior written consent."),
        ("5. Inspection", "Buyer reserves the right to inspect at the supplier's premises prior to dispatch. "
                          "Acceptance of goods does not waive claims for latent defects."),
        ("6. Payment", f"Payment {po['payment_terms_days']} days from the date of receipt of goods and correct invoice. "
                       "Invoices must quote this order number."),
        ("7. Price", "The rate stated on this order is firm. Any revision must be agreed in writing before dispatch. "
                     "Invoices raised at a rate other than the ordered rate will be held for approval."),
        ("8. Rejection", "Rejected material to be lifted within 15 days at the supplier's cost."),
        ("9. Force Majeure", "Neither party shall be liable for delay arising from events beyond reasonable control."),
        ("10. Jurisdiction", f"Subject to the jurisdiction of courts at {cust['city']}."),
    ]
    for head, body in terms:
        c.setFont(FB, 8)
        c.drawString(x0, y, head)
        c.setFont(F, 7.6)
        for ln in wrap(c, body, F, 7.6, x1 - x0 - 70):
            c.drawString(x0 + 70, y, ln)
            y -= 10
        y -= 8
    c.setFont(F, 7.6)
    c.drawRightString(x1, y - 24, "For %s" % cust["customer_name"])
    c.drawRightString(x1, y - 50, "Authorised Signatory")
    c.setFont(F, 6.4)
    c.drawCentredString(PW / 2, 40, "Annexure - Terms and Conditions - Page 2")


LAYOUTS_PDF = {
    "L1_classic_tabular": layout_classic_tabular,
    "L2_exporter_letterhead": layout_exporter_letterhead,
    "L3_email_body": layout_email_body,
    "L4_excel_grid": layout_excel_grid,
    "L6_erp_portal_print": layout_erp_portal,
}


# ---------------------------------------------------------------------------
# L5 -- handwritten order slip, drawn directly as an image with per-word jitter
# ---------------------------------------------------------------------------
def render_handwritten_slip(po, cust, lines, rng, width=1240, base_ink=38):
    height = 1754
    img = Image.new("L", (width, height), 246)
    d = ImageDraw.Draw(img)
    # ruled paper
    for y in range(250, height - 90, 58):
        d.line([(70, y), (width - 70, y)], fill=222, width=2)
    d.line([(140, 150), (140, height - 90)], fill=214, width=2)
    d.rectangle([40, 40, width - 40, height - 40], outline=205, width=3)

    fh = _font("hand", 34)
    fhb = _font("handbold", 40)
    fp = _font("plain", 26)

    ink = Image.new("L", (width, height), 255)

    def hand(x, y, text, font, base=None, jitter=2.4):
        base = base_ink if base is None else base
        """word-level baseline jitter + rotation to approximate handwriting"""
        cx = x
        for word in str(text).split(" "):
            if not word:
                cx += 12
                continue
            w = int(d.textlength(word, font=font)) + 16
            h = font.size + 24
            lay = Image.new("L", (w, h), 255)
            ImageDraw.Draw(lay).text((5, 7), word, font=font,
                                     fill=max(8, min(110, base + rng.randint(-18, 22))))
            lay = lay.rotate(rng.uniform(-2.6, 2.6), resample=Image.BILINEAR, fillcolor=255)
            box = (int(cx), int(y + rng.uniform(-jitter, jitter)))
            ink.paste(lay, box, ImageOps.invert(lay))
            cx += w - 10
        return cx

    d.text((90, 70), "ORDER BOOK", font=fp, fill=90)
    d.text((width - 430, 70), f"No. {po['po_number']}", font=fp, fill=90)
    hand(160, 130, cust["customer_name"], fhb)
    hand(160, 190, f"Date {po['po_date']}   Delivery {po['requested_delivery_date']}", fh)
    y = 268
    page_of = []
    desc_texts = []
    for i, ln in enumerate(lines, start=1):
        txt = _inline_desc(ln, True, True, True, sep=" - ")
        if ln["customer_item_code"]:
            txt = f"{ln['customer_item_code']} - {txt}"
        desc_texts.append(txt)
        words, cur, rows = txt.split(" "), "", []
        for w in words:
            if d.textlength(cur + " " + w, font=fh) < width - 400:
                cur = (cur + " " + w).strip()
            else:
                rows.append(cur)
                cur = w
        rows.append(cur)
        hand(160, y, f"{i})", fh)
        hand(215, y, rows[0], fh)
        y += 58
        for r in rows[1:]:
            hand(230, y, r, fh)
            y += 58
        qty = f"{ln['quantity_text']} {ln['uom_text']}".strip()
        rate = f"@ {ln['unit_price_text']}" if ln["unit_price_text"] else ""
        hand(240, y, f"{qty}  {rate}".strip(), fh)
        y += 58
        if ln["line_remarks"]:
            hand(240, y, f"({ln['line_remarks']})", fh)
            y += 58
        page_of.append(1)
        if y > height - 220:
            break
    hand(width - 470, height - 170, "for " + cust["customer_name"].split()[0], fh)
    img = ImageChops.darker(img, ink)
    return img, page_of, {"colour": "inline_description", "gsm": "inline_description",
                          "width": "inline_description", "item_code": "inline_description",
                          "remarks": "inline_note", "amount": "absent",
                          "total": "absent"}, desc_texts


# ---------------------------------------------------------------------------
# DEGRADATION -- physical print / scan / photo / fax simulation
# ---------------------------------------------------------------------------
def pdf_to_image(pdf_bytes, dpi, page=0):
    doc = pdfium.PdfDocument(pdf_bytes)
    pil = doc[page].render(scale=dpi / 72.0).to_pil().convert("L")
    n = len(doc)
    doc.close()
    return pil, n


def add_noise(img, sigma, speckle=0.0, rng=None):
    a = np.asarray(img).astype(np.float32)
    a += np.random.default_rng(rng).normal(0, sigma, a.shape)
    if speckle > 0:
        r = np.random.default_rng(rng).random(a.shape)
        a[r < speckle / 2] = 0
        a[r > 1 - speckle / 2] = 255
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def illumination(img, strength, rng):
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = rng.uniform(0.15, 0.85) * w, rng.uniform(0.1, 0.6) * h
    r = np.sqrt(((xx - cx) / w) ** 2 + ((yy - cy) / h) ** 2)
    g = 1.0 - strength * np.clip(r, 0, 1.2)
    a = np.asarray(img).astype(np.float32) * g
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def perspective(img, k, rng):
    w, h = img.size
    d_ = [(rng.uniform(-k, k) * w, rng.uniform(-k, k) * h) for _ in range(4)]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(src[i][0] + d_[i][0], src[i][1] + d_[i][1]) for i in range(4)]
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    B = np.array(src).reshape(8)
    coeffs = np.linalg.solve(np.array(A, dtype=float), B)
    return img.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=250)


def fold_line(img, rng):
    d = ImageDraw.Draw(img)
    w, h = img.size
    y = int(rng.uniform(0.35, 0.65) * h)
    for k in range(-2, 3):
        d.line([(0, y + k), (w, y + k)], fill=int(150 + abs(k) * 30), width=1)
    return img


def fax_streaks(img, rng):
    a = np.asarray(img).copy()
    h, w = a.shape
    for _ in range(rng.randint(3, 9)):
        y = rng.randrange(h)
        th = rng.randint(1, 3)
        a[y:y + th, :] = 255 if rng.random() < 0.6 else 0
    for _ in range(rng.randint(1, 4)):          # slipped rows
        y = rng.randrange(0, h - 30)
        sh = rng.randint(4, 14)
        a[y:y + 20, :] = np.roll(a[y:y + 20, :], sh, axis=1)
    return Image.fromarray(a)


def punch_and_staple(img, rng):
    d = ImageDraw.Draw(img)
    w, h = img.size
    if rng.random() < 0.5:
        for cy in (int(h * 0.3), int(h * 0.7)):
            d.ellipse([10, cy - 14, 38, cy + 14], fill=245, outline=190)
    if rng.random() < 0.4:
        d.line([(46, 40), (76, 62)], fill=110, width=3)
    return img


def degrade(img, quality, rng):
    """Returns (image, params_dict). One code path per quality tier."""
    p = {}
    if quality == "q2_print_scan":
        ang = rng.uniform(-0.7, 0.7)
        img = img.rotate(ang, resample=Image.BICUBIC, fillcolor=252, expand=False)
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.7)))
        img = add_noise(img, rng.uniform(3, 7), 0.0004, rng.randrange(10 ** 6))
        img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.88, 0.98))
        img = punch_and_staple(img, rng)
        p = {"skew_deg": round(ang, 2), "blur": "light", "noise": "low"}
    elif quality == "q3_poor_scan":
        ang = rng.uniform(-2.4, 2.4)
        img = img.rotate(ang, resample=Image.BICUBIC, fillcolor=248, expand=False)
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.8, 1.6)))
        img = add_noise(img, rng.uniform(9, 17), rng.uniform(0.001, 0.004), rng.randrange(10 ** 6))
        img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.62, 0.80))
        img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.86, 1.10))
        img = illumination(img, rng.uniform(0.10, 0.22), rng)
        img = fold_line(img, rng)
        img = punch_and_staple(img, rng)
        p = {"skew_deg": round(ang, 2), "blur": "heavy", "noise": "high",
             "contrast_loss": True, "fold": True}
    elif quality == "q4_phone_photo":
        img = perspective(img, rng.uniform(0.012, 0.032), rng)
        img = img.rotate(rng.uniform(-3.5, 3.5), resample=Image.BICUBIC, fillcolor=244)
        img = illumination(img, rng.uniform(0.22, 0.42), rng)
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.6, 1.5)))
        img = add_noise(img, rng.uniform(6, 13), 0.0006, rng.randrange(10 ** 6))
        img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.80, 1.16))
        p = {"perspective": True, "shadow_gradient": True, "handheld_blur": True}
    elif quality == "q5_fax_bitonal":
        img = img.rotate(rng.uniform(-1.2, 1.2), resample=Image.BICUBIC, fillcolor=255)
        img = img.filter(ImageFilter.GaussianBlur(0.6))
        img = add_noise(img, 8, 0.002, rng.randrange(10 ** 6))
        a = np.asarray(img)
        thr = rng.randint(150, 185)
        img = Image.fromarray(((a > thr) * 255).astype(np.uint8))
        img = fax_streaks(img, rng)
        p = {"bitonal_threshold": thr, "streaks": True, "row_slip": True}
    return img, p


def image_only_pdf(images, path):
    """Wrap page images into an image-only PDF -- no text layer, so a text
    extractor returns nothing and OCR becomes mandatory."""
    c = rl_canvas.Canvas(path, pagesize=A4)
    for im in images:
        buf = io.BytesIO()
        im.convert("L").save(buf, format="JPEG", quality=46, optimize=True)
        buf.seek(0)
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(buf), 0, 0, width=PW, height=PH)
        c.showPage()
    c.save()
