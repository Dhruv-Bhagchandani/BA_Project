"""
dd_core.py
==========
Synthetic B2B textile distribution dataset -- core taxonomy, business rules,
product master, customer master and transaction history.

ALL DATA IS FICTIONAL. Company names, customers, SKUs, prices and transactions
are generated procedurally for academic use only. Nothing in this dataset
represents the actual customers, catalogue, pricing or financials of any real
business.

Deterministic: driven by MASTER_SEED.
"""

import random
import datetime as dt
from collections import defaultdict

MASTER_SEED = 20260826

# ----------------------------------------------------------------------------
# 1. GLOBAL BUSINESS RULES (single source of truth for the whole dataset)
# ----------------------------------------------------------------------------
RULES = {
    "price_tolerance_auto_pct": 2.0,        # |delta| <= 2%  -> straight through
    "price_tolerance_flag_pct": 5.0,        # 2% < |delta| <= 5% -> auto w/ flag
                                            # |delta| > 5%   -> human price review
    "reference_price_max_age_days": 180,    # older than this = stale reference
    "qty_outlier_multiple": 8.0,            # > 8x customer's median line qty
    "qty_outlier_abs_mtr": 25000,           # or > 25,000 MTR on one line
    "history_start": dt.date(2023, 4, 1),
    "history_end": dt.date(2026, 8, 20),
    "po_start": dt.date(2026, 4, 1),
    "po_end": dt.date(2026, 8, 20),
    "annual_price_drift": 0.035,            # 3.5% p.a. input-cost drift
    "duplicate_window_days": 10,
}

# Discount ladder by commercial tier (applied to list price)
TIER_DISCOUNT = {"A": 0.12, "B": 0.07, "C": 0.03}

