"""
dd_scenarios.py
===============
Messy-description engine, scenario library and the ground-truth resolver.

Design principle: a scenario builder only declares WHAT it did to the line
(match difficulty, price intent, data-quality flags). Every ground-truth label
(exception type, action, auto-process eligibility, SO status) is then DERIVED by
one resolver, so labels can never contradict each other across 5,000 rows.
"""

import random
import datetime as dt
from collections import defaultdict
from dd_core import RULES, TIER_DISCOUNT

# ----------------------------------------------------------------------------
# A. TEXT CORRUPTION PRIMITIVES
# ----------------------------------------------------------------------------
ABBREV = [
    ("100% Combed Cotton", "100% CMBD CTN"), ("100% Cotton Knit", "100% CTN KNIT"),
    ("95/5 Cotton Lycra Knit", "95/5 CTN LYC"), ("60/40 Poly Cotton Knit", "60/40 PC KNIT"),
    ("100% Cotton Denim", "100% CTN DNM"), ("98/2 Cotton Lycra Denim", "98/2 CTN LYC DNM"),
    ("65/35 Poly Cotton", "65/35 PC"), ("80/20 Poly Cotton", "80/20 PC"),
    ("70/30 Poly Viscose", "70/30 PV"), ("80/20 Poly Viscose", "80/20 PV"),
    ("55/45 Poly Wool", "55/45 P/W"), ("100% Polyester", "100% PLY"),
    ("100% Viscose", "100% VIS"), ("100% Cotton", "100% CTN"), ("100% Linen", "100% LIN"),
    ("100% Modal", "100% MDL"), ("100% Lyocell", "100% LYO"),
    ("Cotton", "CTN"), ("Polyester", "PLY"), ("Viscose", "VIS"), ("Melange", "MEL"),
    ("Shirting", "SHRT"), ("Bottomweight", "BTM"), ("Jersey", "JSY"), ("Interlock", "INTLK"),
    ("Printed", "PRT"), ("Corduroy", "CORD"), ("Upholstery", "UPH"), ("Curtain", "CURT"),
    ("Navy Blue", "NAVY"), ("Royal Blue", "R.BLUE"), ("Sky Blue", "S.BLUE"),
    ("Off White", "O/W"), ("Grey Melange", "GREY MEL"), ("Bottle Green", "BTL GRN"),
    ("Coffee Brown", "COFFEE"), ("Silver Grey", "SIL GREY"), ("Baby Pink", "B.PINK"),
    ("Greige RFD", "RFD"), ("Sea Green", "SEA GRN"), ("Charcoal", "CHARCL"),
]

COLOUR_SYNONYM = {
    "Navy Blue": ["Navy", "N.Blue", "Nevy Blue", "Dark Blue"],
    "Off White": ["Off-White", "OW", "Offwhite"],
    "Grey Melange": ["Melange Grey", "Mel. Grey", "Gray Melange"],
    "Greige RFD": ["RFD", "Greige", "Grey Fabric (RFD)"],
    "Firozi": ["Ferozi", "Turquoise", "Firozee"],
    "Bottle Green": ["B. Green", "Dark Green"],
    "Sky Blue": ["S. Blue", "Light Blue"],
    "Coffee Brown": ["Coffee", "Brown Coffee"],
    "Baby Pink": ["Lt Pink", "Light Pink"],
    "Charcoal": ["Charcoal Grey", "Dark Grey"],
    "Silver Grey": ["Silver", "Lt Grey"],
    "Maroon": ["Marun", "Dark Maroon"],
    "Mustard": ["Musturd", "Haldi"],
}

