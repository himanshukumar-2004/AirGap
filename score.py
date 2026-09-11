#!/usr/bin/env python3
"""
score.py — computes real precision/recall/latency numbers for the AirGap
Metrics Snapshot slide, from data you capture yourself while running the
extension against golden-test-pages/.

WHY THIS EXISTS
----------------
You cannot get honest numbers by eyeballing the redacted page. You need to:
  1. Run the extension against each golden test page.
  2. Copy the SANITIZED PAYLOAD (the text actually sent to /orchestrate) out
     of DevTools Network tab (or a debug log if you added one) into a file.
  3. Run this script to compare that payload against answer_key.json.

That gives you a defensible number instead of an estimate.

HOW TO CAPTURE THE DATA
------------------------
1. Open the golden test page in the browser with the extension installed.
2. Open DevTools -> Network tab, BEFORE running the agent.
3. Trigger the agent / redaction on that page.
4. Find the request to /orchestrate, open its Request Payload / Preview.
5. Copy the sanitized text content out and paste it into
   captured/<page-filename>.txt (one file per test page, plain text is fine).
6. Repeat for every golden test page.
7. Also note the timestamp deltas you print to console at each tier boundary
   (see the performance.now() snippet in README-testing.md) into
   captured/timings.json.
8. Run:  python3 score.py

WHAT IT COMPUTES
------------------
- Recall  = (positives correctly redacted) / (total positives in answer key)
- Precision = (positives correctly redacted) / (positives correctly redacted + negatives wrongly redacted)
- Reports per-page AND an aggregate across all pages.
- If captured/timings.json exists, also reports per-tier latency stats.
"""

import json
import os
import sys
import statistics

BASE = os.path.dirname(os.path.abspath(__file__))
ANSWER_KEY_PATH = os.path.join(BASE, "golden-test-pages", "answer_key.json")
CAPTURED_DIR = os.path.join(BASE, "captured")
TIMINGS_PATH = os.path.join(CAPTURED_DIR, "timings.json")


def load_answer_key():
    with open(ANSWER_KEY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_captured_payload(page_filename):
    """
    Looks for captured/<page_filename_without_ext>.txt containing the
    SANITIZED payload text you copied from DevTools Network tab.
    """
    stem = os.path.splitext(page_filename)[0]
    path = os.path.join(CAPTURED_DIR, f"{stem}.txt")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def score_page(page_name, entry, captured_text):
    positives = entry.get("positives", [])
    negatives = entry.get("negatives", [])

    # A positive is "correctly redacted" if the raw string is ABSENT from the
    # sanitized payload (i.e. it got replaced with a token and did not leak).
    tp = sum(1 for s in positives if s not in captured_text)
    fn = len(positives) - tp  # leaked PII — the dangerous kind of miss

    # A negative is "wrongly redacted" if it's ALSO absent (over-redaction /
    # false positive) — costly for usability, not for privacy, but still
    # worth tracking since the rubric weights precision too.
    fp = sum(1 for s in negatives if s not in captured_text)
    tn = len(negatives) - fp

    recall = tp / len(positives) if positives else None
    precision = tp / (tp + fp) if (tp + fp) > 0 else None

    return {
        "page": page_name,
        "true_positives": tp,
        "false_negatives_LEAKED_PII": fn,
        "false_positives_over_redacted": fp,
        "true_negatives": tn,
        "recall": recall,
        "precision": precision,
        "leaked_items": [s for s in positives if s in captured_text],
    }


def main():
    answer_key = load_answer_key()
    os.makedirs(CAPTURED_DIR, exist_ok=True)

    results = []
    missing = []
    for page_name, entry in answer_key.items():
        if page_name.startswith("_"):
            continue
        captured = load_captured_payload(page_name)
        if captured is None:
            missing.append(page_name)
            continue
        results.append(score_page(page_name, entry, captured))

    if missing:
        print("Missing captured payloads for these pages — put the sanitized")
        print("network payload text into captured/<name>.txt for each:")
        for m in missing:
            print(f"  - {m}")
        print()

    if not results:
        print("No results yet. Capture at least one page's payload first.")
        print(f"Expected files under: {CAPTURED_DIR}/")
        sys.exit(0)

    print("=" * 70)
    print("PER-PAGE RESULTS")
    print("=" * 70)
    for r in results:
        print(f"\n{r['page']}")
        print(f"  Recall:    {fmt_pct(r['recall'])}")
        print(f"  Precision: {fmt_pct(r['precision'])}")
        if r["leaked_items"]:
            print(f"  ⚠ LEAKED (appeared in sanitized payload, should not have):")
            for item in r["leaked_items"]:
                print(f"      - {item!r}")

    total_tp = sum(r["true_positives"] for r in results)
    total_fn = sum(r["false_negatives_LEAKED_PII"] for r in results)
    total_fp = sum(r["false_positives_over_redacted"] for r in results)

    agg_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else None
    agg_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else None

    print("\n" + "=" * 70)
    print("AGGREGATE — use these on the Metrics Snapshot slide")
    print("=" * 70)
    print(f"  PII detection recall:    {fmt_pct(agg_recall)}")
    print(f"  PII detection precision: {fmt_pct(agg_precision)}")

    if os.path.exists(TIMINGS_PATH):
        print_latency_report()
    else:
        print(f"\n(No {TIMINGS_PATH} found — see README-testing.md to capture")
        print(" per-tier latency via performance.now() and add it there.)")


def fmt_pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def print_latency_report():
    with open(TIMINGS_PATH, "r", encoding="utf-8") as f:
        runs = json.load(f)
    # Expected shape: list of {"tier0_ms":.., "tier1_ms":.., "tier2_ms":.., "e2e_ms":..}
    print("\n" + "=" * 70)
    print("LATENCY (from captured/timings.json)")
    print("=" * 70)
    for key in ["tier0_ms", "tier1_ms", "tier2_ms", "e2e_ms"]:
        vals = [r[key] for r in runs if key in r]
        if not vals:
            continue
        print(f"  {key}: mean={statistics.mean(vals):.1f}ms  "
              f"median={statistics.median(vals):.1f}ms  "
              f"max={max(vals):.1f}ms  n={len(vals)}")


if __name__ == "__main__":
    main()