# ----------------------------------------------------------------------------
# 2. PRODUCT TAXONOMY
# ----------------------------------------------------------------------------
# (family, code, [sub_categories], [compositions], (gsm_lo, gsm_hi), [widths],
#  uom, base_price_at_ref_gsm, ref_gsm, weave_knit)
FAMILIES = [
    ("Cotton Shirting", "CTS", ["Poplin", "Cambric", "Voile", "Dobby", "Oxford", "Chambray"],
     ["100% Cotton", "100% Combed Cotton", "60/40 Cotton Poly"], (90, 160), [44, 58], "MTR", 96, 120, "Woven"),
    ("Cotton Bottomweight", "CTB", ["Twill", "Drill", "Chino", "Canvas Bottom"],
     ["100% Cotton", "98/2 Cotton Lycra", "97/3 Cotton Spandex"], (180, 320), [58, 60], "MTR", 168, 240, "Woven"),
    ("Poly Cotton Shirting", "PCS", ["Poplin", "Blended Twill", "Blended Shirting"],
     ["65/35 Poly Cotton", "80/20 Poly Cotton"], (100, 150), [58, 63], "MTR", 79, 120, "Woven"),
    ("Viscose Rayon", "VSR", ["Rayon Plain", "Rayon Slub", "Rayon Crepe"],
     ["100% Viscose", "95/5 Viscose Lycra"], (90, 160), [44, 58], "MTR", 88, 120, "Woven"),
    ("Polyester Georgette", "PGT", ["Georgette", "Chiffon", "Crepe"],
     ["100% Polyester"], (60, 120), [44, 58], "MTR", 63, 90, "Woven"),
    ("Denim", "DNM", ["Rigid", "Stretch", "Lightweight"],
     ["100% Cotton Denim", "98/2 Cotton Lycra Denim", "Poly Cotton Denim"], (250, 420), [58, 63], "MTR", 212, 340, "Woven"),
    ("Linen and Blends", "LIN", ["Plain", "Slub", "Handloom Finish"],
     ["100% Linen", "55/45 Linen Cotton", "60/40 Linen Viscose"], (110, 220), [58], "MTR", 322, 160, "Woven"),
    ("Modal and Lyocell", "MOD", ["Plain", "Satin", "Twill"],
     ["100% Modal", "70/30 Modal Cotton", "100% Lyocell"], (100, 180), [58], "MTR", 196, 140, "Woven"),
    ("PV Suiting", "SUT", ["Suiting", "Twill Suiting", "Structured Suiting"],
     ["70/30 Poly Viscose", "80/20 Poly Viscose", "55/45 Poly Wool"], (180, 320), [58, 60], "MTR", 178, 240, "Woven"),
    ("Satin and Sateen", "SAT", ["Satin", "Sateen", "Bridal Satin"],
     ["100% Polyester", "100% Cotton", "95/5 Poly Spandex"], (90, 220), [44, 58], "MTR", 108, 140, "Woven"),
    ("Single Jersey Knit", "KSJ", ["Single Jersey", "Melange Jersey", "Slub Jersey"],
     ["100% Cotton Knit", "95/5 Cotton Lycra Knit", "60/40 Poly Cotton Knit"], (140, 220), [60, 72], "KG", 342, 180, "Knit"),
    ("Interlock and Rib Knit", "KIR", ["Interlock", "1x1 Rib", "2x2 Rib", "Waffle"],
     ["100% Cotton Knit", "95/5 Cotton Lycra Knit"], (180, 280), [60, 72], "KG", 356, 220, "Knit"),
    ("Fleece and Loop Knit", "KFT", ["Loop Terry", "Polar", "Brushed"],
     ["60/40 Cotton Poly Fleece", "100% Polyester Fleece"], (240, 380), [60, 72], "KG", 302, 300, "Knit"),
    ("Corduroy and Velvet", "CDV", ["8 Wale", "21 Wale", "Micro"],
     ["100% Cotton Corduroy", "100% Polyester Velvet"], (200, 340), [44, 58], "MTR", 192, 260, "Woven"),
    ("Flannel and Winterwear", "FLN", ["Flannel", "Brushed Twill"],
     ["100% Cotton", "65/35 Poly Cotton"], (150, 260), [58], "MTR", 146, 200, "Woven"),
    ("Rubia and Lining", "RBL", ["Rubia Cloth", "Lining Plain", "Lining Twill"],
     ["100% Cotton", "100% Polyester", "100% Viscose"], (60, 120), [36, 44, 58], "MTR", 49, 80, "Woven"),
    ("Print Base Fabric", "PRB", ["Printed Plain", "Print Base", "Digital Print Base"],
     ["100% Cotton", "100% Viscose", "100% Polyester"], (90, 150), [44, 58], "MTR", 119, 110, "Woven"),
    ("Curtain Fabric", "HCT", ["Curtain Jacquard", "Blackout Base", "Sheer Casement"],
     ["100% Polyester", "70/30 Poly Cotton"], (150, 320), [54, 110], "MTR", 170, 220, "Woven"),
    ("Upholstery Fabric", "HUP", ["Upholstery Jacquard", "Chenille", "Suede Finish"],
     ["100% Polyester", "70/30 Poly Cotton"], (280, 480), [54, 58], "MTR", 268, 360, "Woven"),
    ("Bedsheet and Sheeting", "BDS", ["Bedsheet Fabric", "Percale", "Sheeting"],
     ["100% Cotton", "50/50 Poly Cotton"], (110, 220), [90, 108], "MTR", 158, 150, "Woven"),
    ("Terry Towel", "TWL", ["Bath Towel", "Hand Towel", "Face Towel"],
     ["100% Cotton Terry"], (350, 600), [30], "PCS", 214, 450, "Terry"),
    ("Canvas and Industrial", "CIN", ["Canvas", "Duck Canvas", "Army Canvas"],
     ["100% Cotton", "65/35 Poly Cotton"], (280, 500), [58, 63], "MTR", 208, 380, "Woven"),
]