FAMILY_JARGON = {
    "Cotton Shirting": ["shirting cloth", "shirting fabric", "shirt material"],
    "Cotton Bottomweight": ["bottom fabric", "trouser cloth", "pant material"],
    "Poly Cotton Shirting": ["PC shirting", "blended shirting cloth"],
    "Viscose Rayon": ["rayon cloth", "viscos fabric"],
    "Polyester Georgette": ["georgette material", "gtte fabric"],
    "Denim": ["denim cloth", "jeans fabric"],
    "Linen and Blends": ["linen cloth", "linen material"],
    "Modal and Lyocell": ["modal fabric", "tencel type fabric"],
    "PV Suiting": ["suiting cloth", "uniform suiting", "PV cloth"],
    "Satin and Sateen": ["satin cloth", "sattin fabric"],
    "Single Jersey Knit": ["SJ knit", "jersey knit fabric", "t-shirt knit"],
    "Interlock and Rib Knit": ["rib fabric", "interlock knit"],
    "Fleece and Loop Knit": ["fleece cloth", "loopknit fabric"],
    "Corduroy and Velvet": ["cord fabric", "velvet cloth"],
    "Flannel and Winterwear": ["flannel cloth", "winter fabric"],
    "Rubia and Lining": ["rubia cloth", "lining material", "astar cloth"],
    "Print Base Fabric": ["print base", "printing cloth"],
    "Curtain Fabric": ["curtain cloth", "casement fabric"],
    "Upholstery Fabric": ["sofa fabric", "upholstery cloth"],
    "Bedsheet and Sheeting": ["bedsheet cloth", "sheeting fabric"],
    "Terry Towel": ["towel", "terry towel pcs"],
    "Canvas and Industrial": ["canvas cloth", "duck fabric"],
}

OCR_SUBS = [("O", "0"), ("o", "0"), ("I", "l"), ("l", "1"), ("S", "5"), ("B", "8"),
            ("G", "6"), ("t", "f"), ("rn", "m")]


def typo(rng, s, n=1):
    """Keyboard-neighbour / transposition / doubling / deletion typos."""
    neigh = {"a": "sq", "b": "vn", "c": "xv", "d": "sf", "e": "wr", "g": "fh", "i": "uo",
             "l": "kp", "m": "n", "n": "bm", "o": "ip", "p": "ol", "r": "et", "s": "ad",
             "t": "ry", "u": "yi", "v": "cb", "y": "tu"}
    s = list(s)
    for _ in range(n):
        idx = [i for i, ch in enumerate(s) if ch.isalpha()]
        if not idx:
            break
        i = rng.choice(idx)
        mode = rng.choice(["swap", "neigh", "double", "drop"])
        if mode == "swap" and i + 1 < len(s):
            s[i], s[i + 1] = s[i + 1], s[i]
        elif mode == "neigh":
            s[i] = rng.choice(neigh.get(s[i].lower(), "x"))
        elif mode == "double":
            s[i] = s[i] * 2
        else:
            s[i] = ""
    return "".join(s)


def abbreviate(rng, s, intensity=2):
    for full, ab in ABBREV:
        if full.lower() in s.lower() and intensity > 0:
            i = s.lower().find(full.lower())
            s = s[:i] + ab + s[i + len(full):]
            intensity -= 1
    return s


def ocr_noise(rng, s, n=3):
    s = list(s)
    sub_map = dict(OCR_SUBS)
    hits = [i for i, ch in enumerate(s) if ch in sub_map]
    rng.shuffle(hits)
    for i in hits[:n]:
        s[i] = sub_map[s[i]]
    if len(hits) < n:                       # fall back to digit/char damage
        for _ in range(n - len(hits)):
            i = rng.randrange(len(s))
            s[i] = rng.choice(["0", "1", "l", "5", "8", "?", ""])
    out = "".join(s)
    if rng.random() < 0.5:
        out = out.replace(" ", "  ", 1)
    if rng.random() < 0.4:
        out += rng.choice([" ~~", " |", " ###", " (illegible)", " ...."])
    return out


def gsm_token(rng, g):
    return rng.choice([f"{g} GSM", f"{g}GSM", f"GSM {g}", f"{g} gm", f"{g}gsm", f"{g} g/m2"])


def width_token(rng, w):
    if w == "":
        return ""
    return rng.choice([f'{w}"', f"{w} inch", f"{w}in", f"W-{w}", f"{w} inches", f"{w}'"])


