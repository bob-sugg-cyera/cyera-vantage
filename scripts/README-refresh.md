# Cyera Vantage — Collective-layer scheduled refresh

Keeps the **Collective layer** (anonymized cross-customer aggregates) on the
live Cyera Pages dashboard current. Named/entitled data is NOT touched here —
that flows through the BFF, never the static page.

## The pipeline

```
refresh-collective.py                          then (MCP, Claude Code only)
─────────────────────                          ────────────────────────────
1. query CS__CUSTOMER_RISK ⨝ TENANT_ISSUE      4. get_upload_url(page_uid)
   METRICS  (Exposure Index, per cohort)        5. POST dist-singlefile/index.html
2. rewrite COHORT medians+n & netOrgs in           → https://ai-studio.internal.cyera.io/pages/cyera-vantage/
   src/components/CyeraVantage.tsx
3. rebuild dist-singlefile/index.html
```

`page_uid`: `28f4eddf-a0ec-4d49-980e-c938a6c363a2`

## Run it manually

```bash
cd ~/work/cyera-pulse
python3 scripts/refresh-collective.py --dry-run   # see the numbers, no writes
python3 scripts/refresh-collective.py             # rewrite + rebuild
# then upload dist-singlefile/index.html to Pages via cyera-pages MCP
```

## Why this can't be a plain cron / GitHub Action

Both ends are gated to the Claude Code environment **by design** (governance:
customer-data reads go through Bedrock, a Cyera sub-processor):

- `cyera-snowflake.sh` calls `validate_claude_code_only` → hard-exits outside
  Claude Code (`CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT=cli`).
- Cyera Pages upload is **MCP-only** — no CLI for a headless runner.

So the scheduler must run **inside a Claude Code session**. That is what the
harness `CronCreate` job does. Its limitations, stated plainly:

- Fires only while a Claude session is **running and idle**.
- Recurring jobs **auto-expire after 7 days** — re-arm by re-running the
  `/loop` or `CronCreate` step (or just run the script manually).

If a robust always-on cadence is needed later, the correct home is a scheduled
job on **cyera-flux/K8s** using the BFF's own (non-Claude) Snowflake service
account — the same infra ask already tracked in `bff/PLATFORM-ASK.md`.

## Data provenance

- Source: `CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK` ⨝
  `PRODUCT.PRODUCT__TENANT_ISSUE_METRICS` (`CYERA_TENANT_ID = TENANTID`),
  `EXCLUDE_FROM_ANALYTICS = FALSE`.
- Exposure Index (0–100), cohort median of a per-customer score:
  `0.50·(LIVE_SENSITIVE_DATASTORES/LIVE_DATASTORES) + 0.30·ln(1+TOTAL_ISSUES)/ln(50001) + 0.20·(1−SCANNED_PERCENT)`.
- `MIN_COHORT = 10` — a cohort below the floor is skipped and the script
  refuses to write (never publishes a re-identifiable small cohort).
- Industry buckets: fin=Banking and Financial Services, health=Healthcare,
  saas=Technology, retail=Consumer Goods & Services, mfg=Manufacturing & Packaging.