COLOURS = [
    ("White", "Neutral", 1.00), ("Off White", "Neutral", 1.00), ("Cream", "Neutral", 1.00),
    ("Ecru", "Neutral", 0.99), ("Greige RFD", "Undyed", 0.90), ("Black", "Dark", 1.04),
    ("Navy Blue", "Blue", 1.03), ("Royal Blue", "Blue", 1.03), ("Sky Blue", "Blue", 1.01),
    ("Firozi", "Blue", 1.02), ("Teal", "Blue", 1.02), ("Grey Melange", "Grey", 1.05),
    ("Charcoal", "Grey", 1.03), ("Silver Grey", "Grey", 1.01), ("Beige", "Neutral", 1.00),
    ("Camel", "Brown", 1.02), ("Coffee Brown", "Brown", 1.02), ("Olive", "Green", 1.02),
    ("Bottle Green", "Green", 1.03), ("Mint", "Green", 1.01), ("Sea Green", "Green", 1.01),
    ("Maroon", "Red", 1.03), ("Wine", "Red", 1.03), ("Rust", "Red", 1.02),
    ("Mustard", "Yellow", 1.02), ("Peach", "Pink", 1.01), ("Baby Pink", "Pink", 1.01),
    ("Lavender", "Purple", 1.02),
]

FINISHES = ["Mercerised", "Bio Wash", "Peach Finish", "Enzyme Wash", "Calendered",
            "Sanforised", "Anti Crease", "Soft Finish", "Standard"]

HSN_BY_CODE = {
    "CTS": "52081200", "CTB": "52094200", "PCS": "54073000", "VSR": "54075200",
    "PGT": "54076100", "DNM": "52094200", "LIN": "53091100", "MOD": "55162200",
    "SUT": "55151200", "SAT": "54075300", "KSJ": "60062200", "KIR": "60041000",
    "KFT": "60019200", "CDV": "58012200", "FLN": "52081900", "RBL": "52081100",
    "PRB": "52085200", "HCT": "54075400", "HUP": "58013600", "BDS": "52094100",
    "TWL": "63026000", "CIN": "52093100",
}


def build_products(rng, target=750):
    """Products are generated as QUALITY GROUPS (composition + sub-category +
    GSM + width) each offered in several colours.  This creates genuine sibling
    ambiguity: a description missing the colour legitimately maps to N SKUs."""
    products = []
    quality_groups = defaultdict(list)      # quality_id -> [sku, ...]
    meta = {}                               # quality_id -> attributes
    seq = defaultdict(int)

    def make_sku(qid, colour, colour_family, colour_mult):
        m = meta[qid]
        seq[m["code"]] += 1
        sku = f"DD-{m['code']}-{seq[m['code']]:04d}"
        price = round(m["q_price"] * colour_mult * rng.uniform(0.985, 1.015), 2)
        size_spec = ""
        if m["uom"] == "PCS":
            size_spec = rng.choice(["30x60 inch", "16x24 inch", "12x12 inch", "27x54 inch"])
        cw = set(w.lower() for w in m["comp"].split())
        sub_clean = " ".join(w for w in m["sub"].split() if w.lower() not in cw)
        tail = f"{m['width']} inch" if m["uom"] != "PCS" else size_spec
        name = " ".join(f"{m['comp']} {sub_clean} {m['gsm']} GSM {tail} {colour}".split())
        products.append({
            "sku": sku, "product_name": name, "product_family": m["fam"],
            "sub_category": m["sub"], "quality_group_id": qid, "composition": m["comp"],
            "gsm": m["gsm"], "width_inch": m["width"] if m["uom"] != "PCS" else "",
            "size_spec": size_spec, "colour": colour, "colour_family": colour_family,
            "weave_knit": m["weave"], "finish": m["finish"], "uom": m["uom"],
            "list_price_inr": price,
            "moq_units": rng.choice([50, 100, 150, 200, 250, 300]),
            "lead_time_days": rng.choice([7, 10, 12, 15, 21, 25, 30]),
            "hsn_code": HSN_BY_CODE[m["code"]],
            "gst_rate_pct": 5 if price < 1000 else 12,
            "is_active": "Y" if rng.random() > 0.04 else "N",
            "launch_date": (RULES["history_start"] -
                            dt.timedelta(days=rng.randint(0, 900))).isoformat(),
        })
        quality_groups[qid].append(sku)
        m["colours_used"].add(colour)

    for (fam, code, subcats, comps, gsm_rng, widths, uom, base_price, ref_gsm, weave) in FAMILIES:
        for q in range(8):
            sub = rng.choice(subcats)
            comp = rng.choice(comps)
            gsm = int(round(rng.uniform(*gsm_rng) / 5.0) * 5)
            width = rng.choice(widths)
            finish = rng.choice(FINISHES)
            qid = f"{code}-Q{q+1:02d}"
            gsm_factor = (gsm / ref_gsm) ** 0.85
            comp_prem = 1.0
            if "Lycra" in comp or "Spandex" in comp:
                comp_prem += 0.09
            if "Combed" in comp:
                comp_prem += 0.06
            if "Wool" in comp:
                comp_prem += 0.18
            if "Lyocell" in comp or "Modal" in comp:
                comp_prem += 0.05
            finish_prem = {"Mercerised": 1.06, "Bio Wash": 1.03, "Peach Finish": 1.04,
                           "Enzyme Wash": 1.03, "Calendered": 1.02, "Sanforised": 1.02,
                           "Anti Crease": 1.05, "Soft Finish": 1.02, "Standard": 1.00}[finish]
            width_factor = 1.0 + (width - 58) * 0.004 if uom == "MTR" else 1.0
            meta[qid] = {"fam": fam, "code": code, "sub": sub, "comp": comp, "gsm": gsm,
                         "width": width, "uom": uom, "finish": finish, "weave": weave,
                         "q_price": base_price * gsm_factor * comp_prem * finish_prem * width_factor,
                         "colours_used": set()}
            n_col = rng.choices([2, 3, 4, 5, 6], weights=[5, 18, 30, 28, 19])[0]
            for (colour, cfam, cmult) in rng.sample(COLOURS, n_col):
                make_sku(qid, colour, cfam, cmult)

    # top-up to the exact target by widening existing quality groups (keeps the
    # sibling structure that the ambiguity scenarios depend on)
    qids = list(meta.keys())
    guard = 0
    while len(products) < target and guard < 10000:
        guard += 1
        qid = rng.choice(qids)
        free = [c for c in COLOURS if c[0] not in meta[qid]["colours_used"]]
        if not free:
            continue
        make_sku(qid, *rng.choice(free))
    products.sort(key=lambda p: p["sku"])
    return products, quality_groups


