"""
validate_dataset.py -- 26 automated checks over the generated CSVs.
Usage: python3 validate_dataset.py <dataset_dir>
Exit code 0 = all checks passed.
"""
import sys
import pandas as pd
import numpy as np

d = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/outputs/dataset"
P = pd.read_csv(f"{d}/product_master.csv")
C = pd.read_csv(f"{d}/customer_master.csv")
T = pd.read_csv(f"{d}/transaction_history.csv")
O = pd.read_csv(f"{d}/purchase_orders.csv")
L = pd.read_csv(f"{d}/purchase_order_lines.csv")
G = pd.read_csv(f"{d}/sales_order_ground_truth.csv")
# pandas infers TRUE/FALSE as bool dtype -- normalise back to the literal strings
G["should_auto_process"] = G["should_auto_process"].astype(str).str.upper()

results = []


def chk(name, cond, detail=""):
    results.append((name, bool(cond), detail))


# ---- 1. volumes -------------------------------------------------------------
chk("V1 product count == 750", len(P) == 750, len(P))
chk("V2 customer count == 150", len(C) == 150, len(C))
chk("V3 transaction count == 7500", len(T) == 7500, len(T))
chk("V4 purchase order count == 1000", len(O) == 1000, len(O))
chk("V5 PO lines within 4750-5250", 4750 <= len(L) <= 5250, len(L))
chk("V6 ground truth rows == PO lines", len(G) == len(L), f"{len(G)} vs {len(L)}")

# ---- 2. primary keys --------------------------------------------------------
chk("K1 sku unique", P.sku.is_unique)
chk("K2 customer_id unique", C.customer_id.is_unique)
chk("K3 transaction_id unique", T.transaction_id.is_unique)
chk("K4 po_id unique", O.po_id.is_unique)
chk("K5 po_line_id unique", L.po_line_id.is_unique)
chk("K6 ground truth keyed 1:1 to lines", set(G.po_line_id) == set(L.po_line_id))

# ---- 3. referential integrity ----------------------------------------------
chk("R1 txn.customer_id -> customer_master", T.customer_id.isin(C.customer_id).all())
chk("R2 txn.sku -> product_master", T.sku.isin(P.sku).all())
chk("R3 po.customer_id -> customer_master", O.customer_id.isin(C.customer_id).all())
chk("R4 po_line.po_id -> purchase_orders", L.po_id.isin(O.po_id).all())
chk("R5 gt.true_sku -> product_master (non-blank)",
    G.true_sku.dropna().isin(P.sku).all(), int(G.true_sku.notna().sum()))
chk("R6 duplicate_of_po_id -> purchase_orders",
    O.loc[O.duplicate_of_po_id.notna(), "duplicate_of_po_id"].isin(O.po_id).all())
chk("R7 po_line_count matches actual lines",
    (L.groupby("po_id").size().sort_index() ==
     O.set_index("po_id").po_line_count.sort_index()).all())
cand = G.ambiguous_candidate_skus.dropna().str.split("|").explode()
chk("R8 all candidate SKUs exist", cand.isin(P.sku).all(), len(cand))

# ---- 4. ground-truth label consistency -------------------------------------
auto_actions = {"auto_process", "auto_process_with_flag"}
chk("L1 should_auto_process <-> action",
    ((G.should_auto_process == "TRUE") == G.expected_action.isin(auto_actions)).all())
chk("L2 no_match => blank true_sku",
    G.loc[G.expected_match_status == "no_match", "true_sku"].isna().all())
nm = G[(G.expected_match_status == "no_match") & (G.scenario_type != "malformed_incomplete_order")]
chk("L3 no_match (excl. malformed) => unknown_product exception",
    (nm.expected_exception_type == "unknown_product").all(), len(nm))
chk("L3b malformed lines => incomplete_line exception",
    (G.loc[G.scenario_type == "malformed_incomplete_order", "expected_exception_type"]
     == "incomplete_line").all())
blocking = {"unknown_product", "missing_quantity", "duplicate_order", "ambiguous_match",
            "conflicting_data", "illegible_document", "incomplete_line", "attribute_conflict",
            "partial_match", "price_variance_major", "uom_mismatch", "quantity_outlier",
            "unmapped_customer_code", "low_confidence_match", "new_customer_no_history"}
chk("L4 auto-processed lines carry no blocking exception",
    (~G.loc[G.should_auto_process == "TRUE", "expected_exception_type"].isin(blocking)).all())
chk("L5 ambiguous => >=2 candidate SKUs",
    (G.loc[G.expected_match_status == "ambiguous_multiple_candidates", "n_candidate_skus"] >= 2).all())
chk("L6 do_not_create => blank expected SO qty/price",
    G.loc[G.expected_so_line_status == "do_not_create",
          ["expected_so_quantity", "expected_so_unit_price_inr"]].isna().all().all())
chk("L7 create_so_line => exception 'none'",
    (G.loc[G.expected_so_line_status == "create_so_line", "expected_exception_type"] == "none").all())
chk("L8 new-customer lines never auto-process",
    (G.merge(C[["customer_id", "is_new_customer"]], on="customer_id")
      .query("is_new_customer=='Y'").should_auto_process == "FALSE").all())

# ---- 5. price logic ---------------------------------------------------------
g = G.dropna(subset=["price_delta_pct", "reference_price_inr"]).copy()
g["recomputed"] = (g.extracted_unit_price_true - g.reference_price_inr) / g.reference_price_inr * 100
chk("P1 price_delta_pct reproducible from ref & quote",
    (g.recomputed - g.price_delta_pct).abs().max() < 0.02, round((g.recomputed - g.price_delta_pct).abs().max(), 5))
