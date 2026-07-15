/**
 * Real data source — Snowflake-backed queries for the Entitled + Collective
 * layers. This module is the ONLY place that talks to the warehouse.
 *
 * SECURITY (from ../bff/DATA-ACCESS-SPEC.md):
 *  - Entitled rows are scoped AT THE SOURCE: every my-book query carries a
 *    parameterized  WHERE SE_USER_EMAIL IN (:owners)  — unentitled rows never
 *    leave this process. Never fetch-all-then-filter.
 *  - Collective is aggregate + identity-stripped, with a MIN_COHORT floor.
 *  - The BFF authenticates to Snowflake with ITS OWN service account (provided
 *    by Platform as in-cluster secrets), NOT the Claude Code service account.
 *
 * Entitlement key = SE_USER_EMAIL on CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK
 * (the SE's Cyera email — the identity the access proxy injects).
 */

const snowflake = require("snowflake-sdk");

const MIN_COHORT = 10; // suppress any cohort smaller than this in COLLECTIVE

// Industry label → app pillar/cohort bucket. Anything unmapped is ignored in
// the cohort view (it still counts toward the composite via the raw rows).
const INDUSTRY_BUCKET = {
  "Banking and Financial Services": "fin",
  "Healthcare": "health",
  "Technology": "saas",
  "Consumer Goods & Services": "retail",
  "Manufacturing & Packaging": "mfg",
};
const BUCKET_NAME = {
  fin: "Financial Services",
  health: "Healthcare",
  saas: "SaaS & Technology",
  retail: "Retail & Consumer",
  mfg: "Manufacturing",
};

// Connection is created lazily and reused. Credentials come from env, injected
// as Kubernetes secrets in the cyera-flux deployment — never hardcoded.
let _conn = null;
function connection() {
  if (_conn) return Promise.resolve(_conn);
  return new Promise((resolve, reject) => {
    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT, // e.g. tdb04658.us-east-1
      username: process.env.SNOWFLAKE_USERNAME,
      password: process.env.SNOWFLAKE_PASSWORD,
      role: process.env.SNOWFLAKE_ROLE || "READONLY",
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      database: process.env.SNOWFLAKE_DATABASE || "CYERA_BI_DBT_PROD",
    });
    conn.connect((err, c) => (err ? reject(err) : (resolve((_conn = c)))));
  });
}

function query(sqlText, binds = []) {
  return connection().then(
    (conn) =>
      new Promise((resolve, reject) => {
        conn.execute({
          sqlText,
          binds,
          complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows)),
        });
      })
  );
}

/**
 * [DATA — ENTITLED] The caller's own (or team's) accounts, fully named.
 * Scope is applied as a parameterized WHERE at the source.
 * @param {{ownerEmails: string[]}} scope
 */
async function loadMyBook(scope) {
  const owners = scope.ownerEmails || [];
  if (owners.length === 0) {
    return { generatedAt: new Date().toISOString(), layer: "entitled", accountCount: 0, accounts: [] };
  }
  // Parameterized IN-list — one placeholder per owner, bound positionally.
  const placeholders = owners.map(() => "?").join(", ");
  const rows = await query(
    `SELECT ACCOUNT_NAME, INDUSTRY, ARR, HEALTH_SCORE, SCANNED_PERCENT,
            DAYS_UNTIL_NEXT_RENEWAL, SE_USER_EMAIL, ACCOUNT_TEAM_NAME
       FROM CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK
      WHERE EXCLUDE_FROM_ANALYTICS = FALSE
        AND SE_USER_EMAIL IN (${placeholders})
      ORDER BY ARR DESC NULLS LAST`,
    owners
  );
  return {
    generatedAt: new Date().toISOString(),
    layer: "entitled",
    userId: scope.userId,
    isManager: !!scope.isManager,
    accountCount: rows.length,
    accounts: rows.map((r) => ({
      name: r.ACCOUNT_NAME,
      owner: r.SE_USER_EMAIL,
      industry: INDUSTRY_BUCKET[r.INDUSTRY] || "other",
      industryLabel: r.INDUSTRY,
      arr: r.ARR,
      health: r.HEALTH_SCORE == null ? null : Math.round(r.HEALTH_SCORE * 100),
      coverage: r.SCANNED_PERCENT == null ? null : Math.round(r.SCANNED_PERCENT * 100),
      renewalDays: r.DAYS_UNTIL_NEXT_RENEWAL,
      team: r.ACCOUNT_TEAM_NAME,
    })),
    note: scope.isManager
      ? "Manager scope — your team's books. Named & actionable."
      : "Your book. Named & actionable.",
  };
}

/**
 * [DATA — COLLECTIVE] Aggregate across ALL accounts, identity-stripped, with a
 * min-cohort floor. Same for every caller. The Exposure Index mirrors the
 * documented formula (0.50·sensitive-datastore share + 0.30·log-normalized
 * TOTAL_ISSUES + 0.20·(1−SCANNED_PERCENT)), cohort median.
 */
async function loadCollective() {
  const rows = await query(
    `WITH scored AS (
       SELECT r.INDUSTRY,
         100*(0.50*COALESCE(CASE WHEN r.LIVE_DATASTORES>0
                       THEN LEAST(1, r.LIVE_SENSITIVE_DATASTORES/r.LIVE_DATASTORES) END,0)
            + 0.30*LEAST(1, LN(1+COALESCE(m.TOTAL_ISSUES,0))/LN(50001))
            + 0.20*(1-COALESCE(r.SCANNED_PERCENT,0))) AS exposure
       FROM CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK r
       LEFT JOIN CYERA_BI_DBT_PROD.PRODUCT.PRODUCT__TENANT_ISSUE_METRICS m
         ON m.TENANTID = r.CYERA_TENANT_ID
       WHERE r.EXCLUDE_FROM_ANALYTICS = FALSE AND r.INDUSTRY IS NOT NULL
     )
     SELECT INDUSTRY, COUNT(*) AS N, MEDIAN(exposure) AS MED_EXPOSURE
       FROM scored GROUP BY INDUSTRY`,
    []
  );

  const cohorts = {};
  let netOrgs = 0;
  for (const r of rows) {
    netOrgs += Number(r.N);
    const bucket = INDUSTRY_BUCKET[r.INDUSTRY];
    if (!bucket) continue;
    const n = Number(r.N);
    cohorts[bucket] = {
      name: BUCKET_NAME[bucket],
      n,
      // MIN_COHORT floor: suppress the median if the cohort is too small to anonymize.
      median: n < MIN_COHORT ? null : Math.round(Number(r.MED_EXPOSURE)),
      suppressed: n < MIN_COHORT,
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    layer: "collective",
    minCohort: MIN_COHORT,
    netOrgs,
    cohorts,
    note: "Aggregate & anonymized across all accounts. No account is named. Cohorts under the floor are suppressed.",
  };
}

module.exports = { loadMyBook, loadCollective, MIN_COHORT };
