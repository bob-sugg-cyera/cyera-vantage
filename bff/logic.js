/**
 * Pure business logic for the BFF — NO framework dependencies.
 * Kept separate from server.js so it can be unit-tested in isolation.
 * The security-critical parts are marked; replace STUB/SYNTHETIC internals
 * for production (see notes in each).
 *
 * ── The two-layer model (this is the answer to "everyone benefits from the
 *    whole dataset, but only acts on their own accounts") ──────────────────
 *
 *   COLLECTIVE layer  — aggregates computed across ALL accounts, stripped of
 *                       identity, with a minimum-cohort floor so no single
 *                       customer is re-identifiable. Same for everyone.
 *                       → loadCollective()
 *
 *   ENTITLED layer    — the caller's OWN accounts (or, for a manager, their
 *                       team's), fully named and actionable. Scoped at the
 *                       source by the `owner` field — unentitled rows never
 *                       leave this tier.
 *                       → loadMyBook(scope)
 *
 * The insight engine reads everything to build COLLECTIVE; the ENTITLED layer
 * is filtered to what the caller owns. Aggregate broadly, expose narrowly.
 */

// ---------------------------------------------------------------------------
// SYNTHETIC "all accounts" dataset. In production this is your data source
// (Salesforce for owner/ARR, Vitally for health, DataPort for findings).
// The `owner` field is the entitlement key — the source of truth for who may
// see/act on an account.
// ---------------------------------------------------------------------------
const ALL_ACCOUNTS = [
  { id: "a1", name: "Northwind Health",   owner: "u-bob",    industry: "health", region: "us", arr: 420000, exposure: 88, findings: 1896 },
  { id: "a2", name: "Meridian Capital",   owner: "u-bob",    industry: "fin",    region: "us", arr: 610000, exposure: 74, findings: 1053 },
  { id: "p1", name: "Silverline Group",   owner: "u-priya",  industry: "retail", region: "eu", arr: 240000, exposure: 79, findings: 980  },
  { id: "p2", name: "Ironwood Labs",      owner: "u-priya",  industry: "saas",   region: "us", arr: 300000, exposure: 71, findings: 1220 },
  { id: "m1", name: "Crestview Capital",  owner: "u-marcus", industry: "fin",    region: "us", arr: 190000, exposure: 72, findings: 860  },
  { id: "e1", name: "Anchor Industries",  owner: "u-elena",  industry: "mfg",    region: "eu", arr: 280000, exposure: 55, findings: 610  },
  { id: "e2", name: "Vista Health",       owner: "u-elena",  industry: "health", region: "us", arr: 350000, exposure: 61, findings: 740  },
];

// Managers own their reps' books too. In production this is your org hierarchy.
const TEAM_OF = {
  "u-bob": ["u-bob", "u-priya", "u-marcus", "u-elena"], // Bob manages these reps
};

const MIN_COHORT = 10; // suppress any cohort smaller than this in COLLECTIVE

// [AUTH] STUB — replace with real OIDC/JWT verification (verify signature,
// issuer, audience, expiry against Okta's JWKS). Returns a user or null.
function validateToken(authHeader) {
  const token = (authHeader || "").startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!token) return null;

  const DEMO_USERS = {
    "demo-token-cse":     { sub: "u-priya", name: "Priya Nair", role: "cse" },
    "demo-token-manager": { sub: "u-bob",   name: "Bob Sugg",   role: "manager" },
    // legacy demo tokens kept so existing curl examples still work
    "demo-token-analyst": { sub: "u-priya", name: "Analyst", role: "cse" },
    "demo-token-admin":   { sub: "u-bob",   name: "Admin",   role: "manager" },
  };
  return DEMO_USERS[token] || null;
}