def colour_token(rng, c, allow_syn=True):
    if allow_syn and c in COLOUR_SYNONYM and rng.random() < 0.65:
        return rng.choice(COLOUR_SYNONYM[c])
    return c


def comp_token(rng, comp, short=False):
    if not short:
        return comp
    m = {"100% Cotton": "Cotton", "100% Polyester": "Poly", "100% Viscose": "Viscose",
         "100% Combed Cotton": "Combed Cotton", "100% Linen": "Linen", "100% Modal": "Modal"}
    return m.get(comp, comp)


def assemble(rng, parts, messy=False):
    parts = [p for p in parts if p]
    if messy and rng.random() < 0.55:
        rng.shuffle(parts)
    sep = rng.choice([" ", " ", " - ", "/", ", ", "  "]) if messy else " "
    s = sep.join(parts)
    if messy:
        r = rng.random()
        if r < 0.15:
            s = s.upper()
        elif r < 0.25:
            s = s.lower()
    return s.strip()


# ----------------------------------------------------------------------------
# B. QUANTITY / PRICE HELPERS
# ----------------------------------------------------------------------------
def typical_qty(rng, uom):
    if uom == "MTR":
        return rng.choice([150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500])
    if uom == "KG":
        return rng.choice([50, 80, 100, 150, 200, 250, 300, 400, 500])
    return rng.choice([100, 200, 300, 500, 750, 1000, 1500, 2000])


def reference_price(cust, product, price_history, po_date):
    """Returns (ref_price, source, age_days). Business rule:
       1. last transacted price for this customer+SKU, if <= 180 days old
       2. same, but older -> stale reference
       3. tier list price -> no customer reference
    """
    hist = [h for h in price_history.get((cust["customer_id"], product["sku"]), [])
            if h[0] <= po_date]
    if hist:
        d, price, _, _ = hist[-1]
        age = (po_date - d).days
        if age <= RULES["reference_price_max_age_days"]:
            return price, "customer_last_transacted", age
        return price, "customer_stale_transacted", age
    tier_price = round(product["list_price_inr"] * (1 - TIER_DISCOUNT[cust["commercial_tier"]]), 2)
    return tier_price, "tier_list_price", -1


def quote_from_intent(rng, ref, intent):
    if intent == "exact":
        return round(ref * rng.uniform(0.995, 1.005), 2)
    if intent == "minor":
        f = rng.uniform(0.025, 0.048)
        return round(ref * (1 + rng.choice([-1, 1]) * f), 2)
    if intent == "major_high":
        return round(ref * rng.uniform(1.09, 1.42), 2)
    if intent == "major_low":
        return round(ref * rng.uniform(0.55, 0.90), 2)
    return ""


def price_status_from_delta(delta_pct, source, quoted):
    if quoted == "" or quoted is None:
        return "no_price_quoted"
    a = abs(delta_pct)
    if source == "tier_list_price":
        base = "no_reference_price"
    elif source == "customer_stale_transacted":
        base = "stale_reference_price"
    else:
        base = None
    if a > RULES["price_tolerance_flag_pct"]:
        return "outside_tolerance_high" if delta_pct > 0 else "outside_tolerance_low"
    if base:
        return base
    if a <= RULES["price_tolerance_auto_pct"]:
        return "within_tolerance"
    return "minor_variance_acceptable"


# ----------------------------------------------------------------------------
# C. GROUND-TRUTH RESOLVER  (single source of every expected_* label)
# ----------------------------------------------------------------------------
CONF_BAND = {
    "exact_match": "very_high", "high_confidence_match": "high",
    "low_confidence_match": "medium", "ambiguous_multiple_candidates": "low",
    "no_match": "very_low",
}