# ----------------------------------------------------------------------------
# 3. CUSTOMER MASTER
# ----------------------------------------------------------------------------
NAME_A = ["Shreeyan", "Navrang", "Kritika", "Meghdoot", "Anantam", "Vasudha", "Rangoli",
          "Suryakiran", "Zarina", "Amrit", "Kanchan", "Prisha", "Ojas", "Tanvi", "Vihaan",
          "Ruchira", "Sattva", "Nimaya", "Kesar", "Dhruvi", "Ekaanth", "Mayurika", "Samvit",
          "Trinetra", "Yashvi", "Vrinda", "Chhaya", "Nirjara", "Bhavya", "Manthan", "Advika",
          "Sanchi", "Urvi", "Zenith", "Aarohi", "Nakshatra", "Pratham", "Ridhima", "Saanvi",
          "Tejomay", "Utsav", "Vaidehi", "Yuvaan", "Aashritha", "Bhoomika", "Charvi",
          "Devansh", "Eshanya", "Falguni", "Girish", "Harsith", "Ishira", "Jaanvi", "Kavyansh",
          "Lakshit", "Mihika", "Nirvaan", "Oorja", "Parnika", "Rajvi"]
NAME_B = ["Apparels Pvt Ltd", "Textiles", "Fabs", "Garments", "Creations", "Exports Pvt Ltd",
          "Trading Co", "Enterprises", "Fashions LLP", "Vastra", "Clothing Co",
          "Furnishings", "Uniforms", "Weaves", "Sourcing LLP"]

CITIES = [("Mumbai", "MH"), ("Surat", "GJ"), ("Ahmedabad", "GJ"), ("Tiruppur", "TN"),
          ("Ludhiana", "PB"), ("Bengaluru", "KA"), ("New Delhi", "DL"), ("Noida", "UP"),
          ("Jaipur", "RJ"), ("Kolkata", "WB"), ("Erode", "TN"), ("Coimbatore", "TN"),
          ("Indore", "MP"), ("Panipat", "HR"), ("Bhilwara", "RJ"), ("Ichalkaranji", "MH"),
          ("Hyderabad", "TG"), ("Chennai", "TN"), ("Pune", "MH"), ("Karur", "TN")]