// [AUTH — PRODUCTION] Trust the identity injected by the access proxy that
// fronts internal Cyera apps. The proxy terminates Okta auth BEFORE the request
// reaches us and sets a header with the authenticated user's email; the BFF
// must NOT be reachable except through that proxy (enforced by the ingress /
// NetworkPolicy in cyera-flux, not by this code).
//
// UNKNOWN — the exact header name the Cyera access proxy injects. It is
// configurable via IDENTITY_HEADER; the default below is the common
// oauth2-proxy convention and MUST be confirmed with Platform/IT before
// go-live. If the proxy also injects a signature/JWT to verify, add that check
// here — do not trust a bare header on a route the proxy doesn't exclusively front.
function identityFromProxy(req, headerName = process.env.IDENTITY_HEADER || "x-auth-request-email") {
  const email = (req.headers[headerName.toLowerCase()] || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return { email, name: email.split("@")[0] };
}

// [ENTITLE — PRODUCTION] Resolve the caller's entitled scope from their email.
// A CSE sees the accounts where they are the SE (SE_USER_EMAIL = them). Manager
// hierarchy is a WIDER scope: expand `email` to the set of report emails.
// UNKNOWN — the manager→reports mapping source. Until Platform confirms whether
// Okta groups model this (preferred) or we need an entitlements table, this
// returns the single-owner scope. managerReports (optional) lets the caller
// inject a resolved report list without changing this signature.
function scopeFromEmail(email, { managerReports = null } = {}) {
  const ownerEmails = managerReports && managerReports.length
    ? Array.from(new Set([email, ...managerReports.map((e) => e.toLowerCase())]))
    : [email];
  return {
    userId: email,
    isManager: !!(managerReports && managerReports.length),
    ownerEmails, // whose accounts this caller may see — bound into the WHERE at the source
  };
}

// [ENTITLE] STUB — replace with a real entitlement lookup (org hierarchy +
// account ownership). Returns the set of account IDs the caller may see/act on.
// A CSE gets their own book; a manager gets their whole team's.
function scopeForUser(user) {
  const ownerIds =
    user.role === "manager" && TEAM_OF[user.sub]
      ? TEAM_OF[user.sub]
      : [user.sub];
  const accountIds = ALL_ACCOUNTS
    .filter((a) => ownerIds.includes(a.owner))
    .map((a) => a.id);
  return {
    userId: user.sub,
    isManager: user.role === "manager",
    ownerIds,       // whose accounts this caller may see
    accountIds,     // the resolved entitled account IDs
  };
}

// [DATA — COLLECTIVE] Aggregates across ALL accounts, identity-stripped, with
// a min-cohort floor. SAME for every caller — this is the "benefit from the
// whole base" layer. No account name ever appears here.
function loadCollective() {
  // group by industry cohort
  const byIndustry = {};
  for (const a of ALL_ACCOUNTS) {
    (byIndustry[a.industry] = byIndustry[a.industry] || []).push(a);
  }
  const cohorts = Object.entries(byIndustry).map(([industry, accts]) => {
    const n = accts.length;
    const medianExposure = Math.round(
      accts.reduce((s, x) => s + x.exposure, 0) / n
    );
    return {
      industry,
      // NOTE: real cohorts must clear MIN_COHORT. Here n is tiny (synthetic),
      // so we report `suppressed` honestly rather than leak a 1–2 org "cohort".
      cohortSize: n,
      suppressed: n < MIN_COHORT,
      medianExposure: n < MIN_COHORT ? null : medianExposure,
    };
  });
  const totalArr = ALL_ACCOUNTS.reduce((s, a) => s + a.arr, 0);
  const compositeIndex = Math.round(
    ALL_ACCOUNTS.reduce((s, a) => s + a.exposure * (a.arr / totalArr), 0)
  );
  return {
    generatedAt: new Date().toISOString(),
    layer: "collective",
    minCohort: MIN_COHORT,
    compositeIndex,          // ARR-weighted, whole base
    cohorts,                 // per-industry, suppressed if under floor
    note: "Aggregate & anonymized across all accounts. No account is named. Cohorts under the floor are suppressed.",
  };
}

// [DATA — ENTITLED] The caller's own (or team's) accounts, fully named.
// Scope MUST be applied as a filter — in production this is a WHERE clause at
// the source (WHERE owner IN scope.ownerIds); unentitled rows never load here.
function loadMyBook(scope) {
  const mine = ALL_ACCOUNTS.filter((a) => scope.accountIds.includes(a.id));
  return {
    generatedAt: new Date().toISOString(),
    layer: "entitled",
    userId: scope.userId,
    isManager: scope.isManager,
    accountCount: mine.length,
    accounts: mine.map((a) => ({
      id: a.id,
      name: a.name,      // named — the caller owns these
      owner: a.owner,
      industry: a.industry,
      arr: a.arr,
      exposure: a.exposure,
      findings: a.findings,
    })),
    note: scope.isManager
      ? "Manager scope — your team's books. Named & actionable."
      : "Your book. Named & actionable.",
  };
}

// [LEGACY] Kept so the original /api/metrics + curl examples keep working.
// Prefer loadCollective() + loadMyBook() for the two-layer model.
function loadMetrics(scope, rnd = Math.random) {
  const collective = loadCollective();
  const book = loadMyBook(scope);
  return {
    generatedAt: collective.generatedAt,
    scope,
    kpis: {
      recordsSecured: 2_400_000_000,
      dataStores: 1847,
      openFindings: book.accounts.reduce((n, a) => n + a.findings, 0),
      coveragePct: 96,
    },
    compositeIndex: collective.compositeIndex,
    myAccounts: book.accounts,
    cohorts: collective.cohorts,
  };
}

module.exports = {
  validateToken,
  identityFromProxy,
  scopeForUser,
  scopeFromEmail,
  loadCollective,
  loadMyBook,
  loadMetrics,
};
