#!/usr/bin/env python3
"""
Cyera Vantage — Collective-layer refresh.

Re-runs the anonymized cross-customer Exposure Index query, rewrites the baked
COHORT snapshot + netOrgs in src/components/CyeraVantage.tsx in place, then
rebuilds the single-file bundle for Cyera Pages.

This is the deterministic core of the scheduled refresh. It ONLY touches the
Collective layer (aggregate medians + counts, no named accounts). Uploading the
rebuilt dist-singlefile/index.html to Cyera Pages is a separate step (MCP-only),
handled by the scheduling wrapper — see scripts/README-refresh.md.

Governance: the Snowflake read goes through cyera-snowflake.sh, which is gated to
the Claude Code environment (Bedrock sub-processor). Do not port this to a plain
cron/CI runner — it will fail that gate by design.

Usage:
  python3 scripts/refresh-collective.py            # query, rewrite, build
  python3 scripts/refresh-collective.py --dry-run  # query + print, no writes
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMPONENT = REPO / "src" / "components" / "CyeraVantage.tsx"
SNOWFLAKE = Path.home() / "claude-workspace/.claude/scripts/cyera-snowflake.sh"

# Industry buckets: SFDC INDUSTRY value -> Vantage cohort key. Fixed mapping;
# display names live in the component and are NOT overwritten by this script.
BUCKET_CASE = """
      WHEN 'Banking and Financial Services' THEN 'fin'
      WHEN 'Healthcare' THEN 'health'
      WHEN 'Technology' THEN 'saas'
      WHEN 'Consumer Goods & Services' THEN 'retail'
      WHEN 'Manufacturing & Packaging' THEN 'mfg'
"""

# Exposure Index formula (0-100), documented in the component's COHORT comment:
#   0.50 * sensitive-datastore share + 0.30 * log-normalized issue burden
# + 0.20 * scan blind spot. Median per cohort. MIN_COHORT floor n >= 10.
COHORT_QUERY = f"""
WITH base AS (
  SELECT
    CASE r.INDUSTRY {BUCKET_CASE} END AS bucket,
    100.0 * (
      0.50 * IFF(r.LIVE_DATASTORES>0, r.LIVE_SENSITIVE_DATASTORES/r.LIVE_DATASTORES, 0)
    + 0.30 * LN(1+COALESCE(m.TOTAL_ISSUES,0))/LN(50001)
    + 0.20 * (1 - COALESCE(r.SCANNED_PERCENT,0))
    ) AS exposure
  FROM CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK r
  LEFT JOIN CYERA_BI_DBT_PROD.PRODUCT.PRODUCT__TENANT_ISSUE_METRICS m
    ON r.CYERA_TENANT_ID = m.TENANTID
  WHERE r.EXCLUDE_FROM_ANALYTICS = FALSE
)
SELECT bucket, COUNT(*) n, ROUND(MEDIAN(exposure)) median
FROM base WHERE bucket IS NOT NULL
GROUP BY 1
"""

NETORGS_QUERY = """
SELECT COUNT(*) net_orgs
FROM CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK
WHERE EXCLUDE_FROM_ANALYTICS = FALSE
"""

MIN_COHORT = 10  # suppress any cohort too small to anonymize


def run_query(sql):
    """Run SQL via the Claude-Code-gated Snowflake CLI, return list-of-dict rows.

    The wrapper hardcodes markdown-table output, so we parse that (header row,
    a `| --- |` separator, then data rows). Values come back as strings.
    """
    res = subprocess.run(
        [str(SNOWFLAKE), "us", sql],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        sys.exit(f"Snowflake query failed:\n{res.stderr}")
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("|")]
    if len(lines) < 2:
        sys.exit(f"Could not parse table from query output:\n{res.stdout}")

    def cells(line):
        return [c.strip() for c in line.strip().strip("|").split("|")]

    header = cells(lines[0])
    rows = []
    for line in lines[2:]:  # skip header + the |---| separator
        rows.append(dict(zip(header, cells(line))))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="query + print, no writes/build")
    args = ap.parse_args()

    cohort_rows = run_query(COHORT_QUERY + " ORDER BY 1")
    net_orgs = int(run_query(NETORGS_QUERY)[0]["NET_ORGS"])

    cohort = {}
    for row in cohort_rows:
        n = int(row["N"])
        if n < MIN_COHORT:
            print(f"  SKIP {row['BUCKET']}: n={n} below MIN_COHORT floor ({MIN_COHORT})")
            continue
        cohort[row["BUCKET"]] = {"median": int(float(row["MEDIAN"])), "n": n}

    print(f"Collective snapshot: netOrgs={net_orgs}")
    for k, v in cohort.items():
        print(f"  {k}: median={v['median']}, n={v['n']}")

    expected = {"fin", "health", "saas", "retail", "mfg"}
    missing = expected - cohort.keys()
    if missing:
        sys.exit(f"Refusing to write: cohort(s) missing/suppressed: {sorted(missing)}. "
                 f"Component expects all of {sorted(expected)}.")

    if args.dry_run:
        print("\n--dry-run: no files written, no build.")
        return

    src = COMPONENT.read_text()

    # Rewrite each cohort's median + n, preserving the display name string.
    for key, v in cohort.items():
        pattern = rf'({key}: {{ name: "[^"]+", median: )\d+(, n: )\d+( }},)'
        repl = rf'\g<1>{v["median"]}\g<2>{v["n"]}\g<3>'
        src, count = re.subn(pattern, repl, src)
        if count != 1:
            sys.exit(f"Refusing to write: expected exactly 1 match for cohort '{key}', got {count}. "
                     f"COHORT block shape changed — update this script's regex.")

    # Rewrite the netOrgs useState default.
    src, count = re.subn(r"(useState\()420(\); // customers contributing)",
                         rf"\g<1>{net_orgs}\g<2>", src)
    # If the previous value isn't literally 420, match any integer default instead.
    if count == 0:
        src, count = re.subn(r"(useState\()\d+(\); // customers contributing)",
                             rf"\g<1>{net_orgs}\g<2>", src)
    if count != 1:
        sys.exit(f"Refusing to write: expected exactly 1 netOrgs match, got {count}.")

    COMPONENT.write_text(src)
    print(f"\nRewrote {COMPONENT.relative_to(REPO)}")

    print("Building single-file bundle...")
    build = subprocess.run(
        ["npx", "vite", "build", "--config", "vite.config.singlefile.ts"],
        cwd=REPO, capture_output=True, text=True,
    )
    if build.returncode != 0:
        sys.exit(f"Build failed:\n{build.stdout}\n{build.stderr}")
    out = REPO / "dist-singlefile" / "index.html"
    print(f"Built {out} ({out.stat().st_size:,} bytes)")
    print("\nNext: upload dist-singlefile/index.html to Cyera Pages (MCP, handled by the scheduler).")


if __name__ == "__main__":
    main()
