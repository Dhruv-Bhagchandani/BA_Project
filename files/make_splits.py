"""
make_splits.py -- recommended train / validation / test split.

Rules:
 1. Split at PURCHASE ORDER level, never at line level. A PO is one document;
    splitting its lines would leak document-level context (and the same OCR
    quality, customer and date) across folds.
 2. A duplicate PO and its source PO always land in the SAME split, otherwise
    duplicate detection is untestable in one fold and trivially leaked in the other.
 3. Stratified on po_difficulty_level so every fold carries the same easy /
    medium / hard / exception mix.
 4. A parallel temporal holdout flag is emitted for a stricter, deployment-like
    evaluation (train on older POs, test on the newest ones).
"""
import sys
import random
import pandas as pd

d = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/outputs"
SEED = 20260826
rng = random.Random(SEED)

O = pd.read_csv(f"{d}/purchase_orders.csv")

# group duplicate POs with their source
group = {}
for r in O.itertuples():
    group[r.po_id] = r.duplicate_of_po_id if isinstance(r.duplicate_of_po_id, str) and r.duplicate_of_po_id else r.po_id
O["group_key"] = O.po_id.map(group)

grp = (O.groupby("group_key")
         .agg(difficulty=("po_difficulty_level",
                          lambda s: max(s, key=lambda x: {"easy": 0, "medium": 1, "hard": 2, "exception": 3}[x])))
         .reset_index())

assign = {}
for diff, sub in grp.groupby("difficulty"):
    keys = sub.group_key.tolist()
    rng.shuffle(keys)
    n = len(keys)
    n_tr, n_va = int(round(0.60 * n)), int(round(0.20 * n))
    for i, k in enumerate(keys):
        assign[k] = "train" if i < n_tr else ("validation" if i < n_tr + n_va else "test")

O["split"] = O.group_key.map(assign)
cutoff = pd.to_datetime(O.po_date).quantile(0.85)
O["is_temporal_holdout"] = (pd.to_datetime(O.po_date) >= cutoff).map({True: "Y", False: "N"})
O["temporal_split"] = O.is_temporal_holdout.map({"Y": "test_temporal", "N": "train_temporal"})

out = O[["po_id", "customer_id", "po_date", "po_difficulty_level", "group_key",
         "split", "temporal_split", "is_temporal_holdout"]]
out.to_csv(f"{d}/dataset_splits.csv", index=False)

L = pd.read_csv(f"{d}/purchase_order_lines.csv").merge(out[["po_id", "split"]], on="po_id")
print("POs per split:\n", O.split.value_counts().to_string())
print("\nLines per split:\n", L.split.value_counts().to_string())
print("\nDifficulty mix by split (%):")
print((pd.crosstab(L.split, L.difficulty_level, normalize="index") * 100).round(1).to_string())
print(f"\nTemporal cutoff: {cutoff.date()}  |  holdout POs: {(O.is_temporal_holdout=='Y').sum()}")