def resolve(match_status, price_status, flags):
    """Priority order is deliberate: data-integrity blockers first, then
    identity risk, then commercial risk, then advisory flags."""
    f = set(flags)

    if "malformed" in f:
        return ("incomplete_line", "manual_entry", False, "do_not_create")
    if "illegible" in f:
        return ("illegible_document", "manual_entry", False, "hold_for_review")
    if match_status == "no_match":
        return ("unknown_product", "reject_line", False, "do_not_create")
    if "duplicate" in f:
        return ("duplicate_order", "hold_duplicate_check", False, "hold_for_review")
    if "missing_qty" in f:
        return ("missing_quantity", "request_clarification", False, "hold_for_review")
    if "conflicting" in f:
        return ("conflicting_data", "request_clarification", False, "hold_for_review")
    if match_status == "ambiguous_multiple_candidates":
        return ("ambiguous_match", "review_match", False, "hold_for_review")
    if "attribute_conflict" in f:
        return ("attribute_conflict", "review_match", False, "hold_for_review")
    if "partial_match" in f:
        return ("partial_match", "review_match", False, "hold_for_review")
    if "unmapped_code" in f:
        return ("unmapped_customer_code", "review_match", False, "hold_for_review")
    if match_status == "low_confidence_match":
        return ("low_confidence_match", "review_match", False, "hold_for_review")
    if "uom_incompatible" in f:
        return ("uom_mismatch", "review_uom", False, "hold_for_review")
    if price_status in ("outside_tolerance_high", "outside_tolerance_low"):
        return ("price_variance_major", "review_price", False, "hold_for_review")
    if "new_customer" in f:
        # Safety rule: a customer with zero transaction history never gets a
        # straight-through order, however clean the match and price look.
        return ("new_customer_no_history", "review_price", False, "hold_for_review")
    if "qty_outlier" in f:
        return ("quantity_outlier", "review_quantity", False, "hold_for_review")
    if "uom_convertible" in f:
        return ("uom_converted", "auto_process_with_flag", True, "create_so_line_flagged")
    if price_status == "stale_reference_price":
        return ("stale_reference_price", "auto_process_with_flag", True, "create_so_line_flagged")
    if price_status == "no_reference_price":
        return ("no_reference_price", "auto_process_with_flag", True, "create_so_line_flagged")
    if price_status == "minor_variance_acceptable":
        return ("price_variance_minor", "auto_process_with_flag", True, "create_so_line_flagged")
    return ("none", "auto_process", True, "create_so_line")


# ----------------------------------------------------------------------------
# D. SCENARIO LIBRARY
# ----------------------------------------------------------------------------
# scenario -> (difficulty, target share of non-duplicate lines)
SCENARIO_MIX = {
    # ---- EASY (40%) ----
    "clean_exact_match":                ("easy", 0.215),
    "minor_naming_variation":           ("easy", 0.120),
    "small_acceptable_price_variation": ("easy", 0.060),
    # ---- MEDIUM (32%) ----
    "spelling_errors_and_abbreviations": ("medium", 0.120),
    "customer_specific_product_code":    ("medium", 0.060),
    "partial_catalogue_match":           ("medium", 0.050),
    "no_historical_price":               ("medium", 0.030),
    "new_customer_no_history":           ("medium", 0.030),
    "expired_historical_price":          ("medium", 0.035),
    # ---- HARD (20%) ----
    "ambiguous_product_match":           ("hard", 0.050),
    "multiple_possible_sku_matches":     ("hard", 0.050),
    "incorrect_colour_or_gsm":           ("hard", 0.040),
    "poor_quality_document":             ("hard", 0.030),
    "conflicting_information_in_po":     ("hard", 0.030),
    # ---- EXCEPTION (8%) ----
    "unknown_product":                   ("exception", 0.025),
    "wrong_price_outside_tolerance":     ("exception", 0.022),
    "wrong_unit_of_measure":             ("exception", 0.012),
    "missing_quantity":                  ("exception", 0.010),
    "unusually_large_quantity":          ("exception", 0.006),
    "malformed_incomplete_order":        ("exception", 0.004),
    # duplicate_purchase_order is injected at PO level, not sampled here
}
DUPLICATE_SCENARIO = ("duplicate_purchase_order", "exception")