SEGMENT_FAMILIES = {
    "Garment Exporter": ["Single Jersey Knit", "Interlock and Rib Knit", "Cotton Shirting",
                         "Denim", "Cotton Bottomweight", "Fleece and Loop Knit"],
    "Domestic Apparel Brand": ["Cotton Shirting", "Cotton Bottomweight", "Single Jersey Knit",
                               "Denim", "Linen and Blends", "Modal and Lyocell"],
    "Wholesaler / Trader": [f[0] for f in FAMILIES],
    "Institutional / Uniform": ["PV Suiting", "Poly Cotton Shirting", "Canvas and Industrial",
                                "Cotton Bottomweight", "Flannel and Winterwear"],
    "Home Furnishing Retailer": ["Curtain Fabric", "Upholstery Fabric", "Bedsheet and Sheeting",
                                 "Terry Towel", "Canvas and Industrial"],
    "Boutique / Designer": ["Viscose Rayon", "Polyester Georgette", "Satin and Sateen",
                            "Linen and Blends", "Print Base Fabric", "Modal and Lyocell"],
}
SEGMENT_WEIGHTS = [26, 22, 20, 12, 12, 8]


def build_customers(rng, n=150, n_new=13):
    used, customers = set(), []
    segs = list(SEGMENT_FAMILIES.keys())
    for i in range(1, n + 1):
        while True:
            nm = f"{rng.choice(NAME_A)} {rng.choice(NAME_B)}"
            if nm not in used:
                used.add(nm)
                break
        seg = rng.choices(segs, weights=SEGMENT_WEIGHTS)[0]
        city, state = rng.choice(CITIES)
        tier = rng.choices(["A", "B", "C"], weights=[22, 46, 32])[0]
        is_new = i > (n - n_new)          # last n_new customers are brand new
        if is_new:
            onboard = RULES["po_start"] + dt.timedelta(days=rng.randint(0, 100))
        else:
            onboard = RULES["history_start"] - dt.timedelta(days=rng.randint(0, 700))
        uses_own_code = rng.random() < 0.30
        customers.append({
            "customer_id": f"CUST{i:04d}",
            "customer_name": nm,
            "customer_segment": seg,
            "city": city,
            "state_code": state,
            "gstin_masked": f"{rng.randint(1,37):02d}XXXXX{rng.randint(1000,9999)}X1Z{rng.randint(0,9)}",
            "commercial_tier": tier,
            "standard_discount_pct": round(TIER_DISCOUNT[tier] * 100, 1),
            "credit_terms_days": rng.choice([0, 15, 30, 30, 45, 60, 90]),
            "credit_limit_inr": rng.choice([200000, 500000, 750000, 1000000, 2000000, 3500000, 5000000]),
            "preferred_uom": "KG" if seg == "Garment Exporter" and rng.random() < 0.4 else "MTR",
            "uses_own_item_codes": "Y" if uses_own_code else "N",
            "customer_code_prefix": (nm.split()[0][:3].upper() + "-") if uses_own_code else "",
            "onboarding_date": onboard.isoformat(),
            "is_new_customer": "Y" if is_new else "N",
            "po_channel_preference": rng.choices(
                ["Email PDF", "Email Excel", "WhatsApp Image", "Portal Upload", "Scanned Copy"],
                weights=[38, 22, 18, 12, 10])[0],
            "avg_monthly_order_value_inr": 0,   # filled after transactions
        })
    return customers


