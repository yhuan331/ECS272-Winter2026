"""
analyze_late_stage_bias.py

Detects "late-stage false confidence" — deceased patients where the GNN
predicted RISING survival probability in their final weeks.

Usage:
    python analyze_late_stage_bias.py --ego public/full_va_export_with_linear.json

Output:
    - Console summary (per cohort breakdown)
    - late_stage_bias_report.json  — detailed per-patient results
    - late_stage_bias_flagged.csv  — flat CSV for easy review
"""

import json
import csv
import argparse
import sys
from pathlib import Path
from collections import defaultdict

# ── Config ───────────────────────────────────────────────────────────────────

FINAL_WEEKS      = 4    # how many final weeks to inspect
RISE_THRESHOLD   = 0.01 # min prob increase per week to count as "rising"
MIN_WEEKS        = 6    # skip patients with fewer weeks (not enough data)

# ── Helpers ──────────────────────────────────────────────────────────────────

def load_ego(path: str) -> list[dict]:
    text = Path(path).read_text()
    # strip Python NaN/Infinity artefacts
    text = text.replace("NaN", "null").replace("Infinity", "null").replace("-Infinity", "null")
    data = json.loads(text)
    if isinstance(data, list):
        return data
    # dict keyed by patient id
    return [{"id": k, **v} for k, v in data.items()]


def is_deceased(record: dict) -> bool:
    """
    Infer survival from riskDelta / cohort field or from id prefix.
    The export doesn't include a survived flag directly, so we use
    riskDelta: if prob trended DOWN overall the patient likely declined.
    Better: you can join with labels.csv if available.
    
    For now we flag patients where riskDelta < 0 (prob fell overall)
    AND final prob < 0.5 as likely deceased. Pass --labels to use ground truth.
    """
    # If a 'survived' key was added upstream, use it
    if "survived" in record:
        return not record["survived"]
    # Fallback heuristic: overall risk dropped and ended low
    weekly = record.get("weekly", [])
    if not weekly:
        return False
    final_prob = weekly[-1]["prob"]
    risk_delta = record.get("riskDelta", 0)
    return final_prob < 0.4 and risk_delta < 0