NON_CATALOGUE_ITEMS = [
    ("100% Hemp Canvas 320 GSM 58 inch Natural", "hemp not stocked"),
    ("Bamboo Terry Knit 240 GSM Off White", "bamboo yarn not in catalogue"),
    ("Wool Felt 400 GSM 72 inch Charcoal", "pure wool felt not stocked"),
    ("Cupro Satin 90 GSM 44 inch Ivory", "cupro not in catalogue"),
    ("Neoprene Bonded Scuba 380 GSM Black", "scuba/neoprene not stocked"),
    ("Kevlar Blend Industrial Fabric 500 GSM", "technical textile out of scope"),
    ("Silk Organza 45 GSM 44 inch Gold", "pure silk not stocked"),
    ("PU Coated Leatherette 450 GSM Tan", "synthetic leather not stocked"),
    ("Nylon Ripstop 110 GSM 60 inch Olive", "nylon not in catalogue"),
    ("Merino Wool Jersey 180 GSM Navy", "merino not stocked"),
    ("Jute Hessian Cloth 280 GSM 40 inch Natural", "jute not stocked"),
    ("Recycled PET Fleece GRS Certified 300 GSM", "GRS certified line not launched"),
]


def build_line_content(rng, scenario, ctx):
    """Returns (fields_dict, gt_dict).
    ctx supplies: product, customer, price_history, po_date, quality_groups,
    products_by_sku, catalogue indexes."""
    p = ctx["product"]
    cust = ctx["customer"]
    po_date = ctx["po_date"]
    flags, notes = [], ""
    match_status = "exact_match"
    price_intent = "exact"
    candidates = []
    true_sku = p["sku"]

    comp, sub, gsm = p["composition"], p["sub_category"], p["gsm"]
    width = p["width_inch"]
    colour = p["colour"]
    fam = p["product_family"]
    uom_true = p["uom"]

    cust_code = ""
    if cust["uses_own_item_codes"] == "Y" and rng.random() < 0.35:
        cust_code = f"{cust['customer_code_prefix']}{rng.randint(1000, 9899)}"

    colour_text = gsm_text = width_text = ""
    remarks = ""

    # ---------------- EASY ----------------
    if scenario == "clean_exact_match":
        desc = p["product_name"]
        colour_text, gsm_text, width_text = colour, str(gsm), str(width)
        match_status = "exact_match"
        notes = "Description is a verbatim catalogue name."

    elif scenario == "minor_naming_variation":
        desc = assemble(rng, [comp_token(rng, comp, short=rng.random() < 0.5), sub,
                              gsm_token(rng, gsm), width_token(rng, width),
                              colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour_token(rng, colour), str(gsm)
        match_status = "exact_match" if rng.random() < 0.55 else "high_confidence_match"
        notes = "Token order/format differs; all attributes recoverable."

    elif scenario == "small_acceptable_price_variation":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width), colour],
                        messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        price_intent = "minor"
        notes = "Match is clean; price 2.5-5% off reference (within commercial tolerance)."

    # ---------------- MEDIUM ----------------
    elif scenario == "spelling_errors_and_abbreviations":
        s = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width),
                           colour_token(rng, colour)], messy=True)
        s = abbreviate(rng, s, intensity=rng.choice([1, 2, 3]))
        s = typo(rng, s, n=rng.choice([1, 2, 2, 3]))
        desc = s
        colour_text = typo(rng, colour, 1) if rng.random() < 0.5 else colour
        gsm_text = str(gsm)
        match_status = "high_confidence_match"
        notes = "Abbreviations + typos; fuzzy/semantic match required."

    elif scenario == "customer_specific_product_code":
        cust_code = f"{cust['customer_code_prefix'] or (cust['customer_name'][:3].upper() + '-')}{rng.randint(1000, 9899)}"
        mapped = rng.random() < 0.55
        if mapped:
            desc = assemble(rng, [rng.choice(FAMILY_JARGON[fam]), gsm_token(rng, gsm),
                                  colour_token(rng, colour)], messy=True)
            match_status = "high_confidence_match"
            notes = "Customer code unknown to us, but description + buying history resolve the SKU."
        else:
            desc = rng.choice([f"as per our code {cust_code}", f"{cust_code} - regular quality",
                               f"item {cust_code}", f"{cust_code} same as last time"])
            flags.append("unmapped_code")
            match_status = "low_confidence_match"
            notes = "Only a customer-internal code given; no catalogue-resolvable attributes."

    elif scenario == "partial_catalogue_match":
        grp = ctx["quality_groups"][p["quality_group_id"]]
        grp_colours = {ctx["products_by_sku"][s]["colour"] for s in grp}
        missing = [c for c, _, _ in ctx["all_colours"] if c not in grp_colours]
        asked = rng.choice(missing) if missing else "Turmeric Gold"
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width), asked],
                        messy=True)
        colour_text = asked
        gsm_text = str(gsm)
        flags.append("partial_match")
        match_status = "low_confidence_match"
        candidates = grp[:6]
        notes = f"Quality exists but colour '{asked}' is not offered in this quality group."

    elif scenario == "no_historical_price":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        notes = "Customer has never bought this SKU; fall back to tier list price."

    elif scenario == "new_customer_no_history":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width),
                              colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match" if rng.random() < 0.7 else "exact_match"
        flags.append("new_customer")
        notes = "First order from a newly onboarded customer; no transaction history at all."

    elif scenario == "expired_historical_price":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        notes = "Last purchase of this SKU is older than 180 days; reference price is stale."

    # ---------------- HARD ----------------
    elif scenario == "ambiguous_product_match":
        desc = assemble(rng, [rng.choice(FAMILY_JARGON[fam]),
                              width_token(rng, width) if rng.random() < 0.4 else ""],
                        messy=True)
        if rng.random() < 0.4:
            desc += rng.choice([" regular quality", " medium quality", " normal one", " usual"])
        match_status = "ambiguous_multiple_candidates"
        candidates = ctx["family_index"][(fam, sub)][:8]
        notes = "Only family-level intent stated; GSM, width and colour all missing."

    elif scenario == "multiple_possible_sku_matches":
        grp = [s for s in ctx["quality_groups"][p["quality_group_id"]]]
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width)], messy=True)
        gsm_text = str(gsm)
        match_status = "ambiguous_multiple_candidates"
        candidates = grp
        notes = f"Quality fully specified but colour omitted; {len(grp)} SKUs share this quality."

    elif scenario == "incorrect_colour_or_gsm":
        if rng.random() < 0.5:
            wrong_gsm = gsm + rng.choice([-30, -20, -15, 15, 20, 30])
            desc = assemble(rng, [comp, sub, gsm_token(rng, wrong_gsm), width_token(rng, width),
                                  colour], messy=True)
            gsm_text, colour_text = str(wrong_gsm), colour
            notes = f"Stated {wrong_gsm} GSM does not exist in this quality; nearest is {gsm} GSM."
        else:
            grp_colours = {ctx["products_by_sku"][s]["colour"]
                           for s in ctx["quality_groups"][p["quality_group_id"]]}
            wrong_col = rng.choice([c for c, _, _ in ctx["all_colours"] if c not in grp_colours]
                                   or ["Turmeric Gold"])
            desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width),
                                  colour], messy=True)
            colour_text, gsm_text = wrong_col, str(gsm)
            notes = f"Colour in description ({colour}) conflicts with colour column ({wrong_col})."
        flags.append("attribute_conflict")
        match_status = "low_confidence_match"

    elif scenario == "poor_quality_document":
        s = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width),
                           colour_token(rng, colour)], messy=True)
        desc = ocr_noise(rng, s, n=rng.choice([2, 3, 4, 5]))
        gsm_text = rng.choice([str(gsm), "", ocr_noise(rng, str(gsm), 1)])
        colour_text = rng.choice([colour, "", ocr_noise(rng, colour, 1)])
        flags.append("illegible")
        match_status = "low_confidence_match"
        notes = "Poor scan / handwritten PO: OCR artefacts, digits unreliable."

    elif scenario == "conflicting_information_in_po":
        other = rng.choice([s for s in ctx["quality_groups"][p["quality_group_id"]] if s != p["sku"]]
                           or [p["sku"]])
        o = ctx["products_by_sku"][other]
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width), colour],
                        messy=True)
        colour_text, gsm_text = colour, str(gsm)
        alt_colour = rng.choice([c for c, _, _ in ctx["all_colours"] if c != colour])
        alt_gsm = gsm + rng.choice([-40, -25, -20, 20, 25, 40])
        remarks = rng.choice([
            f"Please supply in {alt_colour} as discussed",
            f"Note: rate agreed for {alt_gsm} GSM quality",
            f"Ref our mail - actually need {alt_colour}, not as written above",
            f"Width to be {rng.choice([36, 44, 54, 60, 63])} inch as per last supply",
        ])
        flags.append("conflicting")
        match_status = "high_confidence_match"
        notes = "Line description and line remarks specify different attributes."

    # ---------------- EXCEPTION ----------------
    elif scenario == "unknown_product":
        item, why = rng.choice(NON_CATALOGUE_ITEMS)
        desc = item if rng.random() < 0.7 else abbreviate(rng, item, 1)
        match_status = "no_match"
        true_sku = ""
        notes = f"Not in catalogue: {why}."

    elif scenario == "wrong_price_outside_tolerance":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), width_token(rng, width),
                              colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        price_intent = rng.choices(["major_low", "major_high"], weights=[65, 35])[0]
        remarks = rng.choice(["Rate as per last PO", "Rate confirmed on call", ""])
        notes = "Product resolves cleanly but quoted rate breaches the 5% tolerance band."

    elif scenario == "wrong_unit_of_measure":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        if uom_true == "MTR" and rng.random() < 0.5:
            flags.append("uom_convertible")
            notes = "Quantity stated in YARDS for a metre-based SKU; deterministic conversion exists."
        else:
            flags.append("uom_incompatible")
            notes = "UOM stated is not convertible without fabric-specific yield data (KG vs MTR)."

    elif scenario == "missing_quantity":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        flags.append("missing_qty")
        remarks = rng.choice(["Qty to be confirmed", "As per availability", "TBC", ""])
        notes = "Quantity absent or non-numeric; order cannot be valued."

    elif scenario == "unusually_large_quantity":
        desc = assemble(rng, [comp, sub, gsm_token(rng, gsm), colour_token(rng, colour)], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "high_confidence_match"
        flags.append("qty_outlier")
        notes = "Quantity is an extreme outlier vs this customer's history (possible keying error)."

    elif scenario == "malformed_incomplete_order":
        desc = rng.choice(["same as last order", "as per sample given", "usual material",
                           "-", "as discussed", "repeat of previous", "?", "fabric"])
        flags.append("malformed")
        match_status = "no_match" if rng.random() < 0.35 else "low_confidence_match"
        if match_status == "no_match":
            true_sku = p["sku"]   # a human could resolve it from history; the agent must not guess
        notes = "Free-text reference with no resolvable product attributes."

    elif scenario == "duplicate_purchase_order":
        desc = p["product_name"] if rng.random() < 0.6 else assemble(
            rng, [comp, sub, gsm_token(rng, gsm), colour], messy=True)
        colour_text, gsm_text = colour, str(gsm)
        match_status = "exact_match"
        flags.append("duplicate")
        notes = "Line belongs to a PO that duplicates an earlier PO from the same customer."
    else:
        raise ValueError(f"unknown scenario {scenario}")

    return {
        "description": desc,
        "customer_item_code": cust_code,
        "colour_text": colour_text,
        "gsm_text": gsm_text,
        "width_text": width_text,
        "remarks": remarks,
    }, {
        "match_status": match_status,
        "price_intent": price_intent,
        "flags": flags,
        "candidates": candidates,
        "true_sku": true_sku,
        "notes": notes,
    }
