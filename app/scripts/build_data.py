"""
build_data.py
=============
Converts the course-project CSVs into compact Parquet files that the
frontend reads directly in the browser (via hyparquet). No backend needed.

    python3 scripts/build_data.py            # from the app/ directory

Inputs : ../files/*.csv and "../files (2)"/*.csv (+ po_documents.zip)
Outputs: public/data/*.parquet, public/samples/* (a curated set of PO documents)

Design notes
- Every column is stored as a STRING exactly as written in the CSV. Blank means
  "genuinely absent" in this dataset and must never be coerced to 0/NaN, so the
  browser converts to numbers itself where appropriate.
- Evaluation metadata (scenario_type, difficulty_level, is_duplicate_po, ...)
  is split into separate *_eval files so the agent's inputs never carry labels.
"""
import json
import os
import shutil
import sys
import zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(APP)
REL = os.path.join(ROOT, "files")
DOC = os.path.join(ROOT, "files (2)")
OUT = os.path.join(APP, "public", "data")
SAMPLES = os.path.join(APP, "public", "samples")


def read(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def write(df, name):
    path = os.path.join(OUT, f"{name}.parquet")
    df.to_parquet(path, index=False, compression="snappy")
    print(f"  {name:<22} {len(df):>6} rows  {os.path.getsize(path)/1024:8.1f} KB")


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SAMPLES, exist_ok=True)
    print("Writing parquet ->", OUT)

    write(read(os.path.join(REL, "product_master.csv")), "products")
    write(read(os.path.join(REL, "customer_master.csv")), "customers")
    write(read(os.path.join(REL, "transaction_history.csv")), "transactions")

    po = read(os.path.join(REL, "purchase_orders.csv"))
    po_eval_cols = ["po_scenario_type", "po_difficulty_level", "po_scenario_mix",
                    "distinct_scenarios_in_po", "is_duplicate_po", "duplicate_of_po_id"]
    write(po.drop(columns=po_eval_cols), "purchase_orders")
    write(po[["po_id"] + po_eval_cols], "purchase_orders_eval")

    lines = read(os.path.join(REL, "purchase_order_lines.csv"))
    write(lines.drop(columns=["scenario_type", "difficulty_level"]), "po_lines")

    write(read(os.path.join(REL, "sales_order_ground_truth.csv")), "ground_truth")
    write(read(os.path.join(REL, "dataset_splits.csv")), "splits")

    man = read(os.path.join(DOC, "document_manifest.csv"))
    write(man, "doc_manifest")
    write(read(os.path.join(DOC, "document_header_ground_truth.csv")), "doc_headers")
    write(read(os.path.join(DOC, "document_extraction_ground_truth.csv")), "doc_lines")

    # ---- curated sample documents: one per populated layout x quality cell,
    # preferring short documents so the demo stays snappy ----
    zpath = os.path.join(DOC, "po_documents.zip")
    picked = []
    if os.path.exists(zpath):
        man["n_lines_i"] = man["n_lines"].astype(int)
        man["size_i"] = man["file_size_bytes"].astype(int)
        for (lay, q), g in man.groupby(["layout_id", "quality_id"]):
            g = g[(g.n_lines_i >= 3) & (g.n_lines_i <= 8)].sort_values("size_i")
            if len(g):
                picked.append(g.iloc[0]["document_file"])
        # also keep the hand-picked examples shipped alongside the docs
        for f in os.listdir(DOC):
            if f.startswith("PO") and f.split(".")[-1] in ("pdf", "png", "jpg"):
                if f not in picked:
                    picked.append(f)
        with zipfile.ZipFile(zpath) as z:
            names = {os.path.basename(n): n for n in z.namelist()}
            for f in picked:
                if f in names:
                    with z.open(names[f]) as src, open(os.path.join(SAMPLES, f), "wb") as dst:
                        shutil.copyfileobj(src, dst)
    else:
        for f in os.listdir(DOC):
            if f.startswith("PO") and f.split(".")[-1] in ("pdf", "png", "jpg"):
                shutil.copy(os.path.join(DOC, f), os.path.join(SAMPLES, f))
                picked.append(f)

    # thumbnails for the sample gallery (first page, small JPEG)
    try:
        import pypdfium2 as pdfium
        from PIL import Image
        tdir = os.path.join(SAMPLES, "thumbs")
        os.makedirs(tdir, exist_ok=True)
        for f in picked:
            src = os.path.join(SAMPLES, f)
            if not os.path.exists(src):
                continue
            if f.endswith(".pdf"):
                img = pdfium.PdfDocument(src)[0].render(scale=0.6).to_pil()
            else:
                img = Image.open(src)
            img = img.convert("RGB")
            img.thumbnail((360, 480))
            img.save(os.path.join(tdir, os.path.splitext(f)[0] + ".jpg"), quality=72)
    except ImportError:
        print("  (pypdfium2/Pillow not installed - skipping thumbnails)")

    sample_rows = man[man.document_file.isin(picked)][
        ["po_id", "po_number", "customer_id", "document_file", "file_format", "layout_id",
         "layout_name", "quality_id", "quality_name", "has_text_layer", "n_pages", "n_lines"]]
    sample_rows.to_json(os.path.join(SAMPLES, "index.json"), orient="records", indent=1)
    total = sum(os.path.getsize(os.path.join(SAMPLES, f)) for f in picked
                if os.path.exists(os.path.join(SAMPLES, f)))
    print(f"Copied {len(picked)} sample documents ({total/1e6:.1f} MB) -> {SAMPLES}")


if __name__ == "__main__":
    sys.exit(main())