# ----------------------------------------------------------------------------
# 4. TRANSACTION HISTORY
# ----------------------------------------------------------------------------
def build_transactions(rng, products, customers, n_txn=7500):
    """Each established customer gets a sticky portfolio of SKUs drawn from the
    families relevant to their segment. Repeat purchases of the same SKU are
    priced off a customer-specific negotiated factor + time drift + small noise,
    so historical prices are RELATED BUT NOT IDENTICAL."""
    by_family = defaultdict(list)
    for p in products:
        if p["is_active"] == "Y":
            by_family[p["product_family"]].append(p)
    pmap = {p["sku"]: p for p in products}

    established = [c for c in customers if c["is_new_customer"] == "N"]
    portfolios, negotiated = {}, {}
    activity_weights = []
    for c in established:
        fams = SEGMENT_FAMILIES[c["customer_segment"]]
        pool = [p for f in fams for p in by_family[f]]
        size = rng.choices([5, 8, 12, 18, 25, 35], weights=[12, 20, 26, 22, 14, 6])[0]
        size = min(size, len(pool))
        skus = [p["sku"] for p in rng.sample(pool, size)]
        portfolios[c["customer_id"]] = skus
        for s in skus:
            negotiated[(c["customer_id"], s)] = rng.uniform(0.955, 1.045)
        activity_weights.append(rng.choices([1, 2, 4, 7], weights=[30, 34, 24, 12])[0])

    txns, order_seq = [], 0
    total_days = (RULES["history_end"] - RULES["history_start"]).days
    cust_value = defaultdict(float)
    price_history = defaultdict(list)   # (cust, sku) -> [(date, price, qty, uom)]

    n_orders = int(n_txn / 2.4)
    rows_written = 0
    while rows_written < n_txn:
        c = rng.choices(established, weights=activity_weights)[0]
        cid = c["customer_id"]
        # recency-skewed date
        u = rng.random() ** 0.75
        d = RULES["history_start"] + dt.timedelta(days=int(u * total_days))
        order_seq += 1
        order_ref = f"HIST-{d.year}-{order_seq:05d}"
        n_lines = rng.choices([1, 2, 3, 4, 5, 6], weights=[26, 26, 20, 14, 9, 5])[0]
        line_skus = rng.sample(portfolios[cid], min(n_lines, len(portfolios[cid])))
        for ln, sku in enumerate(line_skus, start=1):
            if rows_written >= n_txn:
                break
            p = pmap[sku]
            months = (d - RULES["history_start"]).days / 30.4
            drift = (1 + RULES["annual_price_drift"]) ** (months / 12.0)
            net = p["list_price_inr"] * (1 - TIER_DISCOUNT[c["commercial_tier"]])
            price = net * negotiated[(cid, sku)] * drift * rng.uniform(0.985, 1.015)
            price = round(price, 2)
            if p["uom"] == "MTR":
                qty = rng.choice([150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000])
            elif p["uom"] == "KG":
                qty = rng.choice([50, 75, 100, 150, 200, 250, 300, 400, 500])
            else:
                qty = rng.choice([100, 200, 300, 500, 750, 1000, 1500])
            qty = int(qty * rng.uniform(0.85, 1.15))
            amount = round(qty * price, 2)
            rows_written += 1
            txns.append({
                "transaction_id": f"TXN{rows_written:06d}",
                "order_ref": order_ref,
                "line_no": ln,
                "customer_id": cid,
                "sku": sku,
                "transaction_date": d.isoformat(),
                "quantity": qty,
                "uom": p["uom"],
                "unit_price_inr": price,
                "line_amount_inr": amount,
                "currency": "INR",
                "discount_pct_applied": round(TIER_DISCOUNT[c["commercial_tier"]] * 100, 1),
                "order_status": rng.choices(["Delivered", "Delivered", "Delivered", "Partially Delivered", "Cancelled"],
                                            weights=[70, 12, 10, 6, 2])[0],
            })
            cust_value[cid] += amount
            price_history[(cid, sku)].append((d, price, qty, p["uom"]))

    txns.sort(key=lambda r: (r["transaction_date"], r["transaction_id"]))
    months_span = max(1, (RULES["history_end"] - RULES["history_start"]).days / 30.4)
    for c in customers:
        c["avg_monthly_order_value_inr"] = round(cust_value[c["customer_id"]] / months_span, 2)
    for k in price_history:
        price_history[k].sort(key=lambda x: x[0])
    return txns, portfolios, price_history
