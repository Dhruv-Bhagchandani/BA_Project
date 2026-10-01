"""
generate_dataset.py
===================
Builds the six CSV datasets. Deterministic under MASTER_SEED.

    python3 generate_dataset.py --out /mnt/user-data/outputs/dataset

ALL DATA IS FICTIONAL AND SYNTHETIC. It does not represent the customers,
catalogue, pricing, transactions or financial information of any real company.
"""

import argparse
import os
import random
import datetime as dt
from collections import defaultdict, Counter

import pandas as pd

from dd_core import (MASTER_SEED, RULES, TIER_DISCOUNT, COLOURS, SEGMENT_FAMILIES,
                     build_products, build_customers, build_transactions)
from dd_scenarios import (SCENARIO_MIX, DUPLICATE_SCENARIO, build_line_content, resolve,
                          reference_price, quote_from_intent, price_status_from_delta,
                          typical_qty, CONF_BAND)

N_PRODUCTS_TARGET = 750
N_CUSTOMERS = 150
N_TXN = 7500
N_PO = 1000
N_DUPLICATE_PO = 12
N_NEW_CUSTOMER_PO = 26
TARGET_PRIMARY_LINES = 4945

UOM_TEXT_VARIANTS = {
    "MTR": ["MTR", "Mtr", "MTRS", "mts", "M", "Meters", "mtr"],
    "KG": ["KG", "Kg", "KGS", "kgs", "Kilo"],
    "PCS": ["PCS", "Pcs", "pieces", "NOS", "pc"],
}


def price_text(rng, val, uom="MTR"):
    if val == "" or val is None:
        return ""
    r = rng.random()
    if r < 0.45:
        return f"{val:.2f}"
    if r < 0.60:
        return f"Rs. {val:.2f}"
    if r < 0.72:
        return f"INR {val:.2f}"
    if r < 0.84:
        suf = {"MTR": "/mtr", "KG": "/kg", "PCS": "/pc"}[uom]
        return f"{val:.2f}{suf}" if rng.random() < 0.6 else f"{val:.2f} per unit"
    if r < 0.92:
        return f"{val:,.2f}"
    return f"{val:.1f}"


def qty_text(rng, q):
    if q == "" or q is None:
        return ""
    r = rng.random()
    if r < 0.7:
        return f"{q:g}"
    if r < 0.85:
        return f"{q:,.0f}"
    return f"{q:g} approx" if rng.random() < 0.5 else f"~{q:g}"