def analyze_final_weeks(weekly: list[dict], n: int = FINAL_WEEKS) -> dict:
    """
    Look at the last N weeks and measure whether prob was rising.
    Returns a dict with:
        rising          bool   — was prob net-rising in final window?
        final_probs     list   — prob values in final N weeks
        week_deltas     list   — week-over-week changes in final window
        net_change      float  — prob[last] - prob[first of window]
        peak_week       int    — week number with highest prob in window
        avg_prob_final  float  — average prob in final window
        avg_prob_early  float  — average prob in first half of timeline
    """
    if len(weekly) < 2:
        return {}

    final   = weekly[-n:] if len(weekly) >= n else weekly
    early   = weekly[: max(1, len(weekly) // 2)]

    final_probs = [w["prob"] for w in final]
    week_nums   = [w["week"] for w in final]
    deltas      = [final_probs[i] - final_probs[i-1] for i in range(1, len(final_probs))]

    net_change     = final_probs[-1] - final_probs[0]
    rising_weeks   = sum(1 for d in deltas if d > RISE_THRESHOLD)
    avg_prob_final = sum(final_probs) / len(final_probs)
    avg_prob_early = sum(w["prob"] for w in early) / len(early)

    # Peak week in final window
    peak_idx  = final_probs.index(max(final_probs))
    peak_week = week_nums[peak_idx]

    return {
        "rising":          net_change > RISE_THRESHOLD or rising_weeks >= (len(deltas) // 2 + 1),
        "net_change":      round(net_change, 4),
        "rising_weeks":    rising_weeks,
        "total_final_wks": len(deltas),
        "final_probs":     [round(p, 4) for p in final_probs],
        "week_deltas":     [round(d, 4) for d in deltas],
        "peak_week":       peak_week,
        "avg_prob_final":  round(avg_prob_final, 4),
        "avg_prob_early":  round(avg_prob_early, 4),
        "false_confidence": avg_prob_final > avg_prob_early,  # model got MORE confident at end
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Detect late-stage false confidence in GNN predictions")
    parser.add_argument("--ego",    default="public/full_va_export_with_linear.json", help="Path to ego export JSON")
    parser.add_argument("--labels", default=None,  help="Optional path to labels.csv (columns: PAT_ID, label) for ground-truth survival")
    parser.add_argument("--out",    default=".",   help="Output directory")
    parser.add_argument("--final-weeks", type=int, default=FINAL_WEEKS, help=f"Final weeks window (default {FINAL_WEEKS})")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load ground truth labels if provided
    ground_truth: dict[str, bool] = {}  # id -> survived (True=alive)
    if args.labels:
        print(f"Loading labels from {args.labels}...")
        with open(args.labels) as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = row.get("PAT_ID") or row.get("id") or ""
                lbl = row.get("label", "0")
                ground_truth[pid.strip()] = str(lbl).strip() == "1"
        print(f"  Loaded {len(ground_truth)} ground-truth labels")

    print(f"Loading ego export from {args.ego}...")
    records = load_ego(args.ego)
    print(f"  Loaded {len(records)} patients")

    # ── Per-patient analysis ─────────────────────────────────────────────────
    results       = []
    cohort_stats  = defaultdict(lambda: {
        "total": 0, "deceased": 0,
        "false_confidence": 0, "rising_final": 0
    })

    for rec in records:
        pid     = rec.get("id", "")
        cohort  = rec.get("cohort", "unknown")
        weekly  = rec.get("weekly", [])

        if len(weekly) < MIN_WEEKS:
            continue

        # Determine if deceased
        if pid in ground_truth:
            survived = ground_truth[pid]
            deceased = not survived
        else:
            deceased = is_deceased(rec)
            survived = not deceased

        cohort_stats[cohort]["total"] += 1
        if deceased:
            cohort_stats[cohort]["deceased"] += 1

        # Analyze final weeks
        fw = analyze_final_weeks(weekly, n=args.final_weeks)
        if not fw:
            continue

        is_false_conf = deceased and fw.get("false_confidence", False)
        is_rising     = deceased and fw.get("rising", False)

        if deceased:
            if is_false_conf:
                cohort_stats[cohort]["false_confidence"] += 1
            if is_rising:
                cohort_stats[cohort]["rising_final"] += 1

        results.append({
            "id":               pid,
            "cohort":           cohort,
            "survived":         survived,
            "deceased":         deceased,
            "total_weeks":      len(weekly),
            "overall_avg_prob": round(rec.get("riskDelta", 0) + weekly[-1]["prob"], 4),
            "final_prob":       round(weekly[-1]["prob"], 4),
            "risk_delta":       round(rec.get("riskDelta", 0), 4),
            "false_confidence": is_false_conf,
            "rising_final_wks": is_rising,
            **{f"fw_{k}": v for k, v in fw.items()},
        })

    # ── Summary ──────────────────────────────────────────────────────────────
    deceased_results = [r for r in results if r["deceased"]]
    flagged          = [r for r in deceased_results if r["false_confidence"]]

    print("\n" + "="*60)
    print("LATE-STAGE FALSE CONFIDENCE ANALYSIS")
    print("="*60)
    print(f"\nPatients analyzed : {len(results)}")
    print(f"Deceased (or low prob): {len(deceased_results)}")
    print(f"False confidence flagged: {len(flagged)}  "
          f"({100*len(flagged)/max(len(deceased_results),1):.1f}% of deceased)\n")

    print("── Per-cohort breakdown ──────────────────────────────")
    print(f"{'Cohort':<20} {'Total':>6} {'Deceased':>9} {'FalseConf':>10} {'%':>6} {'RisingEnd':>10} {'%':>6}")
    print("-" * 65)
    for cohort, s in sorted(cohort_stats.items()):
        dec  = s["deceased"]
        fc   = s["false_confidence"]
        ri   = s["rising_final"]
        pct_fc = 100*fc/max(dec,1)
        pct_ri = 100*ri/max(dec,1)
        print(f"{cohort:<20} {s['total']:>6} {dec:>9} {fc:>10} {pct_fc:>5.1f}% {ri:>10} {pct_ri:>5.1f}%")

    print("\n── Top 10 most egregious false confidence patients ───")
    # Sort by avg_prob_final DESC among flagged (model was most wrong)
    top10 = sorted(flagged, key=lambda r: r.get("fw_avg_prob_final", 0), reverse=True)[:10]
    print(f"{'ID':<15} {'Cohort':<15} {'Weeks':>6} {'FinalProb':>10} {'EarlyAvg':>10} {'NetChg':>8}")
    print("-" * 68)
    for r in top10:
        print(f"{r['id']:<15} {r['cohort']:<15} {r['total_weeks']:>6} "
              f"{r.get('fw_avg_prob_final',0):>10.3f} "
              f"{r.get('fw_avg_prob_early',0):>10.3f} "
              f"{r.get('fw_net_change',0):>+8.3f}")

    # ── Save outputs ──────────────────────────────────────────────────────────
    report_path = out_dir / "late_stage_bias_report.json"
    with open(report_path, "w") as f:
        json.dump({
            "config": {
                "final_weeks":     args.final_weeks,
                "rise_threshold":  RISE_THRESHOLD,
                "min_weeks":       MIN_WEEKS,
            },
            "summary": {
                "total_analyzed":      len(results),
                "total_deceased":      len(deceased_results),
                "false_confidence":    len(flagged),
                "pct_deceased_flagged": round(100*len(flagged)/max(len(deceased_results),1), 1),
            },
            "cohort_stats": dict(cohort_stats),
            "patients":     results,
        }, f, indent=2)
    print(f"\n✅ Full report saved → {report_path}")

    csv_path = out_dir / "late_stage_bias_flagged.csv"
    if flagged:
        keys = list(flagged[0].keys())
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=keys)
            writer.writeheader()
            for row in flagged:
                flat = {k: (json.dumps(v) if isinstance(v, list) else v) for k, v in row.items()}
                writer.writerow(flat)
        print(f"✅ Flagged patients CSV → {csv_path}")

    print(f"\n💡 Tip: Pass --labels labels.csv for ground-truth survival instead of heuristic detection")
    print(f"💡 Tip: Adjust --final-weeks (default {FINAL_WEEKS}) to change the inspection window\n")


if __name__ == "__main__":
    main()