live = g[g.reference_price_source == "customer_last_transacted"]
chk("P2 |delta|<=2% on live reference => within_tolerance",
    (live.loc[live.price_delta_pct.abs() <= 2, "expected_price_status"] == "within_tolerance").all())
chk("P3 |delta|>5% => outside_tolerance_*",
    g.loc[g.price_delta_pct.abs() > 5, "expected_price_status"].isin(
        ["outside_tolerance_high", "outside_tolerance_low"]).all())
chk("P4 outside tolerance => expected SO price falls back to reference",
    np.allclose(G.loc[G.expected_price_status.isin(["outside_tolerance_high", "outside_tolerance_low"]),
                      "expected_so_unit_price_inr"].fillna(0),
                G.loc[G.expected_price_status.isin(["outside_tolerance_high", "outside_tolerance_low"]),
                      "reference_price_inr"].fillna(0)))
chk("P5 stale reference age > 180 days",
    (G.loc[G.reference_price_source == "customer_stale_transacted", "reference_price_age_days"] > 180).all())
chk("P6 live reference age <= 180 days",
    (G.loc[G.reference_price_source == "customer_last_transacted", "reference_price_age_days"] <= 180).all())

# ---- 6. history realism -----------------------------------------------------
rep = T.groupby(["customer_id", "sku"]).unit_price_inr.agg(["count", "mean", "std"])
rep = rep[rep["count"] > 1]
cv = (rep["std"] / rep["mean"]).dropna()
chk("H1 >=35% of customer-SKU pairs are repeat purchases",
    len(rep) / T.groupby(["customer_id", "sku"]).ngroups >= 0.35,
    round(len(rep) / T.groupby(["customer_id", "sku"]).ngroups, 3))
chk("H2 repeat prices related but not identical (median CV 0.3%-8%)",
    0.003 <= cv.median() <= 0.08, round(cv.median(), 4))
chk("H3 no zero/negative prices or quantities",
    (T.unit_price_inr > 0).all() and (T.quantity > 0).all())
chk("H4 line_amount = qty * price",
    (T.line_amount_inr - T.quantity * T.unit_price_inr).abs().max() < 0.5)

# ---- 7. scenario / difficulty design ---------------------------------------
dm = L.difficulty_level.value_counts(normalize=True)
chk("S1 easy share 35-45%", 0.35 <= dm.get("easy", 0) <= 0.45, round(dm.get("easy", 0), 3))
chk("S2 medium share 27-37%", 0.27 <= dm.get("medium", 0) <= 0.37, round(dm.get("medium", 0), 3))
chk("S3 hard share 15-25%", 0.15 <= dm.get("hard", 0) <= 0.25, round(dm.get("hard", 0), 3))
chk("S4 exception share 5-12%", 0.05 <= dm.get("exception", 0) <= 0.12, round(dm.get("exception", 0), 3))
chk("S5 all 21 scenarios present", L.scenario_type.nunique() == 21, L.scenario_type.nunique())
chk("S6 multi-scenario POs exist (>=25% of multi-line POs)",
    (O.loc[O.po_line_count > 1, "distinct_scenarios_in_po"] > 1).mean() >= 0.25,
    round((O.loc[O.po_line_count > 1, "distinct_scenarios_in_po"] > 1).mean(), 3))
chk("S7 duplicate POs dated after their source",
    all(O.set_index("po_id").po_date[s] < r.po_date
        for r in O[O.is_duplicate_po == "Y"].itertuples()
        for s in [r.duplicate_of_po_id]))
chk("S8 missing_quantity lines have no parseable quantity",
    L.loc[L.scenario_type == "missing_quantity", "quantity_text"]
     .fillna("").apply(lambda x: not str(x).replace(",", "").replace(".", "").strip().isdigit()).all())
chk("S9 descriptions differ from catalogue names on non-clean lines",
    (L[L.scenario_type != "clean_exact_match"]
     .merge(G[["po_line_id", "true_sku"]], on="po_line_id")
     .merge(P[["sku", "product_name"]], left_on="true_sku", right_on="sku", how="left")
     .eval("customer_item_description == product_name").mean() < 0.02))

# ---- report -----------------------------------------------------------------
w = max(len(n) for n, _, _ in results)
fails = 0
for n, ok, det in results:
    if not ok:
        fails += 1
    print(f"{n:<{w}}  {'PASS' if ok else 'FAIL'}   {det}")
print(f"\n{len(results)-fails}/{len(results)} checks passed.")

print("\n--- Difficulty x auto-process (STP eligibility) ---")
m = L.merge(G[["po_line_id", "should_auto_process", "expected_exception_type"]], on="po_line_id")
print(pd.crosstab(m.difficulty_level, m.should_auto_process, normalize="index").round(3).to_string())
print("\n--- Expected action distribution ---")
print((G.expected_action.value_counts(normalize=True) * 100).round(2).to_string())
print("\n--- Expected exception distribution ---")
print((G.expected_exception_type.value_counts(normalize=True) * 100).round(2).to_string())
print("\n--- Order-level straight-through potential ---")
po_auto = G.groupby("po_id").should_auto_process.apply(lambda s: (s == "TRUE").all())
print(f"POs fully auto-processable: {po_auto.mean()*100:.2f}%")
sys.exit(1 if fails else 0)