def main(outdir):
    rng = random.Random(MASTER_SEED)
    os.makedirs(outdir, exist_ok=True)

    # ---------------- masters ----------------
    products, quality_groups = build_products(rng)
    customers = build_customers(rng, n=N_CUSTOMERS)
    txns, portfolios, price_history = build_transactions(rng, products, customers, n_txn=N_TXN)

    products_by_sku = {p["sku"]: p for p in products}
    active = [p for p in products if p["is_active"] == "Y"]
    by_family = defaultdict(list)
    family_index = defaultdict(list)
    for p in active:
        by_family[p["product_family"]].append(p)
        family_index[(p["product_family"], p["sub_category"])].append(p["sku"])

    cust_by_id = {c["customer_id"]: c for c in customers}
    established = [c for c in customers if c["is_new_customer"] == "N"]
    new_custs = [c for c in customers if c["is_new_customer"] == "Y"]

    # ---------------- PO skeletons ----------------
    po_days = (RULES["po_end"] - RULES["po_start"]).days
    n_primary = N_PO - N_DUPLICATE_PO

    line_counts = [rng.choices([1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
                               weights=[8, 12, 14, 14, 12, 11, 8, 8, 8, 5])[0]
                   for _ in range(n_primary)]
    # trim/extend to hit the target line total exactly
    while sum(line_counts) > TARGET_PRIMARY_LINES:
        i = rng.randrange(n_primary)
        if line_counts[i] > 1:
            line_counts[i] -= 1
    while sum(line_counts) < TARGET_PRIMARY_LINES:
        line_counts[rng.randrange(n_primary)] += 1

    po_skeletons = []
    new_po_idx = set(rng.sample(range(n_primary), N_NEW_CUSTOMER_PO))
    for i in range(n_primary):
        if i in new_po_idx:
            c = rng.choice(new_custs)
        else:
            c = rng.choice(established)
        d = RULES["po_start"] + dt.timedelta(days=rng.randint(0, po_days))
        po_skeletons.append({"idx": i, "customer": c, "po_date": d,
                             "n_lines": line_counts[i], "is_new": i in new_po_idx})

    # ---------------- scenario allocation ----------------
    new_line_slots = sum(s["n_lines"] for s in po_skeletons if s["is_new"])
    new_scen = []
    for _ in range(new_line_slots):
        new_scen.append("unknown_product" if rng.random() < 0.15 else "new_customer_no_history")
    n_unknown_used = new_scen.count("unknown_product")

    other_lines = TARGET_PRIMARY_LINES - new_line_slots
    pool = []
    for scen, (diff, share) in SCENARIO_MIX.items():
        if scen == "new_customer_no_history":
            continue
        n = int(round(share * TARGET_PRIMARY_LINES))
        if scen == "unknown_product":
            n = max(0, n - n_unknown_used)
        pool += [scen] * n
    while len(pool) < other_lines:
        pool.append("clean_exact_match")
    while len(pool) > other_lines:
        pool.pop(rng.randrange(len(pool)))
    rng.shuffle(pool)
    rng.shuffle(new_scen)

    NEW_OK = {"new_customer_no_history", "unknown_product"}
    HISTORY_FREE = {"unknown_product", "malformed_incomplete_order"}

    # ---------------- line construction ----------------
    def pick_product(scenario, cust, po_date):
        """Returns (product, fallback_scenario_or_None)."""
        cid = cust["customer_id"]
        pf = portfolios.get(cid, [])
        seg_pool = [p for f in SEGMENT_FAMILIES[cust["customer_segment"]] for p in by_family[f]]
        if not seg_pool:
            seg_pool = active

        recent, stale = [], []
        for s in pf:
            h = [x for x in price_history.get((cid, s), []) if x[0] <= po_date]
            if h:
                age = (po_date - h[-1][0]).days
                (recent if age <= RULES["reference_price_max_age_days"] else stale).append(s)

        if scenario == "expired_historical_price":
            if stale:
                return products_by_sku[rng.choice(stale)], None
            return rng.choice(seg_pool), "no_historical_price"
        if scenario == "no_historical_price":
            cand = [p for p in seg_pool if p["sku"] not in pf]
            return (rng.choice(cand) if cand else rng.choice(seg_pool)), None
        if scenario in ("new_customer_no_history", "unknown_product"):
            return rng.choice(seg_pool), None
        if scenario in ("clean_exact_match", "small_acceptable_price_variation",
                        "minor_naming_variation", "wrong_price_outside_tolerance") and recent:
            return products_by_sku[rng.choice(recent)], None
        # everything else prefers a SKU with a live reference price
        if recent and rng.random() < 0.88:
            return products_by_sku[rng.choice(recent)], None
        if pf and rng.random() < 0.5:
            return products_by_sku[rng.choice(pf)], None
        return rng.choice(seg_pool), None

    po_rows, line_rows, gt_rows = [], [], []
    line_seq = 0
    po_seq = 0
    fallback_counter = Counter()

    def build_po(cust, po_date, scenarios, po_number=None, dup_of=None, src_lines=None):
        nonlocal po_seq, line_seq
        po_seq += 1
        po_id = f"PO{po_seq:05d}"
        pref = cust["customer_name"].split()[0][:3].upper()
        po_number = po_number or f"{pref}/PO/{po_date.year}-{po_date.month:02d}/{rng.randint(100, 9999)}"
        my_lines, my_gt = [], []

        iter_src = src_lines if src_lines else [None] * len(scenarios)
        for ln, (scen, src) in enumerate(zip(scenarios, iter_src), start=1):
            line_seq += 1
            line_id = f"POL{line_seq:06d}"

            if src is not None:            # duplicate PO: clone the source line verbatim
                content = dict(src["content"])
                gt = dict(src["gt"])
                gt["flags"] = list(gt["flags"]) + ["duplicate"]
                p = src["product"]
                scen = DUPLICATE_SCENARIO[0]
                diff = DUPLICATE_SCENARIO[1]
                qty_num, uom_txt, true_uom = src["qty_num"], src["uom_txt"], src["true_uom"]
                quoted = src["quoted"]
                ref, ref_src, ref_age = src["ref"], src["ref_src"], src["ref_age"]
            else:
                p, fb = pick_product(scen, cust, po_date)
                if fb:
                    fallback_counter[(scen, fb)] += 1
                    scen = fb
                diff = SCENARIO_MIX[scen][0]
                ctx = {"product": p, "customer": cust, "po_date": po_date,
                       "quality_groups": quality_groups, "products_by_sku": products_by_sku,
                       "family_index": family_index, "all_colours": COLOURS}
                content, gt = build_line_content(rng, scen, ctx)

                # ---- quantity ----
                true_uom = p["uom"]
                if scen == "unknown_product":
                    true_uom = rng.choice(["MTR", "MTR", "KG"])
                if "missing_qty" in gt["flags"]:
                    qty_num = ""
                elif "qty_outlier" in gt["flags"]:
                    qty_num = int(typical_qty(rng, true_uom) * rng.uniform(15, 45))
                else:
                    qty_num = typical_qty(rng, true_uom)

                # ---- uom text ----
                if "uom_convertible" in gt["flags"]:
                    uom_txt = rng.choice(["YDS", "Yards", "yds"])
                elif "uom_incompatible" in gt["flags"]:
                    uom_txt = rng.choice(["KG", "Kgs"]) if true_uom == "MTR" else rng.choice(["MTR", "Mtrs"])
                    if rng.random() < 0.2:
                        uom_txt = rng.choice(["ROLLS", "Bales", "Thaan"])
                else:
                    uom_txt = rng.choice(UOM_TEXT_VARIANTS[true_uom])

                # ---- price ----
                if gt["true_sku"] and gt["match_status"] != "no_match":
                    ref, ref_src, ref_age = reference_price(cust, p, price_history, po_date)
                else:
                    ref, ref_src, ref_age = "", "not_applicable", -1
                if ref == "":
                    quoted = round(p["list_price_inr"] * rng.uniform(0.88, 1.05), 2)
                else:
                    quoted = quote_from_intent(rng, ref, gt["price_intent"])
                if "malformed" in gt["flags"] and rng.random() < 0.5:
                    quoted = ""

            # ---------- price evaluation ----------
            if ref not in ("", None) and quoted not in ("", None):
                delta = round((quoted - ref) / ref * 100, 2)
            else:
                delta = ""
            if gt["match_status"] == "no_match":
                pstat = "not_applicable"
            elif quoted in ("", None):
                pstat = "no_price_quoted"
            elif ref in ("", None):
                pstat = "no_reference_price"
            else:
                pstat = price_status_from_delta(delta, ref_src, quoted)

            exc, action, auto, so_status = resolve(gt["match_status"], pstat, gt["flags"])

            # ---------- expected SO values ----------
            if so_status == "do_not_create":
                exp_qty, exp_uom, exp_price = "", "", ""
            else:
                if "uom_convertible" in gt["flags"] and qty_num != "":
                    exp_qty = round(qty_num / 1.09361, 2)
                else:
                    exp_qty = qty_num
                exp_uom = true_uom
                if pstat in ("outside_tolerance_high", "outside_tolerance_low"):
                    exp_price = ref            # system should propose the reference, not the quote
                elif quoted == "":
                    exp_price = ref
                else:
                    exp_price = quoted
            exp_value = round(exp_qty * exp_price, 2) if (exp_qty not in ("", None) and exp_price not in ("", None)) else ""

            my_lines.append({
                "po_line_id": line_id,
                "po_id": po_id,
                "line_no": ln,
                "customer_item_description": content["description"],
                "customer_item_code": content["customer_item_code"],
                "colour_text": content["colour_text"],
                "gsm_text": content["gsm_text"],
                "width_text": content["width_text"],
                "quantity_text": (rng.choice(["", "", "TBC", "-", "as per stock", "?"])
                                  if "missing_qty" in gt["flags"] else qty_text(rng, qty_num)),
                "uom_text": uom_txt,
                "unit_price_text": price_text(rng, quoted, true_uom),
                "line_remarks": content["remarks"],
                "requested_delivery_date": (po_date + dt.timedelta(days=rng.choice([10, 15, 20, 25, 30, 45]))).isoformat(),
                "scenario_type": scen,
                "difficulty_level": diff,
            })
            my_gt.append({
                "po_line_id": line_id, "po_id": po_id, "customer_id": cust["customer_id"],
                "true_sku": gt["true_sku"] if gt["match_status"] != "no_match" else "",
                "true_product_name": products_by_sku[gt["true_sku"]]["product_name"] if (gt["true_sku"] and gt["match_status"] != "no_match") else "",
                "true_product_family": p["product_family"] if gt["match_status"] != "no_match" else "",
                "extracted_quantity_true": qty_num,
                "extracted_uom_true": uom_txt,
                "extracted_unit_price_true": quoted,
                "expected_so_quantity": exp_qty,
                "expected_so_uom": exp_uom,
                "expected_so_unit_price_inr": exp_price,
                "expected_so_line_value_inr": exp_value,
                "reference_price_inr": ref,
                "reference_price_source": ref_src,
                "reference_price_age_days": ref_age,
                "price_delta_pct": delta,
                "expected_match_status": gt["match_status"],
                "expected_price_status": pstat,
                "expected_exception_type": exc,
                "expected_action": action,
                "should_auto_process": "TRUE" if auto else "FALSE",
                "expected_so_line_status": so_status,
                "expected_confidence_band": CONF_BAND[gt["match_status"]],
                "ambiguous_candidate_skus": "|".join(gt["candidates"]) if gt["candidates"] else "",
                "n_candidate_skus": len(gt["candidates"]),
                "scenario_type": scen,
                "difficulty_level": diff,
                "match_evidence_notes": gt["notes"],
                "_state": {"content": content, "gt": gt, "product": p, "qty_num": qty_num,
                           "uom_txt": uom_txt, "true_uom": true_uom, "quoted": quoted,
                           "ref": ref, "ref_src": ref_src, "ref_age": ref_age},
            })

        scen_list = [l["scenario_type"] for l in my_lines]
        diffs = [l["difficulty_level"] for l in my_lines]
        order = {"easy": 0, "medium": 1, "hard": 2, "exception": 3}
        worst = max(diffs, key=lambda d: order[d])
        worst_scen = my_lines[diffs.index(worst)]["scenario_type"]
        doc_q = "Poor Scan / Handwritten" if "poor_quality_document" in scen_list else (
            "Scanned Copy" if cust["po_channel_preference"] in ("Scanned Copy", "WhatsApp Image")
            else "Clean Digital")
        po_rows.append({
            "po_id": po_id,
            "po_number": po_number,
            "customer_id": cust["customer_id"],
            "po_date": po_date.isoformat(),
            "received_channel": cust["po_channel_preference"],
            "document_quality": doc_q,
            "document_language_mix": "English" if rng.random() < 0.82 else "English + Hindi terms",
            "currency": "INR",
            "payment_terms_days": cust["credit_terms_days"],
            "requested_delivery_date": max(l["requested_delivery_date"] for l in my_lines),
            "ship_to_city": cust["city"],
            "po_line_count": len(my_lines),
            "po_scenario_type": worst_scen,
            "po_difficulty_level": worst,
            "po_scenario_mix": "|".join(sorted(set(scen_list))),
            "distinct_scenarios_in_po": len(set(scen_list)),
            "is_duplicate_po": "Y" if dup_of else "N",
            "duplicate_of_po_id": dup_of or "",
        })
        line_rows.extend(my_lines)
        gt_rows.extend(my_gt)
        return po_id, my_gt

    # primary POs
    pool_i, new_i = 0, 0
    po_state = {}
    for sk in po_skeletons:
        if sk["is_new"]:
            scens = new_scen[new_i:new_i + sk["n_lines"]]
            new_i += sk["n_lines"]
            while len(scens) < sk["n_lines"]:
                scens.append("new_customer_no_history")
        else:
            scens = pool[pool_i:pool_i + sk["n_lines"]]
            pool_i += sk["n_lines"]
            while len(scens) < sk["n_lines"]:
                scens.append("clean_exact_match")
        pid, gts = build_po(sk["customer"], sk["po_date"], scens)
        po_state[pid] = {"customer": sk["customer"], "po_date": sk["po_date"], "gts": gts}

    # duplicate POs (clones of an earlier PO from the same customer, within 10 days)
    dup_candidates = [k for k, v in po_state.items()
                      if 2 <= len(v["gts"]) <= 6
                      and all(g["expected_action"] in ("auto_process", "auto_process_with_flag")
                              for g in v["gts"])]
    dup_sources = rng.sample(dup_candidates, N_DUPLICATE_PO)
    for src_pid in dup_sources:
        st = po_state[src_pid]
        d2 = st["po_date"] + dt.timedelta(days=rng.randint(1, RULES["duplicate_window_days"]))
        src_lines = [g["_state"] for g in st["gts"]]
        build_po(st["customer"], d2, [DUPLICATE_SCENARIO[0]] * len(src_lines),
                 dup_of=src_pid, src_lines=src_lines)

    for g in gt_rows:
        g.pop("_state", None)

    # ---------------- write ----------------
    dfp = pd.DataFrame(products)
    dfc = pd.DataFrame(customers)
    dft = pd.DataFrame(txns)
    dfo = pd.DataFrame(po_rows)
    dfl = pd.DataFrame(line_rows)
    dfg = pd.DataFrame(gt_rows)

    dfp.to_csv(f"{outdir}/product_master.csv", index=False)
    dfc.to_csv(f"{outdir}/customer_master.csv", index=False)
    dft.to_csv(f"{outdir}/transaction_history.csv", index=False)
    dfo.to_csv(f"{outdir}/purchase_orders.csv", index=False)
    dfl.to_csv(f"{outdir}/purchase_order_lines.csv", index=False)
    dfg.to_csv(f"{outdir}/sales_order_ground_truth.csv", index=False)

    print(f"products {len(dfp)} | customers {len(dfc)} | txns {len(dft)} | "
          f"POs {len(dfo)} | lines {len(dfl)} | gt {len(dfg)}")
    print("\nDifficulty mix:")
    print((dfl['difficulty_level'].value_counts(normalize=True) * 100).round(2).to_string())
    print("\nScenario mix:")
    print((dfl['scenario_type'].value_counts(normalize=True) * 100).round(2).to_string())
    print("\nAuto-process share: %.2f%%" % (100 * (dfg['should_auto_process'] == 'TRUE').mean()))
    if fallback_counter:
        print("\nScenario fallbacks applied:", dict(fallback_counter))
    return outdir


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/mnt/user-data/outputs/dataset")
    a = ap.parse_args()
    main(a.out)
