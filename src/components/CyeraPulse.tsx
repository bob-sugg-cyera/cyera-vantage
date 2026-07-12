import React, { useState, useEffect, useRef, useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip, Line, LineChart, ComposedChart, ReferenceLine } from "recharts";
import cyeraLogo from "../assets/cyera-logo.svg";
import { getMetrics, CONN, DATA_CONFIG } from "../data/source";

/* ---------------------------------------------------------
   Cyera Pulse — Collective Risk Intelligence (demo / prototype)
   Synthetic data simulating aggregated, anonymized cross-customer
   exposure signal. Wire to real pipeline (finding events, industry
   metadata) to replace the generators below.

   Palette: Cyera Employee Brand Kit (2026).
   - Chrome (bg, panels, text, accents) uses brand colors.
   - Risk status uses Lime (baseline / brand accent) plus functional
     amber/coral for Watch/Elevated. Amber & coral are NOT brand
     colors — they're retained as universal risk-status semantics
     (green -> amber -> red), since the brand kit has no status set.
--------------------------------------------------------- */

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

/* Signal-by-Industry grid — responsive, always balanced (no orphan card).
   5 across on desktop, 3 / 2 / 1 as the viewport narrows. */
.pulse-industry-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}
@media (max-width: 900px) {
  .pulse-industry-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 620px) {
  .pulse-industry-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 420px) {
  .pulse-industry-grid { grid-template-columns: 1fr; }
}

/* Kill the browser focus ring on clickable custom elements (we show our own
   lilac active state instead). Covers the white/blue outline that lingers
   after clicking a pillar tile. */
.pulse-clickable:focus,
.pulse-clickable:focus-visible,
.pulse-clickable:active {
  outline: none !important;
}

/* Platform-coverage grid — 5 pillars across, collapsing responsively. */
.pulse-pillar-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
@media (max-width: 900px) { .pulse-pillar-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 620px) { .pulse-pillar-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 420px) { .pulse-pillar-grid { grid-template-columns: 1fr; } }
`;

const INDUSTRIES = [
  { key: "fin", name: "Financial Services", base: 58 },
  { key: "health", name: "Healthcare", base: 71 },
  { key: "saas", name: "SaaS & Technology", base: 44 },
  { key: "retail", name: "Retail & Consumer", base: 39 },
  { key: "mfg", name: "Manufacturing", base: 33 },
];

/* Cyera's five platform pillars (from the product architecture: Protect Data
   → DSPM + Omni DLP; Govern Access → Access Trail; Secure AI → AI-SPM + AI
   Protect). Every risk signal in Pulse is tagged to a pillar so the platform
   is holistic — data at rest, in motion, and in use. */
const PILLARS = {
  dspm: { key: "dspm", name: "DSPM", group: "Protect Data", blurb: "Data security posture — where sensitive data is exposed" },
  dlp: { key: "dlp", name: "Omni DLP", group: "Protect Data", blurb: "Data in motion — exfiltration and DLP signal" },
  access: { key: "access", name: "Access Trail", group: "Govern Access", blurb: "Who accesses data — human and non-human" },
  aispm: { key: "aispm", name: "AI-SPM", group: "Secure AI", blurb: "Shadow AI discovery and AI data access posture" },
  aiprotect: { key: "aiprotect", name: "AI Protect", group: "Secure AI", blurb: "Sensitive data leaking into AI, in the moment" },
};
const PILLAR_ORDER = ["dspm", "dlp", "access", "aispm", "aiprotect"];

/* Finding types tagged by pillar — vocabulary grounded in the Cyera KB. */
const FINDING_TYPES = [
  // DSPM (data at rest)
  { label: "public sharing links in Microsoft 365", pillar: "dspm" },
  { label: "over-permissioned S3 buckets", pillar: "dspm" },
  { label: "stale PII in non-production environments", pillar: "dspm" },
  { label: "unencrypted PHI in file shares", pillar: "dspm" },
  { label: "unrotated credentials in Salesforce", pillar: "dspm" },
  { label: "exposed API keys in cloud storage", pillar: "dspm" },
  // Omni DLP (data in motion)
  { label: "sensitive data exfiltration over unmonitored egress", pillar: "dlp" },
  { label: "high false-positive DLP alert volume (alert fatigue)", pillar: "dlp" },
  // Access Trail (govern access)
  { label: "orphaned identities with standing access", pillar: "access" },
  { label: "anomalous access surge / mass downloads (insider risk)", pillar: "access" },
  { label: "external identities accessing sensitive data", pillar: "access" },
  // AI-SPM (secure AI — posture)
  { label: "shadow AI: unapproved ChatGPT / personal accounts", pillar: "aispm" },
  { label: "unsanctioned custom AI tool with data access", pillar: "aispm" },
  // AI Protect (secure AI — in use)
  { label: "sensitive data pasted into public AI prompts", pillar: "aiprotect" },
  { label: "LLM accessing unauthorized data (Copilot)", pillar: "aiprotect" },
];

const SIZES = ["under 1,000 employees", "1,000–5,000 employees", "5,000+ employees"];

/* Cohort filter options. "all" = no filter. Regions are short codes on each
   account; label map keeps the chips readable. */
const SIZE_FILTERS = ["all", ...SIZES];
const REGIONS = ["all", "NA", "EMEA", "APAC"];
const REGION_LABEL = { all: "All regions", NA: "North America", EMEA: "EMEA", APAC: "APAC" };
const SIZE_LABEL = {
  all: "All sizes",
  "under 1,000 employees": "< 1K",
  "1,000–5,000 employees": "1K–5K",
  "5,000+ employees": "5K+",
};

/* Per-industry peer cohort: median exposure (base) + cohort size (n).
   In production these come from the anonymized cross-customer aggregate. */
const COHORT = {
  fin: { name: "Financial Services", median: 58, n: 143 },
  health: { name: "Healthcare", median: 71, n: 96 },
  saas: { name: "SaaS & Technology", median: 44, n: 210 },
  retail: { name: "Retail & Consumer", median: 39, n: 118 },
  mfg: { name: "Manufacturing", median: 33, n: 74 },
};

const PEER_SIGMA = 15; // spread of the peer distribution (synthetic)

/* Synthetic "my book of business" — the accounts a CSE owns.
   Internal view names them; the customer-safe view would suppress names.
   Field sources for real wiring:
     arr, renewalDays, size  -> Salesforce (account + opportunity)
     health                  -> Vitally (0–100 health score)
     coverage                -> DataPort (% of estimated data scanned)
     score, findings         -> DataPort finding aggregates */
const BOOK = [
  {
    id: "a1", name: "Northwind Health", industry: "health", size: "1,000–5,000 employees", region: "NA",
    score: 88, arr: 420000, renewalDays: 52, health: 41, coverage: 78,
    findings: [
      { label: "Unencrypted PHI in file shares", count: 1420, trend: 22, pillar: "dspm" },
      { label: "Public sharing links in Microsoft 365", count: 380, trend: 14, pillar: "dspm" },
      { label: "Sensitive data pasted into public AI prompts", count: 210, trend: 44, pillar: "aiprotect" },
      { label: "Shadow AI: unapproved ChatGPT accounts", count: 63, trend: 28, pillar: "aispm" },
      { label: "Orphaned identities with standing access", count: 96, trend: -3, pillar: "access" },
    ],
    play: "Top-decile PHI exposure for Healthcare peers, low health, renewal <60d — highest-priority account. Also seeing fast-rising AI risk (PHI in prompts +44%, shadow ChatGPT). Lead the QBR with the peer benchmark, scope a file-share remediation sprint, and open the AI-exposure conversation.",
  },
  {
    id: "a2", name: "Meridian Capital", industry: "fin", size: "5,000+ employees", region: "NA",
    score: 74, arr: 610000, renewalDays: 118, health: 62, coverage: 91,
    findings: [
      { label: "Exposed API keys in cloud storage", count: 210, trend: 31, pillar: "dspm" },
      { label: "Unrotated credentials in Salesforce", count: 640, trend: 9, pillar: "dspm" },
      { label: "Sensitive data exfiltration over unmonitored egress", count: 74, trend: 19, pillar: "dlp" },
      { label: "LLM accessing unauthorized data (Copilot)", count: 41, trend: 22, pillar: "aiprotect" },
      { label: "Over-permissioned S3 buckets", count: 88, trend: -6, pillar: "dspm" },
    ],
    play: "Largest ARR in the book; API-key exposure spiking (+31%) above the Financial Services median, plus rising DLP egress and Copilot over-access. Flag to the security champion; propose credential rotation, a DLP egress review, and an AI-access scoping check.",
  },
  {
    id: "a3", name: "Cobalt Systems", industry: "saas", size: "under 1,000 employees", region: "EMEA",
    score: 39, arr: 95000, renewalDays: 240, health: 88, coverage: 84,
    findings: [
      { label: "Stale PII in non-production environments", count: 150, trend: 4, pillar: "dspm" },
      { label: "Unsanctioned custom AI tool with data access", count: 38, trend: 12, pillar: "aispm" },
      { label: "Public sharing links in Microsoft 365", count: 62, trend: -8, pillar: "dspm" },
    ],
    play: "Below-median exposure, high health — healthy overall. One watch item: a homegrown AI tool touching data (AI-SPM). Use as a reference account; note the shadow-AI finding as a light-touch expansion hook.",
  },
  {
    id: "a4", name: "Harbor Point Retail", industry: "retail", size: "1,000–5,000 employees", region: "NA",
    score: 52, arr: 180000, renewalDays: 74, health: 55, coverage: 46,
    findings: [
      { label: "Over-permissioned S3 buckets", count: 240, trend: 18, pillar: "dspm" },
      { label: "External identities accessing sensitive data", count: 130, trend: 21, pillar: "access" },
      { label: "Stale PII in non-production environments", count: 190, trend: 11, pillar: "dspm" },
    ],
    play: "Above the Retail median with rising S3 exposure AND only 46% scan coverage — score understates real risk. External-identity access is climbing too. Prioritize finishing the scan, then run an access review (Access Trail).",
  },
  {
    id: "a5", name: "Atlas Manufacturing", industry: "mfg", size: "5,000+ employees", region: "APAC",
    score: 41, arr: 260000, renewalDays: 33, health: 49, coverage: 88,
    findings: [
      { label: "Orphaned identities with standing access", count: 310, trend: 15, pillar: "access" },
      { label: "Anomalous access surge / mass downloads (insider risk)", count: 52, trend: 26, pillar: "access" },
      { label: "Over-permissioned S3 buckets", count: 74, trend: 2, pillar: "dspm" },
    ],
    play: "Renewal in 33 days with middling health — time-sensitive. Access-Trail risk is the story here: standing access up and an anomalous download surge (insider-risk signal). Recommend an identity clean-up + Access Trail review ahead of the renewal.",
  },
  {
    id: "a6", name: "Cedar Trust Bank", industry: "fin", size: "1,000–5,000 employees", region: "EMEA",
    score: 47, arr: 145000, renewalDays: 198, health: 79, coverage: 82,
    findings: [
      { label: "Unrotated credentials in Salesforce", count: 120, trend: -12, pillar: "dspm" },
      { label: "High false-positive DLP alert volume (alert fatigue)", count: 210, trend: 7, pillar: "dlp" },
      { label: "Public sharing links in Microsoft 365", count: 45, trend: 3, pillar: "dspm" },
    ],
    play: "Below the Financial Services median, improving, healthy — steady state. Main friction is DLP alert fatigue (Omni DLP tuning opportunity). Reinforce the win and offer a policy-tuning session as a value-add.",
  },
];

const fmtArr = (n) =>
  n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

/* Priority = exposure percentile × dollars × renewal urgency × health drag.
   A single 0–100 worklist score. Weights default to a synthetic first cut but
   are adjustable at runtime (see the weight sliders) — the "tune with the team"
   conversation, made live. Weights are normalized so the score stays 0–100
   regardless of the raw slider values. Returns score + the driving factors. */
const DEFAULT_WEIGHTS = { exposure: 0.4, dollars: 0.25, urgency: 0.2, health: 0.15 };

function priorityScore(acct, weights = DEFAULT_WEIGHTS) {
  const pct = percentile(acct.score, acct.industry);        // 0–100, higher = worse
  const exposure = pct / 100;                                // 0–1
  const dollars = Math.min(1, acct.arr / 600000);            // normalized to book max-ish
  const urgency = Math.max(0, Math.min(1, (180 - acct.renewalDays) / 180)); // sooner = higher
  const healthDrag = (100 - acct.health) / 100;              // lower health = higher
  const wSum = weights.exposure + weights.dollars + weights.urgency + weights.health || 1;
  const raw =
    (weights.exposure * exposure +
      weights.dollars * dollars +
      weights.urgency * urgency +
      weights.health * healthDrag) /
    wSum;
  return { value: Math.round(raw * 100), pct, exposure, dollars, urgency, healthDrag };
}

/* ---- Industry neural-graph data (internal view — real accounts named) ----
   Deterministic layout: a seeded PRNG keyed off the industry so the graph is
   stable across re-renders (the live tick must not reshuffle nodes). */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return h >>> 0;
}

const PEER_NAMES = [
  "Vertex", "Summit", "Ironclad", "Brightline", "Keystone", "Nimbus", "Aegis",
  "Lattice", "Beacon", "Cascade", "Halcyon", "Meridian", "Sable", "Onyx",
  "Pinnacle", "Quill", "Radian", "Solstice", "Tessera", "Umbra", "Vantage",
  "Wexford", "Ardent", "Cobalt", "Dune",
];
const PEER_SUFFIX = { fin: "Capital", health: "Health", saas: "Labs", retail: "Group", mfg: "Industries" };

/* Build up to `maxPeers` synthetic peer nodes + the real book accounts for an
   industry. Real accounts carry their true name/score; peers are anonymized. */
function industryGraph(industryKey, maxPeers = 14) {
  const rnd = mulberry32(seedFromKey(industryKey));
  const median = COHORT[industryKey].median;

  const mine = BOOK.filter((a) => a.industry === industryKey).map((a) => ({
    id: a.id,
    label: a.name,
    score: a.score,
    arr: a.arr,
    mine: true,
  }));

  const peers = [];
  const used = new Set();
  for (let i = 0; i < maxPeers; i++) {
    // synthetic score ~ normal-ish around the cohort median
    const g = (rnd() + rnd() + rnd() - 1.5) / 1.5; // ~[-1,1] bell
    const score = Math.max(8, Math.min(96, Math.round(median + g * PEER_SIGMA)));
    let ni = Math.floor(rnd() * PEER_NAMES.length);
    while (used.has(ni)) ni = (ni + 1) % PEER_NAMES.length;
    used.add(ni);
    peers.push({
      id: `${industryKey}-p${i}`,
      label: `${PEER_NAMES[ni]} ${PEER_SUFFIX[industryKey]}`,
      score,
      arr: Math.round((40 + rnd() * 560) * 1000),
      mine: false,
    });
  }
  return [...mine, ...peers];
}

function priorityTier(v) {
  if (v >= 60) return { label: "ACT NOW", color: "var(--coral)" };
  if (v >= 40) return { label: "SOON", color: "var(--amber)" };
  return { label: "STEADY", color: "var(--lime)" };
}

const pillarName = (key) => (PILLARS[key] ? PILLARS[key].name : "—");

/* ---- Real Composite Risk Index — a true roll-up across all 5 pillars ----
   The headline number is the ARR-weighted average of account exposure, so it
   genuinely reflects DSPM + Omni DLP + Access Trail + AI-SPM + AI Protect
   findings (each account's `score` already reflects its cross-pillar findings).
   Also returns each account's contribution so the decompose panel reconciles. */
function computeComposite(book) {
  const totalArr = book.reduce((s, a) => s + a.arr, 0) || 1;
  // weighted index level
  const level = book.reduce((s, a) => s + a.score * (a.arr / totalArr), 0);
  // per-account contribution to the level (sums to `level`)
  const contributions = book
    .map((a) => ({
      acct: a,
      weight: a.arr / totalArr,
      contribution: a.score * (a.arr / totalArr),
    }))
    .sort((x, y) => y.contribution - x.contribution);
  return { level: Math.round(level * 10) / 10, contributions, totalArr };
}

/* Per-pillar exposure roll-up (0–100-ish) — how much each pillar contributes
   to overall risk, weighted by finding volume × account ARR. Used to show the
   composite is genuinely built from all pillars. */
function pillarBreakdown(book) {
  const totals = {};
  PILLAR_ORDER.forEach((k) => (totals[k] = 0));
  let grand = 0;
  book.forEach((a) => {
    a.findings.forEach((f) => {
      if (!f.pillar || totals[f.pillar] === undefined) return;
      const w = f.count * (a.arr / 1000000); // finding volume × ARR weight
      totals[f.pillar] += w;
      grand += w;
    });
  });
  grand = grand || 1;
  return PILLAR_ORDER.map((k) => ({
    key: k,
    name: PILLARS[k].name,
    share: Math.round((totals[k] / grand) * 100),
  }));
}

/* ---- Manager view: the CSE team roster ----
   Synthetic team so the manager lens has data. Bob (the CSE Manager) sees all;
   his own book is the real BOOK above. Each rep has an aggregate roll-up.
   Real wiring: roster + per-CSE book from Salesforce (owner) + Vitally + DataPort. */
const TEAM = [
  { id: "cse-bob", name: "Bob Sugg", role: "Manager", accounts: 6, arr: 1710000, index: 66, delta: 2.1, openFindings: 4843, remediations: { open: 3, closedQtr: 9 }, closedVelocity: 12, self: true },
  { id: "cse-1", name: "Priya Nair", accounts: 9, arr: 2240000, index: 74, delta: 5.4, openFindings: 6120, remediations: { open: 6, closedQtr: 14 }, closedVelocity: 18 },
  { id: "cse-2", name: "Marcus Lang", accounts: 7, arr: 1380000, index: 71, delta: 3.8, openFindings: 5210, remediations: { open: 5, closedQtr: 7 }, closedVelocity: 8 },
  { id: "cse-3", name: "Elena Cruz", accounts: 11, arr: 2980000, index: 58, delta: -1.6, openFindings: 4410, remediations: { open: 4, closedQtr: 21 }, closedVelocity: 24 },
  { id: "cse-4", name: "Devin Park", accounts: 5, arr: 690000, index: 49, delta: -0.4, openFindings: 1890, remediations: { open: 1, closedQtr: 11 }, closedVelocity: 15 },
  { id: "cse-5", name: "Sara Okafor", accounts: 8, arr: 1520000, index: 63, delta: 4.2, openFindings: 3970, remediations: { open: 7, closedQtr: 5 }, closedVelocity: 6 },
];

const teamTotals = () => {
  const t = TEAM.reduce(
    (s, m) => ({
      accounts: s.accounts + m.accounts,
      arr: s.arr + m.arr,
      openFindings: s.openFindings + m.openFindings,
      openRem: s.openRem + m.remediations.open,
      closedQtr: s.closedQtr + m.remediations.closedQtr,
    }),
    { accounts: 0, arr: 0, openFindings: 0, openRem: 0, closedQtr: 0 }
  );
  const atRisk = TEAM.filter((m) => m.index >= 70).length;
  return { ...t, atRisk, avgIndex: Math.round(TEAM.reduce((s, m) => s + m.index, 0) / TEAM.length) };
};

/* Generate a CSE's book of accounts — deterministic (seeded by rep id) so it's
   stable across renders. For Bob it returns the real BOOK; for others it
   synthesizes accounts calibrated to the rep's aggregate index + ARR, with
   pillar-tagged findings so the drill-down reuses all the account UI. */
const INDUSTRY_KEYS = ["fin", "health", "saas", "retail", "mfg"];
const CSE_ACCT_NAMES = [
  "Northgate", "Silverline", "Blue Harbor", "Ironwood", "Crestview", "Anchor",
  "Vista", "Copperfield", "Redwood", "Sterling", "Fairmont", "Kestrel",
];
const FINDING_BY_PILLAR = {
  dspm: "Public sharing links in Microsoft 365",
  dlp: "Sensitive data exfiltration over unmonitored egress",
  access: "Orphaned identities with standing access",
  aispm: "Shadow AI: unapproved ChatGPT accounts",
  aiprotect: "Sensitive data pasted into public AI prompts",
};

function bookForCSE(member) {
  if (member.self) return BOOK; // Bob's real book
  const rnd = mulberry32(seedFromKey(member.id));
  const n = member.accounts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const industry = INDUSTRY_KEYS[Math.floor(rnd() * INDUSTRY_KEYS.length)];
    // scores centered on the rep's index so the book "averages" to their number
    const score = Math.max(12, Math.min(96, Math.round(member.index + (rnd() * 2 - 1) * 22)));
    const arr = Math.round((member.arr / n) * (0.6 + rnd() * 0.8));
    const nameA = CSE_ACCT_NAMES[Math.floor(rnd() * CSE_ACCT_NAMES.length)];
    const suffix = PEER_SUFFIX[industry];
    // 2–3 findings across pillars
    const pillars = [...PILLAR_ORDER].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 2));
    const findings = pillars.map((p) => ({
      label: FINDING_BY_PILLAR[p],
      count: Math.round(40 + rnd() * 900),
      trend: Math.round((rnd() * 2 - 1) * 30),
      pillar: p,
    }));
    out.push({
      id: `${member.id}-a${i}`,
      name: `${nameA} ${suffix}`,
      industry,
      size: SIZES[Math.floor(rnd() * SIZES.length)],
      region: REGIONS[1 + Math.floor(rnd() * (REGIONS.length - 1))],
      score,
      arr,
      renewalDays: 20 + Math.floor(rnd() * 300),
      health: Math.max(20, Math.min(95, Math.round(100 - member.index + (rnd() * 2 - 1) * 20))),
      coverage: 40 + Math.floor(rnd() * 60),
      findings,
      play: `Synthetic account in ${member.name}'s book. In production this pulls live findings + a play mapped to the dominant pattern.`,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ---- Stage-2 "Predict": collective-intelligence forecasts ----
   The reframe: because Cyera sees the same pattern hit many orgs in a cohort
   before it reaches the next one, Pulse can forecast a customer's exposure
   BEFORE it lands. Synthetic here, but the shape mirrors what real cross-
   customer finding-event data would produce. Each prediction = a pattern
   spreading through an industry cohort, projected onto one of your accounts
   that shares the pattern's early signature but hasn't peaked yet. */
const PREDICTIONS = [
  {
    id: "pr1",
    acctId: "a2", // Meridian Capital
    pillar: "dspm",
    pattern: "exposed API keys in cloud storage",
    cohortHitPct: 63, // % of Financial Services cohort already hit
    leadDays: 18, // forecast lead time before it lands
    confidence: 84,
    basis: "63% of Financial Services orgs (5K+) saw this pattern surface within 30 days of the same precursor Meridian is now showing (+31% API-key exposure this quarter).",
    action: "Pre-empt: rotate cloud-storage credentials and enable the API-key detection policy now — before the pattern completes.",
  },
  {
    id: "pr2",
    acctId: "a1", // Northwind Health
    pillar: "aiprotect",
    pattern: "PHI leaking into public AI prompts",
    cohortHitPct: 47,
    leadDays: 25,
    confidence: 78,
    basis: "Healthcare orgs with rising PHI findings + shadow-ChatGPT usage (Northwind's exact signature) saw sensitive PHI appear in public AI prompts within ~30 days in 47% of observed cases.",
    action: "Pre-empt: enable AI Protect prompt-inspection and lock external sharing on the flagged PHI shares before the projected window.",
  },
  {
    id: "pr3",
    acctId: "a5", // Atlas Manufacturing
    pillar: "access",
    pattern: "orphaned-identity privilege escalation",
    cohortHitPct: 38,
    leadDays: 31,
    confidence: 71,
    basis: "Manufacturing peers with the same standing-access growth curve Atlas is on saw an insider privilege-escalation event within ~30 days in 38% of cases.",
    action: "Pre-empt: run an identity clean-up on standing access before the renewal conversation — turns a risk into a proof-point.",
  },
];

/* Resolved predictions — the track record that makes forecasting credible.
   Past forecasts that landed as predicted, with the customer protected in
   time because Pulse flagged it early. Drives the "hit rate" proof strip. */
const PREDICTION_LEDGER = {
  hitRate: 89, // % of forecasts that materialized within their window
  total: 47, // forecasts resolved to date
  prevented: 31, // where pre-emptive action closed the exposure before impact
  recent: [
    { acct: "Sable Health", pattern: "PHI in public file shares", days: 21, protected: true },
    { acct: "Vantage Group", pattern: "exposed API keys", days: 16, protected: true },
    { acct: "Keystone Capital", pattern: "orphaned-identity escalation", days: 29, protected: true },
    { acct: "Brightline Labs", pattern: "stale PII in non-prod", days: 12, protected: false },
  ],
};

/* ---- Stage-3 "Autonomous defense" — the immune response ----
   When a forecast threatens multiple accounts, Pulse auto-drafts a defense
   and offers to deploy it across the whole exposed set in one action. The
   human stays in the loop (review → confirm → deploy). This is the audacious
   end-state: risk that took a CSE a quarter to chase closes in a day, at scale.
   Synthetic. The targeted accounts are the real BOOK accounts sharing the
   pattern's precursor. */
/* Which accounts to surface a shared remediation for in the banner. */
const AUTO_DEFENSE = {
  pattern: "exposed API keys in cloud storage",
  playbookKey: "dspm", // maps into REMEDIATION_PLAYBOOKS below
  targetIds: ["a2", "a6"], // Meridian Capital, Cedar Trust Bank (both Financial Services)
};

/* ---- Remediation playbooks — concise, actionable steps per pillar ----
   Grounded in Cyera's real out-of-the-box remediation actions & workflow
   (KB: Actionability/Remediation, Omni DLP, Access Trail, AI Guardian):
   Issue → notify owner (Slack/email) / open ticket (Jira/ServiceNow) →
   execute action (Remove Public Access, Delete Files, Apply Sensitivity
   Labels, Enable Disk Encryption, revoke access). Each step is one clear
   move a CSE can hand a customer or run in-platform. `where` = the Cyera
   platform path; `est` = rough time. Keep these short — the point is speed. */
const REMEDIATION_PLAYBOOKS = {
  dspm: {
    title: "Close data-exposure findings",
    where: "Issues → filter by DSPM policy → select affected datastores",
    est: "~15 min to queue",
    steps: [
      { do: "Open the Issues page, filter to the exposure policy (e.g. public sharing, exposed keys, unencrypted PHI).", why: "Scopes the exact at-risk datastores." },
      { do: "Trigger the built-in action: Remove Public Access (S3/Box/M365) or Enable Disk Encryption (AWS) on the flagged stores.", why: "Cyera OOTB remediation — closes the exposure at the source." },
      { do: "For keys/creds: rotate via the source system, then re-scan to confirm the finding clears.", why: "Rotation is owner-side; Cyera verifies closure." },
      { do: "Send the issue to the datastore owner via Slack or email with embedded remediation actions.", why: "Operationalizes fix without a meeting." },
    ],
    action: "Create Project in Notion",
  },
  dlp: {
    title: "Tune DLP & stop exfiltration",
    where: "Omni DLP dashboard → Alerts / Suggested Policies",
    est: "~20 min",
    steps: [
      { do: "In Omni DLP, review the egress/exfiltration alerts and confirm true positives.", why: "Omni acts as tier-1 triage — cuts alert-fatigue noise first." },
      { do: "Apply a Suggested Policy (or tune the existing one) to block the offending egress channel.", why: "Cyera-generated policy tuning reduces false positives + closes the channel." },
      { do: "Route confirmed criticals to the SOC via the existing Jira/ServiceNow integration.", why: "Keeps the team in their existing workflow." },
    ],
    action: "Create Project in Notion",
  },
  access: {
    title: "Least-privilege & insider-risk review",
    where: "Access Trail → Identities / Activity",
    est: "~25 min",
    steps: [
      { do: "In Access Trail, sort identities by standing access to sensitive datastores; flag external + orphaned identities.", why: "Surfaces the over-permissioned and non-human access driving risk." },
      { do: "Revoke or right-size unused/standing privileges (least-privilege).", why: "Directly shrinks the exposure surface." },
      { do: "For anomalous surges (mass downloads), open an insider-risk investigation from the activity event.", why: "Access Trail's damage-assessment flow." },
      { do: "Notify the account owner with the affected identities list via Slack.", why: "Owner confirms which access is legitimate." },
    ],
    action: "Create Project in Notion",
  },
  aispm: {
    title: "Bring shadow AI under governance",
    where: "AI Assets page (AI-SPM discovery)",
    est: "~15 min",
    steps: [
      { do: "Open the AI Assets page; review AI-SPM-discovered tools (shadow ChatGPT, unsanctioned custom AI) touching data.", why: "Inventories the ungoverned AI footprint." },
      { do: "Classify each: sanction, restrict, or block. Flag personal/unapproved accounts.", why: "Turns discovery into a governance decision." },
      { do: "For sanctioned tools, verify what organizational data/APIs they connect to.", why: "AI-SPM shows the data-at-rest connections." },
      { do: "Hand the disposition list to the account's security owner for policy.", why: "Owner sets the enforcement stance." },
    ],
    action: "Create Project in Notion",
  },
  aiprotect: {
    title: "Stop sensitive data leaking into AI",
    where: "AI Protect → prompt/interaction alerts",
    est: "~15 min",
    steps: [
      { do: "In AI Protect, review flagged interactions (sensitive data in prompts, LLM accessing unauthorized data via Copilot).", why: "Shows the in-the-moment leakage events." },
      { do: "Enable prompt-inspection / block policy on the offending public AI destinations.", why: "Leverages Omni DLP integration to block at the moment of use." },
      { do: "For Copilot over-access, tighten the underlying data permissions (ties back to Access Trail).", why: "Fixes the root cause, not just the symptom." },
      { do: "Brief the owner on the malicious-intent / restricted-access events with next steps.", why: "Escalates real insider signals." },
    ],
    action: "Create Project in Notion",
  },
};

/* Standard normal CDF via erf approximation (Abramowitz & Stegun 7.1.26). */
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  p = 1 - p;
  return z >= 0 ? p : 1 - p;
}

/* Percentile of a score within its industry peer cohort (0–100). */
function percentile(score, industryKey) {
  const median = COHORT[industryKey].median;
  const z = (score - median) / PEER_SIGMA;
  return Math.round(normalCdf(z) * 100);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const IQR_Z = 0.6745; // z-score at the 25th/75th percentile of a normal distribution
const clampScore = (x) => Math.max(0, Math.min(100, x));

/* Per-cohort IQR band + median position on the 0–100 exposure track,
   derived from that cohort's median and PEER_SIGMA (not hardcoded). */
function cohortBand(industryKey) {
  const m = COHORT[industryKey].median;
  const p25 = clampScore(m - IQR_Z * PEER_SIGMA);
  const p75 = clampScore(m + IQR_Z * PEER_SIGMA);
  return {
    left: `${p25}%`,
    right: `${100 - p75}%`,
    median: `${clampScore(m)}%`,
  };
}

function seedSeries(base, points = 48) {
  let v = base;
  const out = [];
  for (let i = 0; i < points; i++) {
    v = Math.max(8, Math.min(96, v + (Math.random() - 0.48) * 5));
    out.push({ t: i, v: Math.round(v * 10) / 10 });
  }
  return out;
}

function nextTick(series, drift = 0) {
  const last = series[series.length - 1].v;
  const v = Math.max(8, Math.min(96, last + (Math.random() - 0.47 + drift) * 4));
  const t = series[series.length - 1].t + 1;
  const trimmed = series.length >= 48 ? series.slice(1) : series;
  return [...trimmed, { t, v: Math.round(v * 10) / 10 }];
}

function riskLabel(v) {
  if (v >= 70) return { label: "Elevated", color: "var(--coral)" };
  if (v >= 45) return { label: "Watch", color: "var(--amber)" };
  return { label: "Baseline", color: "var(--lime)" };
}

function makeSignal(id) {
  const ind = INDUSTRIES[Math.floor(Math.random() * INDUSTRIES.length)];
  const finding = FINDING_TYPES[Math.floor(Math.random() * FINDING_TYPES.length)];
  const size = SIZES[Math.floor(Math.random() * SIZES.length)];
  const pct = Math.round(15 + Math.random() * 60);
  return {
    id,
    ts: Date.now(),
    pillar: finding.pillar,
    text: `Organizations in ${ind.name} (${size}) saw a ${pct}% shift in ${finding.label} this quarter.`,
    tone: pct > 45 ? "coral" : pct > 28 ? "amber" : "lime",
  };
}

function timeAgo(ts, now) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

/* Real composite level + pillar breakdown, computed once from the BOOK. */
const COMPOSITE = computeComposite(BOOK);
const PILLAR_BREAKDOWN = pillarBreakdown(BOOK);

/* Seed a live series that jitters AROUND the real composite level (keeps the
   "pulse" aesthetic, but the level is grounded in actual pillar/account data). */
function seedAround(base, points = 48) {
  const out = [];
  for (let i = 0; i < points; i++) {
    // small deterministic-ish wobble that ends at the true base on the last point
    const wob = Math.sin(i / 3) * 2.4 + (Math.random() - 0.5) * 1.5;
    const v = Math.max(0, Math.min(100, base + wob * (i / points)));
    out.push({ t: i, v: Math.round(v * 10) / 10 });
  }
  out[out.length - 1].v = base; // anchor the current value to the real number
  return out;
}

function tickAround(series, base) {
  const last = series[series.length - 1].v;
  // gentle pull toward the real base + small noise → stays anchored, still lives
  const v = Math.max(0, Math.min(100, last + (base - last) * 0.25 + (Math.random() - 0.5) * 1.2));
  const t = series[series.length - 1].t + 1;
  const trimmed = series.length >= 48 ? series.slice(1) : series;
  return [...trimmed, { t, v: Math.round(v * 10) / 10 }];
}

export default function CyeraPulse() {
  const [composite, setComposite] = useState(() => seedAround(COMPOSITE.level));
  const [industries, setIndustries] = useState(() =>
    INDUSTRIES.map((i) => ({ ...i, series: seedSeries(i.base, 24) }))
  );
  const [feed, setFeed] = useState(() => [makeSignal(1), makeSignal(2), makeSignal(3)]);
  const [now, setNow] = useState(Date.now());
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [selected, setSelected] = useState(null); // drilled-into account, or null
  const [graphIndustry, setGraphIndustry] = useState(null); // industry key for the node graph
  const [spin, setSpin] = useState(0); // pseudo-3D rotation angle (radians)
  const [spinPaused, setSpinPaused] = useState(false); // pause rotation on hover for easier clicks
  const [graphReturn, setGraphReturn] = useState(null); // industry to return to when closing a drawer opened from the graph
  const [playbook, setPlaybook] = useState(null); // remediation playbook modal: { key, targetIds } | null
  const [copied, setCopied] = useState(false); // "copied steps" confirmation flash
  const [notionPushed, setNotionPushed] = useState(false); // "created in Notion" confirmation
  const [view, setView] = useState("book"); // "book" (My Book) | "team" (Manager view)
  const [teamTab, setTeamTab] = useState("heat"); // "heat" | "load" | "velocity"
  const [drillCSE, setDrillCSE] = useState(null); // CSE member whose book is drilled into
  const [netOrgs, setNetOrgs] = useState(641); // orgs contributing to the collective signal (live-ticks up)
  const [netPatterns, setNetPatterns] = useState(12847); // patterns learned across the base
  const [indexExpanded, setIndexExpanded] = useState(false); // ① decompose panel toggle
  const [pillarFilter, setPillarFilter] = useState("all"); // filter feed by Cyera pillar
  const [expandedPillar, setExpandedPillar] = useState(null); // pillar whose decompose panel is open
  const [conn, setConn] = useState(CONN.OFF); // backend connection status (see ../data/source)
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS); // live priority weighting
  const [sizeFilter, setSizeFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const idRef = useRef(4);

  const filteredBook = useMemo(
    () =>
      BOOK.filter(
        (a) =>
          (sizeFilter === "all" || a.size === sizeFilter) &&
          (regionFilter === "all" || a.region === regionFilter)
      ),
    [sizeFilter, regionFilter]
  );

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  // Esc closes the account drawer
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setSelected(null);
        setGraphIndustry(null);
        setGraphReturn(null);
        setPlaybook(null);
        setDrillCSE(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Backend data-source seam — polls the BFF when enabled, else stays OFF.
  // Today `DATA_CONFIG.enabled` is false, so this reports OFF (synthetic) and
  // does no network calls. Flip it on (+ point apiBase at the BFF) to go live.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const { conn: c } = await getMetrics();
      if (!cancelled) setConn(c);
    };
    poll();
    if (!DATA_CONFIG.enabled) return () => { cancelled = true; };
    const id = setInterval(poll, DATA_CONFIG.pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Network-effect counters drift upward — the flywheel, made visible.
  useEffect(() => {
    const t = setInterval(() => {
      setNetPatterns((p) => p + Math.floor(1 + Math.random() * 4));
      if (Math.random() > 0.7) setNetOrgs((o) => o + 1);
    }, 3800);
    return () => clearInterval(t);
  }, []);


  // Pseudo-3D auto-rotation — only runs while a graph is open.
  useEffect(() => {
    if (!graphIndustry || spinPaused) return;
    let raf;
    const loop = () => {
      setSpin((s) => s + 0.004);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [graphIndustry, spinPaused]);

  useEffect(() => {
    const tick = setInterval(() => {
      setComposite((s) => tickAround(s, COMPOSITE.level));
      setIndustries((list) => list.map((i) => ({ ...i, series: nextTick(i.series) })));
      setLastUpdate(Date.now());
    }, 3200);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const feedTimer = setInterval(() => {
      idRef.current += 1;
      setFeed((f) => [makeSignal(idRef.current), ...f].slice(0, 8));
    }, 5500);
    return () => clearInterval(feedTimer);
  }, []);

  const compositeValue = composite[composite.length - 1].v;
  const compositeDelta = useMemo(() => {
    const prev = composite[Math.max(0, composite.length - 6)].v;
    return Math.round((compositeValue - prev) * 10) / 10;
  }, [composite, compositeValue]);
  const risk = riskLabel(compositeValue);

  // ② Projected trajectory — linear fit over the recent window, extended
  //    forward. Also computes ETA to the Elevated threshold (70).
  const projection = useMemo(() => {
    const window = composite.slice(-8);
    const n = window.length;
    // slope per tick via simple least-squares on index vs. position
    const xs = window.map((_, i) => i);
    const ys = window.map((p) => p.v);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const slopeTick = den ? num / den : 0;
    const slopePerDay = slopeTick * 2; // ~2 ticks/day (tick = 3.2s live, mapped to a day in demo)
    const lastT = composite[composite.length - 1].t;
    // build 6 forecast points continuing the line
    const fc = [];
    for (let i = 1; i <= 6; i++) {
      fc.push({ t: lastT + i, f: Math.max(0, Math.min(100, compositeValue + slopeTick * i)) });
    }
    // ETA (days) to Elevated=70, if rising toward it
    let etaDays = null;
    if (slopePerDay > 0.05 && compositeValue < 70) {
      etaDays = Math.ceil((70 - compositeValue) / slopePerDay);
    }
    return { fc, slopePerDay: Math.round(slopePerDay * 10) / 10, etaDays };
  }, [composite, compositeValue]);

  // merge actual + forecast for the chart (forecast keyed separately)
  const chartData = useMemo(() => {
    const actual = composite.map((p) => ({ t: p.t, v: p.v }));
    return [...actual, ...projection.fc];
  }, [composite, projection]);

  // Pillar coverage — aggregate risk across Cyera's 5 platform pillars from
  // all account findings. Makes Pulse holistic (data at rest / in motion / in use).
  const pillarCoverage = useMemo(() => {
    const agg = {};
    PILLAR_ORDER.forEach((k) => (agg[k] = { findings: 0, accounts: new Set(), rising: 0, hottest: 0 }));
    BOOK.forEach((a) => {
      a.findings.forEach((f) => {
        if (!f.pillar || !agg[f.pillar]) return;
        const g = agg[f.pillar];
        g.findings += f.count;
        g.accounts.add(a.id);
        if (f.trend > 0) g.rising += 1;
        if (f.trend > g.hottest) g.hottest = f.trend;
      });
    });
    return PILLAR_ORDER.map((k) => ({
      ...PILLARS[k],
      findings: agg[k].findings,
      accounts: agg[k].accounts.size,
      rising: agg[k].rising,
      hottest: agg[k].hottest,
    }));
  }, []);

  // Per-pillar decompose — for the expanded pillar panel: accounts ranked by
  // their finding volume in that pillar, plus the aggregated finding types.
  const pillarDetail = useMemo(() => {
    if (!expandedPillar) return null;
    const accts = [];
    const typeAgg = {};
    BOOK.forEach((a) => {
      const fs = a.findings.filter((f) => f.pillar === expandedPillar);
      if (!fs.length) return;
      const count = fs.reduce((s, f) => s + f.count, 0);
      const topTrend = fs.reduce((m, f) => (f.trend > m ? f.trend : m), -999);
      accts.push({ acct: a, count, topTrend });
      fs.forEach((f) => {
        typeAgg[f.label] = typeAgg[f.label] || { label: f.label, count: 0, trend: f.trend };
        typeAgg[f.label].count += f.count;
        if (f.trend > typeAgg[f.label].trend) typeAgg[f.label].trend = f.trend;
      });
    });
    accts.sort((x, y) => y.count - x.count);
    const types = Object.values(typeAgg).sort((x, y) => y.count - x.count);
    const maxCount = accts.length ? accts[0].count : 1;
    return { accts, types, maxCount };
  }, [expandedPillar]);

  // ① Decompose — top account contributors to the index. Uses the SAME
  //    ARR-weighted contributions that build the composite level, so the
  //    shares genuinely reconcile with the headline number.
  const contributors = useMemo(() => {
    const total = COMPOSITE.contributions.reduce((s, x) => s + x.contribution, 0) || 1;
    return COMPOSITE.contributions.map((x) => ({
      acct: x.acct,
      pct: percentile(x.acct.score, x.acct.industry),
      contribution: x.contribution,
      share: Math.round((x.contribution / total) * 100),
    }));
  }, []);

  return (
    <div style={styles.page}>
      <style>{FONT_IMPORT}</style>
      <div style={styles.vignette} />

      <header style={styles.header}>
        <div style={styles.brandRow}>
          <img src={cyeraLogo} alt="Cyera" style={styles.mark} />
          <div>
            <div style={styles.brandTitle}>CYERA PULSE</div>
            <div style={styles.brandSub}>Collective Risk Intelligence</div>
          </div>
        </div>
        <div style={styles.liveRow}>
          <span style={styles.liveDot} />
          <span style={styles.liveText}>LIVE</span>
          {(() => {
            const src =
              conn === CONN.CONNECTED
                ? { txt: "backend connected", color: "var(--lime)" }
                : conn === CONN.FALLBACK
                ? { txt: "backend unreachable · synthetic", color: "var(--amber)" }
                : { txt: "synthetic", color: "var(--fog-dim)" };
            return (
              <span style={{ ...styles.srcBadge, color: src.color, borderColor: src.color }}>
                {src.txt}
              </span>
            );
          })()}
          <span style={styles.updatedText}>updated {timeAgo(lastUpdate, now)}</span>
        </div>
      </header>

      <main style={styles.main}>
        {/* VIEW TOGGLE — My Book (IC) vs Team (Manager) */}
        <div style={styles.viewToggle}>
          <button
            style={{ ...styles.viewTab, ...(view === "book" ? styles.viewTabActive : {}) }}
            onClick={() => setView("book")}
          >
            My Book
          </button>
          <button
            style={{ ...styles.viewTab, ...(view === "team" ? styles.viewTabActive : {}) }}
            onClick={() => setView("team")}
          >
            Team ({TEAM.length})
          </button>
        </div>

        {view === "book" && (<>
        {/* MISSION STRIP — the North Star + the network-effect flywheel */}
        <section style={styles.mission}>
          <div style={styles.missionLeft}>
            <div style={styles.missionEyebrow}>THE COLLECTIVE IMMUNE SYSTEM FOR ENTERPRISE DATA</div>
            <div style={styles.missionLine}>
              Every account we protect teaches us how to protect the rest. Pulse puts that collective
              signal in your hands — so you can <span style={{ color: "var(--lilac)" }}>see risk coming
              across your book</span> and act before it costs a customer.
            </div>
          </div>
          <div style={styles.missionStats}>
            <div style={styles.missionStat}>
              <span style={styles.missionNum}>{netOrgs.toLocaleString()}</span>
              <span style={styles.missionLbl}>orgs contributing signal</span>
            </div>
            <div style={styles.missionStat}>
              <span style={styles.missionNum}>{netPatterns.toLocaleString()}</span>
              <span style={styles.missionLbl}>patterns learned</span>
            </div>
            <div style={styles.missionStat}>
              <span style={{ ...styles.missionNum, color: "var(--lime)" }}>↑ smarter daily</span>
              <span style={styles.missionLbl}>the flywheel</span>
            </div>
          </div>
        </section>

        {/* PILLAR COVERAGE — risk across all 5 Cyera platform pillars */}
        <section>
          <div style={styles.benchHead}>
            <div style={styles.sectionLabel}>PLATFORM COVERAGE</div>
            <span style={styles.rollupText}>
              risk across every Cyera pillar · <span style={{ color: "var(--lilac)" }}>data at rest, in motion, and in use</span>
            </span>
          </div>
          <div className="pulse-pillar-grid">
            {pillarCoverage.map((p) => {
              const active = expandedPillar === p.key;
              const hotColor = p.hottest >= 25 ? "var(--coral)" : p.hottest >= 10 ? "var(--amber)" : "var(--lime)";
              return (
                <div
                  key={p.key}
                  className="pulse-clickable"
                  style={{ ...styles.pillarCard, ...(active ? styles.pillarCardActive : {}) }}
                  onClick={() => setExpandedPillar(active ? null : p.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedPillar(active ? null : p.key); }}
                  title={p.blurb}
                >
                  <div style={styles.pillarGroup}>{p.group}</div>
                  <div style={styles.pillarName}>{p.name}</div>
                  <div style={styles.pillarStatRow}>
                    <span style={styles.pillarFindings}>{p.findings.toLocaleString()}</span>
                    <span style={styles.pillarFindingsLbl}>findings</span>
                  </div>
                  <div style={styles.pillarMeta}>
                    {p.accounts} accounts ·{" "}
                    <span style={{ color: hotColor }}>▲ {p.hottest}% hottest</span>
                  </div>
                  <div style={styles.pillarExpandHint}>{active ? "hide ▲" : "explore ▾"}</div>
                </div>
              );
            })}
          </div>

          {/* Expanded pillar decompose panel */}
          {expandedPillar && pillarDetail && (
            <div style={styles.pillarPanel}>
              <div style={styles.pillarPanelHead}>
                <div>
                  <span style={styles.pillarPanelTitle}>{PILLARS[expandedPillar].name}</span>
                  <span style={styles.pillarPanelBlurb}> · {PILLARS[expandedPillar].blurb}</span>
                </div>
                <button
                  style={styles.decomposeBtn}
                  onClick={() => { setPillarFilter(expandedPillar); }}
                >
                  view in pattern feed ↓
                </button>
              </div>

              <div style={styles.pillarPanelCols}>
                {/* accounts most exposed in this pillar */}
                <div style={styles.pillarPanelCol}>
                  <div style={styles.pillarColLabel}>ACCOUNTS MOST EXPOSED</div>
                  {pillarDetail.accts.length === 0 && (
                    <div style={styles.emptyState}>No accounts with {PILLARS[expandedPillar].name} findings.</div>
                  )}
                  {pillarDetail.accts.map(({ acct, count, topTrend }) => (
                    <div
                      key={acct.id}
                      style={styles.pillarAcctRow}
                      onClick={() => { setGraphReturn(null); setSelected(acct); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelected(acct); }}
                      title={`Open ${acct.name}`}
                    >
                      <span style={styles.pillarAcctName}>{acct.name}</span>
                      <span style={styles.pillarAcctBarTrack}>
                        <span style={{ ...styles.pillarAcctBarFill, width: `${Math.round((count / pillarDetail.maxCount) * 100)}%` }} />
                      </span>
                      <span style={styles.pillarAcctCount}>{count.toLocaleString()}</span>
                      <span style={{ ...styles.pillarAcctTrend, color: topTrend >= 0 ? "var(--coral)" : "var(--lime)" }}>
                        {topTrend >= 0 ? "▲" : "▼"}{Math.abs(topTrend)}%
                      </span>
                    </div>
                  ))}
                </div>

                {/* finding types in this pillar */}
                <div style={styles.pillarPanelCol}>
                  <div style={styles.pillarColLabel}>TOP FINDING TYPES</div>
                  {pillarDetail.types.map((t, i) => (
                    <div key={i} style={styles.pillarTypeRow}>
                      <span style={styles.pillarTypeLabel}>{t.label}</span>
                      <span style={styles.pillarTypeCount}>{t.count.toLocaleString()}</span>
                      <span style={{ ...styles.pillarAcctTrend, color: t.trend >= 0 ? "var(--coral)" : "var(--lime)" }}>
                        {t.trend >= 0 ? "▲" : "▼"}{Math.abs(t.trend)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div style={styles.benchNote}>
            Every risk signal in Pulse is tagged to a Cyera pillar. Click a pillar to see which
            accounts drive it and its top finding types. (Synthetic data — DSPM, Omni DLP, Access
            Trail, AI-SPM, AI Protect.)
          </div>
        </section>

        {/* HERO — Composite Risk Index (interactive: decompose + trajectory) */}
        <section style={styles.hero}>
          <div style={styles.heroLeft}>
            <div style={styles.eyebrow}>COMPOSITE RISK INDEX</div>
            <div
              style={styles.heroNumberRow}
              onClick={() => setIndexExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setIndexExpanded((v) => !v); }}
              title="Click to see what's driving the index"
            >
              <span style={{ ...styles.heroNumber, color: risk.color }}>
                {compositeValue.toFixed(1)}
              </span>
              <span
                style={{
                  ...styles.heroDelta,
                  color: compositeDelta >= 0 ? "var(--coral)" : "var(--lime)",
                }}
              >
                {compositeDelta >= 0 ? "▲" : "▼"} {Math.abs(compositeDelta)}
              </span>
            </div>
            <div style={styles.heroChipRow}>
              <div style={{ ...styles.riskChip, borderColor: risk.color, color: risk.color }}>
                {risk.label}
              </div>
              <button style={styles.decomposeBtn} onClick={() => setIndexExpanded((v) => !v)}>
                {indexExpanded ? "hide drivers ▲" : "what's driving this? ▾"}
              </button>
            </div>

            {/* ② trajectory / ETA callout */}
            <div style={styles.trajectory}>
              {projection.etaDays != null ? (
                <>
                  <span style={styles.trajArrow}>↗</span>
                  <span>
                    Trending up <b style={{ color: "var(--coral)" }}>+{projection.slopePerDay}/day</b> —
                    hits <b style={{ color: "var(--coral)" }}>Elevated in ~{projection.etaDays}d</b> at this rate.
                  </span>
                </>
              ) : projection.slopePerDay < -0.05 ? (
                <>
                  <span style={{ ...styles.trajArrow, color: "var(--lime)" }}>↘</span>
                  <span>Improving <b style={{ color: "var(--lime)" }}>{projection.slopePerDay}/day</b> — trending down.</span>
                </>
              ) : (
                <>
                  <span style={{ ...styles.trajArrow, color: "var(--fog)" }}>→</span>
                  <span>Holding steady — no material trend.</span>
                </>
              )}
            </div>
          </div>

          <div style={styles.heroChart}>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={risk.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={risk.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={[0, 100]} hide />
                {/* threshold bands */}
                <ReferenceLine y={70} stroke="var(--coral)" strokeDasharray="3 3" strokeOpacity={0.5}
                  label={{ value: "Elevated", position: "insideTopRight", fill: "var(--coral)", fontSize: 9 }} />
                <ReferenceLine y={45} stroke="var(--amber)" strokeDasharray="3 3" strokeOpacity={0.4}
                  label={{ value: "Watch", position: "insideTopRight", fill: "var(--amber)", fontSize: 9 }} />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={risk.color}
                  strokeWidth={2}
                  fill="url(#pulseFill)"
                  isAnimationActive={true}
                  animationDuration={600}
                />
                {/* projected trajectory (dashed) */}
                <Line
                  type="monotone"
                  dataKey="f"
                  stroke="var(--lilac)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={styles.chartLegendRow}>
              <span style={styles.chartLegendItem}>
                <span style={{ ...styles.legendLine, background: risk.color }} /> actual
              </span>
              <span style={styles.chartLegendItem}>
                <span style={{ ...styles.legendLineDash }} /> projected
              </span>
            </div>
          </div>
        </section>

        {/* ① DECOMPOSE PANEL — what's driving the index */}
        {indexExpanded && (
          <section style={styles.decomposePanel}>
            <div style={styles.sectionLabel}>WHAT'S DRIVING THE INDEX</div>

            {/* pillar mix — proves the index rolls up all 5 pillars */}
            <div style={styles.pillarMixLabel}>RISK MIX BY PILLAR</div>
            <div style={styles.pillarMixBar}>
              {PILLAR_BREAKDOWN.filter((p) => p.share > 0).map((p, i) => {
                const colors = ["var(--lilac)", "#9b6dff", "var(--amber)", "#5ad1ff", "var(--coral)"];
                return (
                  <div
                    key={p.key}
                    style={{ ...styles.pillarMixSeg, width: `${p.share}%`, background: colors[i % colors.length] }}
                    title={`${p.name}: ${p.share}%`}
                  />
                );
              })}
            </div>
            <div style={styles.pillarMixLegend}>
              {PILLAR_BREAKDOWN.filter((p) => p.share > 0).map((p, i) => {
                const colors = ["var(--lilac)", "#9b6dff", "var(--amber)", "#5ad1ff", "var(--coral)"];
                return (
                  <span key={p.key} style={styles.pillarMixLegItem}>
                    <span style={{ ...styles.pillarMixDot, background: colors[i % colors.length] }} />
                    {p.name} {p.share}%
                  </span>
                );
              })}
            </div>

            <div style={{ ...styles.pillarMixLabel, marginTop: 16 }}>TOP ACCOUNT CONTRIBUTORS</div>
            <div style={styles.contribList}>
              {contributors.map(({ acct, pct, share }) => {
                const c = riskLabel(acct.score).color;
                return (
                  <div
                    key={acct.id}
                    style={styles.contribRow}
                    onClick={() => { setGraphReturn(null); setSelected(acct); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelected(acct); }}
                    title={`Open ${acct.name}`}
                  >
                    <span style={styles.contribName}>{acct.name}</span>
                    <span style={styles.contribBarTrack}>
                      <span style={{ ...styles.contribBarFill, width: `${share}%`, background: c }} />
                    </span>
                    <span style={{ ...styles.contribShare, color: c }}>{share}%</span>
                    <span style={styles.contribMeta}>{acct.score} exposure · {ordinal(pct)} pct</span>
                  </div>
                );
              })}
            </div>
            <div style={styles.benchNote}>
              The index is the ARR-weighted roll-up of account exposure across all five Cyera
              pillars — the shares above sum to the headline number. Click any account to open its
              detail; closing the biggest contributors' exposure drops the index fastest. (Synthetic data.)
            </div>
          </section>
        )}

        {/* PREDICTIVE SIGNAL — Stage-2 collective-intelligence forecasts */}
        <section>
          <div style={styles.benchHead}>
            <div style={styles.sectionLabel}>
              <span style={styles.predictPulse} /> PREDICTIVE SIGNAL
            </div>
            <span style={styles.rollupText}>
              patterns forecast from the collective base · <span style={{ color: "var(--lilac)" }}>before they land</span>
            </span>
          </div>

          {/* REMEDIATION BANNER — shared playbook across exposed accounts */}
          <div style={styles.defenseBanner}>
            <div style={styles.defenseIcon}>🛡</div>
            <div style={styles.defenseBody}>
              <div style={styles.defenseTitle}>
                {AUTO_DEFENSE.targetIds.length} accounts exposed to{" "}
                <span style={{ color: "var(--lilac)" }}>{AUTO_DEFENSE.pattern}</span>
              </div>
              <div style={styles.defenseSub}>
                {AUTO_DEFENSE.targetIds
                  .map((id) => BOOK.find((a) => a.id === id)?.name)
                  .filter(Boolean)
                  .join(" · ")}{" "}
                — same fix applies to all. Grab the step-by-step remediation playbook.
              </div>
            </div>
            <button
              style={styles.defenseBtn}
              onClick={() => { setCopied(false); setPlaybook({ key: AUTO_DEFENSE.playbookKey, targetIds: AUTO_DEFENSE.targetIds }); }}
            >
              View remediation steps →
            </button>
          </div>

          {/* PREDICTION LEDGER — the track record that earns the trust */}
          <div style={styles.ledger}>
            <div style={styles.ledgerStats}>
              <div style={styles.ledgerStat}>
                <span style={{ ...styles.ledgerNum, color: "var(--lime)" }}>{PREDICTION_LEDGER.hitRate}%</span>
                <span style={styles.ledgerLbl}>forecast hit rate</span>
              </div>
              <div style={styles.ledgerStat}>
                <span style={styles.ledgerNum}>{PREDICTION_LEDGER.prevented}</span>
                <span style={styles.ledgerLbl}>exposures prevented</span>
              </div>
              <div style={styles.ledgerStat}>
                <span style={styles.ledgerNum}>{PREDICTION_LEDGER.total}</span>
                <span style={styles.ledgerLbl}>forecasts resolved</span>
              </div>
            </div>
            <div style={styles.ledgerFeed}>
              {PREDICTION_LEDGER.recent.map((r, i) => (
                <div key={i} style={styles.ledgerRow}>
                  <span style={{ ...styles.ledgerCheck, color: r.protected ? "var(--lime)" : "var(--fog-dim)" }}>
                    {r.protected ? "✓" : "○"}
                  </span>
                  <span style={styles.ledgerAcct}>{r.acct}</span>
                  <span style={styles.ledgerPattern}>{r.pattern}</span>
                  <span style={styles.ledgerDays}>
                    {r.protected ? `caught ${r.days}d early` : "flagged, not actioned"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.predictGrid}>
            {PREDICTIONS.map((p) => {
              const acct = BOOK.find((a) => a.id === p.acctId);
              if (!acct) return null;
              return (
                <div
                  key={p.id}
                  style={styles.predictCard}
                  onClick={() => { setGraphReturn(null); setSelected(acct); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelected(acct); }}
                  title={`Open ${acct.name}`}
                >
                  <div style={styles.predictTop}>
                    <span style={styles.predictEta}>~{p.leadDays}d out</span>
                    <span style={styles.predictConf}>{p.confidence}% confidence</span>
                  </div>

                  <div style={styles.predictHeadline}>
                    <span style={styles.predictAcct}>{acct.name}</span> is on track to see{" "}
                    <span style={styles.predictPattern}>{p.pattern}</span>
                  </div>

                  <div style={styles.predictBar}>
                    <div style={styles.predictBarFill}>
                      <div style={{ ...styles.predictBarInner, width: `${p.cohortHitPct}%` }} />
                    </div>
                    <span style={styles.predictBarLabel}>{p.cohortHitPct}% of cohort already hit</span>
                  </div>

                  <div style={styles.predictBasis}>{p.basis}</div>

                  <div style={styles.predictAction}>
                    <span style={styles.predictActionIcon}>⚡</span>
                    {p.action}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={styles.benchNote}>
            Forecasts derive from patterns observed across the anonymized customer base — Cyera sees
            a pattern hit many orgs before it reaches the next, so exposure can be closed
            pre-emptively. Directional, not deterministic; every prediction is a prioritized
            hypothesis, not a guarantee. (Synthetic data — Stage-2 concept.)
          </div>
        </section>

        {/* PRIORITY QUEUE — the CSE's daily worklist */}
        <section>
          <div style={styles.benchHead}>
            <div style={styles.sectionLabel}>PRIORITY QUEUE</div>
            <div style={styles.queueRollup}>
              {(() => {
                const atRisk = filteredBook.filter((a) => priorityScore(a, weights).value >= 40);
                const dollars = atRisk.reduce((s, a) => s + a.arr, 0);
                return (
                  <span style={styles.rollupText}>
                    {atRisk.length} of {filteredBook.length} accounts need attention ·{" "}
                    <span style={{ color: "var(--coral)" }}>{fmtArr(dollars)} ARR</span> in play
                  </span>
                );
              })()}
            </div>
          </div>

          {/* COHORT FILTERS — size + region */}
          <div style={styles.filterBar}>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>SIZE</span>
              {SIZE_FILTERS.map((s) => (
                <button
                  key={s}
                  style={{
                    ...styles.filterChip,
                    ...(sizeFilter === s ? styles.filterChipActive : {}),
                  }}
                  onClick={() => setSizeFilter(s)}
                >
                  {SIZE_LABEL[s]}
                </button>
              ))}
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>REGION</span>
              {REGIONS.map((rg) => (
                <button
                  key={rg}
                  style={{
                    ...styles.filterChip,
                    ...(regionFilter === rg ? styles.filterChipActive : {}),
                  }}
                  onClick={() => setRegionFilter(rg)}
                >
                  {rg === "all" ? "All" : rg}
                </button>
              ))}
            </div>
          </div>

          {/* WEIGHT SLIDERS — "tune with the team," live */}
          <div style={styles.weightPanel}>
            <div style={styles.weightHead}>
              <span style={styles.weightTitle}>PRIORITY WEIGHTING</span>
              <button
                style={styles.resetBtn}
                onClick={() => setWeights(DEFAULT_WEIGHTS)}
                disabled={
                  weights.exposure === DEFAULT_WEIGHTS.exposure &&
                  weights.dollars === DEFAULT_WEIGHTS.dollars &&
                  weights.urgency === DEFAULT_WEIGHTS.urgency &&
                  weights.health === DEFAULT_WEIGHTS.health
                }
              >
                reset
              </button>
            </div>
            <div style={styles.weightGrid}>
              {[
                { key: "exposure", label: "Exposure" },
                { key: "dollars", label: "ARR" },
                { key: "urgency", label: "Renewal urgency" },
                { key: "health", label: "Health drag" },
              ].map((w) => {
                const wSum =
                  weights.exposure + weights.dollars + weights.urgency + weights.health || 1;
                const share = Math.round((weights[w.key] / wSum) * 100);
                return (
                  <div key={w.key} style={styles.weightItem}>
                    <div style={styles.weightLabelRow}>
                      <span style={styles.weightLabel}>{w.label}</span>
                      <span style={styles.weightPct}>{share}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(weights[w.key] * 100)}
                      onChange={(e) =>
                        setWeights((prev) => ({ ...prev, [w.key]: Number(e.target.value) / 100 }))
                      }
                      style={styles.slider}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div style={styles.benchPanel}>
            {filteredBook.length === 0 && (
              <div style={styles.emptyState}>No accounts match this size + region.</div>
            )}
            {[...filteredBook]
              .map((a) => ({ acct: a, p: priorityScore(a, weights) }))
              .sort((x, y) => y.p.value - x.p.value)
              .map(({ acct, p }, rank) => {
                const tier = priorityTier(p.value);
                const soon = acct.renewalDays <= 90;
                return (
                  <div
                    key={acct.id}
                    style={styles.queueRow}
                    onClick={() => setSelected(acct)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelected(acct);
                    }}
                    title="View account detail"
                  >
                    <span style={styles.queueRank}>{rank + 1}</span>

                    <div style={styles.queueMain}>
                      <div style={styles.queueNameRow}>
                        <span style={styles.benchAcct}>{acct.name}</span>
                        <span style={{ ...styles.tierChip, borderColor: tier.color, color: tier.color }}>
                          {tier.label}
                        </span>
                      </div>
                      <div style={styles.queueFactors}>
                        <span style={styles.factor}>{ordinal(p.pct)} pct exposure</span>
                        <span style={styles.factorDot}>·</span>
                        <span style={styles.factor}>{fmtArr(acct.arr)} ARR</span>
                        <span style={styles.factorDot}>·</span>
                        <span style={{ ...styles.factor, color: soon ? "var(--amber)" : "var(--fog-dim)" }}>
                          renews {acct.renewalDays}d
                        </span>
                        <span style={styles.factorDot}>·</span>
                        <span style={{ ...styles.factor, color: acct.health < 50 ? "var(--coral)" : "var(--fog-dim)" }}>
                          health {acct.health}
                        </span>
                        {acct.coverage < 60 && (
                          <>
                            <span style={styles.factorDot}>·</span>
                            <span style={{ ...styles.factor, color: "var(--amber)" }}>
                              {acct.coverage}% scanned
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* priority meter */}
                    <div style={styles.queueScoreWrap}>
                      <div style={styles.meterTrack}>
                        <div
                          style={{
                            ...styles.meterFill,
                            width: `${p.value}%`,
                            background: tier.color,
                          }}
                        />
                      </div>
                      <span style={{ ...styles.queueScore, color: tier.color }}>{p.value}</span>
                    </div>
                  </div>
                );
              })}
          </div>
          <div style={styles.benchNote}>
            Priority blends exposure percentile, ARR, renewal urgency, and health drag — adjust the
            weights above and the queue re-ranks live. Click any account for findings + recommended
            play. Defaults are a synthetic first cut; calibrate against real churn outcomes with the
            team. (Synthetic data.)
          </div>
        </section>

        {/* INDUSTRY GRID */}
        <section>
          <div style={styles.sectionLabel}>SIGNAL BY INDUSTRY</div>
          <div className="pulse-industry-grid">
            {industries.map((ind) => {
              const val = ind.series[ind.series.length - 1].v;
              const prev = ind.series[Math.max(0, ind.series.length - 6)].v;
              const delta = Math.round((val - prev) * 10) / 10;
              const r = riskLabel(val);
              const up = delta >= 0;
              // rising risk (up) is bad -> coral; falling risk is good -> lime
              const deltaColor = up ? "var(--coral)" : "var(--lime)";
              const gid = `spark-${ind.key}`;
              const mineCount = BOOK.filter((a) => a.industry === ind.key).length;
              return (
                <div
                  key={ind.key}
                  style={styles.card}
                  onClick={() => { setSpinPaused(false); setGraphIndustry(ind.key); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { setSpinPaused(false); setGraphIndustry(ind.key); }
                  }}
                  title={`Explore ${ind.name} customer graph`}
                >
                  <div style={{ ...styles.cardAccent, background: r.color }} />
                  <div style={styles.cardBody}>
                    <div style={styles.cardTop}>
                      <span style={styles.cardName}>{ind.name}</span>
                      <span
                        style={{
                          ...styles.statusPill,
                          color: r.color,
                          borderColor: r.color,
                          background: `${r.color}1a`,
                        }}
                      >
                        {r.label}
                      </span>
                    </div>

                    <div style={styles.cardNumberRow}>
                      <span style={styles.cardNumberWrap}>
                        <span style={styles.cardNumber}>{val.toFixed(1)}</span>
                        <span style={styles.cardScale}>/100</span>
                      </span>
                      <span
                        style={{
                          ...styles.deltaBadge,
                          color: deltaColor,
                          background: up ? "rgba(255,93,93,0.12)" : "rgba(191,255,162,0.12)",
                        }}
                      >
                        {up ? "▲" : "▼"} {Math.abs(delta)}
                      </span>
                    </div>

                    <div style={styles.cardExplore}>
                      <span>{mineCount} in your book</span>
                      <span style={styles.exploreArrow}>explore ↗</span>
                    </div>
                  </div>

                  <div style={styles.cardChart}>
                    <ResponsiveContainer width="100%" height={56}>
                      <AreaChart data={ind.series} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={r.color} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={r.color} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <YAxis domain={[0, 100]} hide />
                        <Area
                          type="monotone"
                          dataKey="v"
                          stroke={r.color}
                          strokeWidth={2}
                          fill={`url(#${gid})`}
                          isAnimationActive={true}
                          animationDuration={500}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* BENCHMARK — YOUR BOOK vs THE FIELD */}
        <section>
          <div style={styles.benchHead}>
            <div style={styles.sectionLabel}>YOUR BOOK vs THE FIELD</div>
            <div style={styles.benchLegend}>
              <span style={styles.legendItem}>
                <span style={{ ...styles.legendSwatch, background: "var(--fog-dim)" }} />
                peer range (25th–75th)
              </span>
              <span style={styles.legendItem}>
                <span style={{ ...styles.legendTick }} />
                cohort median
              </span>
              <span style={styles.legendItem}>
                <span style={{ ...styles.legendDot, background: "var(--lilac)" }} />
                your account
              </span>
            </div>
          </div>

          <div style={styles.benchPanel}>
            {filteredBook.length === 0 && (
              <div style={styles.emptyState}>No accounts match this size + region.</div>
            )}
            {filteredBook.map((acct) => {
              const pct = percentile(acct.score, acct.industry);
              // higher percentile = more exposed than peers = worse
              const worse = pct >= 50;
              const posColor = pct >= 75 ? "var(--coral)" : pct >= 50 ? "var(--amber)" : "var(--lime)";
              const band = cohortBand(acct.industry); // per-cohort IQR + median (a)
              return (
                <div
                  key={acct.id}
                  style={styles.benchRow}
                  onClick={() => setSelected(acct)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelected(acct);
                  }}
                  title="View account detail"
                >
                  <div style={styles.benchName}>
                    <span style={styles.benchAcct}>{acct.name}</span>
                    <span style={styles.benchMeta}>
                      {COHORT[acct.industry].name} · {COHORT[acct.industry].n} peers
                    </span>
                  </div>

                  {/* distribution track: 0..100 exposure, peer IQR band + median tick + account dot */}
                  <div style={styles.track}>
                    <div style={{ ...styles.iqrBand, left: band.left, right: band.right }} />
                    <div style={{ ...styles.medianTick, left: band.median }} />
                    <div
                      style={{
                        ...styles.acctDot,
                        left: `${acct.score}%`,
                        background: posColor,
                        boxShadow: `0 0 0 4px ${posColor}22`,
                      }}
                      title={`Exposure ${acct.score} · ${ordinal(pct)} percentile`}
                    />
                  </div>

                  <div style={styles.benchPctWrap}>
                    <span style={{ ...styles.benchPct, color: posColor }}>{ordinal(pct)}</span>
                    <span style={styles.benchPctSub}>
                      {worse ? "more exposed" : "less exposed"} than peers
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={styles.benchNote}>
            Percentile = each account's exposure vs. its anonymized industry cohort. Higher =
            more exposed than peers → prioritize. The size/region filters above scope which of
            your accounts show; in production they'd also narrow the peer cohort itself (e.g.
            "Healthcare · 5K+ · NA" peers) — here the cohort median is industry-level only.
            Cohorts under 10 orgs are suppressed in the customer-facing view. (Synthetic data.)
          </div>
        </section>

        {/* FEED */}
        <section>
          <div style={styles.benchHead}>
            <div style={styles.sectionLabel}>PATTERN FEED</div>
            {pillarFilter !== "all" && (
              <button style={styles.decomposeBtn} onClick={() => setPillarFilter("all")}>
                filtered: {pillarName(pillarFilter)} ✕
              </button>
            )}
          </div>
          <div style={styles.feedPanel}>
            {(() => {
              const shown = feed.filter((item) => pillarFilter === "all" || item.pillar === pillarFilter);
              if (shown.length === 0) {
                return <div style={styles.emptyState}>No recent {pillarName(pillarFilter)} patterns in the feed.</div>;
              }
              return shown.map((item, idx) => (
                <div key={item.id} style={{ ...styles.feedRow, opacity: idx === 0 ? 1 : 0.86 }}>
                  <span style={{ ...styles.feedDot, background: `var(--${item.tone})` }} />
                  <span style={styles.feedText}>{item.text}</span>
                  {item.pillar && <span style={styles.feedPillar}>{pillarName(item.pillar)}</span>}
                  <span style={styles.feedTime}>{timeAgo(item.ts, now)}</span>
                </div>
              ));
            })()}
          </div>
        </section>
        </>)}

        {/* ================= TEAM (MANAGER) VIEW ================= */}
        {view === "team" && (() => {
          const tt = teamTotals();
          const ranked = [...TEAM].sort((a, b) => b.index - a.index);
          const maxArr = Math.max(...TEAM.map((m) => m.arr));
          const maxFindings = Math.max(...TEAM.map((m) => m.openFindings));
          const maxVel = Math.max(...TEAM.map((m) => m.closedVelocity));
          return (
            <>
              {/* team KPI strip */}
              <section style={styles.teamKpis}>
                <div style={styles.teamKpi}>
                  <span style={styles.teamKpiNum}>{TEAM.length}</span>
                  <span style={styles.teamKpiLbl}>CSEs</span>
                </div>
                <div style={styles.teamKpi}>
                  <span style={styles.teamKpiNum}>{tt.accounts}</span>
                  <span style={styles.teamKpiLbl}>accounts</span>
                </div>
                <div style={styles.teamKpi}>
                  <span style={styles.teamKpiNum}>{fmtArr(tt.arr)}</span>
                  <span style={styles.teamKpiLbl}>book ARR</span>
                </div>
                <div style={styles.teamKpi}>
                  <span style={{ ...styles.teamKpiNum, color: tt.atRisk ? "var(--coral)" : "var(--lime)" }}>{tt.atRisk}</span>
                  <span style={styles.teamKpiLbl}>books at risk (index ≥70)</span>
                </div>
                <div style={styles.teamKpi}>
                  <span style={styles.teamKpiNum}>{tt.openRem}</span>
                  <span style={styles.teamKpiLbl}>open remediations</span>
                </div>
              </section>

              {/* DRILL-DOWN: a single CSE's book */}
              {drillCSE && (() => {
                const book = bookForCSE(drillCSE);
                const totalArr = book.reduce((s, a) => s + a.arr, 0);
                return (
                  <section style={styles.teamPanel}>
                    <div style={styles.drillHead}>
                      <button style={styles.backBtn} onClick={() => setDrillCSE(null)}>← Back to team</button>
                      <div style={styles.drillTitle}>
                        {drillCSE.name}'s book
                        <span style={styles.drillSub}>
                          {book.length} accounts · {fmtArr(totalArr)} · index {drillCSE.index}
                        </span>
                      </div>
                    </div>
                    {book.map((a) => {
                      const r = riskLabel(a.score);
                      const pills = [...new Set(a.findings.map((f) => f.pillar))];
                      return (
                        <div
                          key={a.id}
                          style={styles.csRow}
                          onClick={() => { setGraphReturn(null); setSelected(a); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelected(a); }}
                          title={`Open ${a.name}`}
                        >
                          <span style={{ ...styles.csRank, color: r.color }}>●</span>
                          <div style={styles.csName}>
                            {a.name}
                            <span style={styles.csSub}>{COHORT[a.industry].name} · {fmtArr(a.arr)} · renews {a.renewalDays}d</span>
                          </div>
                          <span style={styles.csTrack}>
                            <span style={{ ...styles.csFill, width: `${a.score}%`, background: r.color }} />
                          </span>
                          <span style={{ ...styles.csIndex, color: r.color }}>{a.score}</span>
                          <span style={styles.csSubRight}>{pills.length} pillars</span>
                        </div>
                      );
                    })}
                    <div style={styles.benchNote}>Click any account to open its full detail + remediation playbooks. (Synthetic book for {drillCSE.name}.)</div>
                  </section>
                );
              })()}

              {/* lens tabs (hidden while drilled into a CSE) */}
              {!drillCSE && (<>
              <div style={styles.teamTabs}>
                {[
                  { k: "heat", label: "Whose book is heating up" },
                  { k: "load", label: "Workload balance" },
                  { k: "velocity", label: "Remediation velocity" },
                ].map((t) => (
                  <button
                    key={t.k}
                    style={{ ...styles.teamTab, ...(teamTab === t.k ? styles.teamTabActive : {}) }}
                    onClick={() => setTeamTab(t.k)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* LENS 1: heat — per-CSE risk, ranked */}
              {teamTab === "heat" && (
                <section style={styles.teamPanel}>
                  <div style={styles.benchNote}>Ranked by composite risk index. Rising books (▲) are where to focus coaching + air cover. (Synthetic team data.)</div>
                  {ranked.map((m, i) => {
                    const r = riskLabel(m.index);
                    return (
                      <div key={m.id} style={styles.csRow} onClick={() => setDrillCSE(m)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDrillCSE(m); }}
                        title={`Drill into ${m.name}'s book`}>
                        <span style={styles.csRank}>{i + 1}</span>
                        <div style={styles.csName}>
                          {m.name}{m.self && <span style={styles.csYou}>you</span>}
                          <span style={styles.csSub}>{m.accounts} accounts · {fmtArr(m.arr)}</span>
                        </div>
                        <span style={styles.csTrack}>
                          <span style={{ ...styles.csFill, width: `${m.index}%`, background: r.color }} />
                        </span>
                        <span style={{ ...styles.csIndex, color: r.color }}>{m.index}</span>
                        <span style={{ ...styles.csDelta, color: m.delta >= 0 ? "var(--coral)" : "var(--lime)" }}>
                          {m.delta >= 0 ? "▲" : "▼"}{Math.abs(m.delta)}
                        </span>
                      </div>
                    );
                  })}
                </section>
              )}

              {/* LENS 2: load — workload balance */}
              {teamTab === "load" && (
                <section style={styles.teamPanel}>
                  <div style={styles.benchNote}>Accounts, open findings, and open remediations per CSE — spot who's overloaded vs. who has capacity. (Synthetic team data.)</div>
                  {[...TEAM].sort((a, b) => b.openFindings - a.openFindings).map((m) => (
                    <div key={m.id} style={styles.csRow} onClick={() => setDrillCSE(m)} role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDrillCSE(m); }}
                      title={`Drill into ${m.name}'s book`}>
                      <div style={styles.csName}>
                        {m.name}{m.self && <span style={styles.csYou}>you</span>}
                        <span style={styles.csSub}>{m.accounts} accounts · {m.remediations.open} open remediations</span>
                      </div>
                      <span style={styles.csTrack}>
                        <span style={{ ...styles.csFill, width: `${Math.round((m.openFindings / maxFindings) * 100)}%`, background: "var(--lilac)" }} />
                      </span>
                      <span style={styles.csIndex}>{m.openFindings.toLocaleString()}</span>
                      <span style={styles.csSubRight}>findings</span>
                    </div>
                  ))}
                </section>
              )}

              {/* LENS 3: velocity — remediation scoreboard */}
              {teamTab === "velocity" && (
                <section style={styles.teamPanel}>
                  <div style={styles.benchNote}>Remediations closed per quarter + weekly velocity — the team's proof-of-value, and who may need help. (Synthetic team data.)</div>
                  {[...TEAM].sort((a, b) => b.remediations.closedQtr - a.remediations.closedQtr).map((m) => {
                    const slow = m.closedVelocity < 10;
                    return (
                      <div key={m.id} style={styles.csRow} onClick={() => setDrillCSE(m)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDrillCSE(m); }}
                        title={`Drill into ${m.name}'s book`}>
                        <div style={styles.csName}>
                          {m.name}{m.self && <span style={styles.csYou}>you</span>}
                          <span style={styles.csSub}>{m.remediations.closedQtr} closed this quarter</span>
                        </div>
                        <span style={styles.csTrack}>
                          <span style={{ ...styles.csFill, width: `${Math.round((m.closedVelocity / maxVel) * 100)}%`, background: slow ? "var(--amber)" : "var(--lime)" }} />
                        </span>
                        <span style={{ ...styles.csIndex, color: slow ? "var(--amber)" : "var(--lime)" }}>{m.closedVelocity}</span>
                        <span style={styles.csSubRight}>/wk{slow ? " · needs help" : ""}</span>
                      </div>
                    );
                  })}
                </section>
              )}
              </>)}

              <div style={styles.benchNote}>
                Manager view — Bob Sugg's CSE team. "My Book" (top toggle) shows your own accounts in
                full. Click a CSE to drill into their book. Real wiring: roster + per-CSE books from
                Salesforce owner + Vitally + DataPort.
              </div>
            </>
          );
        })()}
      </main>

      <footer style={styles.footer}>
        Demo build with synthetic data — wire to live finding events + account metadata to make
        this real. All signal is aggregate and anonymized by design; no account is ever named.
      </footer>

      {/* ACCOUNT DETAIL DRAWER (b) */}
      {selected && (() => {
        const pct = percentile(selected.score, selected.industry);
        const posColor = pct >= 75 ? "var(--coral)" : pct >= 50 ? "var(--amber)" : "var(--lime)";
        const r = riskLabel(selected.score);
        const closeDrawer = () => { setSelected(null); setGraphReturn(null); };
        const backToGraph = () => { const g = graphReturn; setSelected(null); setGraphReturn(null); setSpinPaused(false); setGraphIndustry(g); };
        return (
          <div style={styles.overlay} onClick={closeDrawer}>
            <div style={styles.drawer} onClick={(e) => e.stopPropagation()}>
              {graphReturn && (
                <button style={styles.backBtn} onClick={backToGraph}>
                  ← Back to {COHORT[graphReturn].name} graph
                </button>
              )}
              <div style={styles.drawerHead}>
                <div>
                  <div style={styles.drawerName}>{selected.name}</div>
                  <div style={styles.drawerMeta}>
                    {COHORT[selected.industry].name} · {selected.size}
                  </div>
                </div>
                <button style={styles.closeBtn} onClick={closeDrawer} aria-label="Close">
                  ✕
                </button>
              </div>

              <div style={styles.drawerStats}>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>EXPOSURE</div>
                  <div style={{ ...styles.statValue, color: r.color }}>{selected.score}</div>
                  <div style={{ ...styles.riskChip, borderColor: r.color, color: r.color, marginTop: 4 }}>
                    {r.label}
                  </div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>VS PEERS</div>
                  <div style={{ ...styles.statValue, color: posColor }}>{ordinal(pct)}</div>
                  <div style={styles.statSub}>
                    {pct >= 50 ? "more" : "less"} exposed · {COHORT[selected.industry].n} orgs
                  </div>
                </div>
              </div>

              <div style={styles.drawerStats}>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>ARR · RENEWAL</div>
                  <div style={{ ...styles.statValue, fontSize: 24, color: "#F6E8FF" }}>
                    {fmtArr(selected.arr)}
                  </div>
                  <div style={{ ...styles.statSub, color: selected.renewalDays <= 90 ? "var(--amber)" : "var(--fog-dim)" }}>
                    renews in {selected.renewalDays} days
                  </div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>HEALTH · SCAN</div>
                  <div style={{ ...styles.statValue, fontSize: 24, color: selected.health < 50 ? "var(--coral)" : selected.health < 70 ? "var(--amber)" : "var(--lime)" }}>
                    {selected.health}
                  </div>
                  <div style={{ ...styles.statSub, color: selected.coverage < 60 ? "var(--amber)" : "var(--fog-dim)" }}>
                    {selected.coverage}% data scanned
                  </div>
                </div>
              </div>

              <div style={styles.drawerSection}>TOP FINDINGS</div>
              <div>
                {selected.findings.map((f, i) => (
                  <div key={i} style={styles.findingRow}>
                    <span style={styles.findingLabel}>{f.label}</span>
                    {f.pillar
                      ? <span style={styles.pillarTag}>{pillarName(f.pillar)}</span>
                      : <span />}
                    <span style={styles.findingCount}>{f.count.toLocaleString()}</span>
                    <span
                      style={{
                        ...styles.findingTrend,
                        color: f.trend >= 0 ? "var(--coral)" : "var(--lime)",
                      }}
                    >
                      {f.trend >= 0 ? "▲" : "▼"} {Math.abs(f.trend)}%
                    </span>
                  </div>
                ))}
              </div>

              <div style={styles.drawerSection}>RECOMMENDED PLAY</div>
              <div style={styles.playBox}>{selected.play}</div>

              <div style={styles.drawerSection}>REMEDIATION PLAYBOOKS</div>
              <div style={styles.pbBtnRow}>
                {[...new Set(selected.findings.map((f) => f.pillar).filter(Boolean))].map((pk) => (
                  <button
                    key={pk}
                    style={styles.pbLaunchBtn}
                    onClick={() => { setCopied(false); setPlaybook({ key: pk, targetIds: [selected.id] }); }}
                  >
                    {REMEDIATION_PLAYBOOKS[pk]?.title || pillarName(pk)} →
                  </button>
                ))}
              </div>

              <div style={styles.drawerNote}>
                Synthetic data. In production this pulls the account's live findings, its
                percentile vs. the anonymized cohort, and a play mapped from the dominant pattern.
              </div>
            </div>
          </div>
        );
      })()}

      {/* INDUSTRY NEURAL GRAPH (internal — accounts named) */}
      {graphIndustry && (() => {
        const nodes = industryGraph(graphIndustry);
        const meta = COHORT[graphIndustry];
        const W = 760, H = 560, cx = W / 2, cy = H / 2;
        const mineN = nodes.filter((n) => n.mine).length;

        // ---- Pseudo-3D: fixed points on a Fibonacci sphere, spun about Y,
        //      then perspective-projected. Depth drives size/opacity + paint order.
        const R = Math.min(W, H) / 2 - 70;   // sphere radius
        const FOV = 900;                      // perspective focal length
        const N = nodes.length;
        const laid = nodes.map((n, i) => {
          // even distribution on a sphere
          const yUnit = 1 - (i / Math.max(1, N - 1)) * 2;   // 1 → -1
          const rAtY = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
          const theta = i * 2.399963229728653;              // golden angle
          let x0 = Math.cos(theta) * rAtY;
          const y0 = yUnit;
          let z0 = Math.sin(theta) * rAtY;
          // rotate about Y by the current spin
          const cosS = Math.cos(spin), sinS = Math.sin(spin);
          const x = x0 * cosS - z0 * sinS;
          const z = x0 * sinS + z0 * cosS;
          // perspective projection (z in [-1,1] → scale)
          const zWorld = z * R;
          const persp = FOV / (FOV - zWorld);
          const depth = (z + 1) / 2; // 0 (back) → 1 (front)
          return {
            ...n,
            px: cx + x * R * persp,
            py: cy + y0 * R * persp,
            depth,
            persp,
            rad: (6 + Math.min(16, n.arr / 50000)) * persp,
            color: riskLabel(n.score).color,
          };
        });
        // paint back-to-front so near nodes overlap far ones
        const painted = [...laid].sort((a, b) => a.depth - b.depth);
        return (
          <div style={styles.overlay} onClick={() => setGraphIndustry(null)}>
            <div style={styles.graphModal} onClick={(e) => e.stopPropagation()}>
              <div style={styles.graphHead}>
                <div>
                  <div style={styles.graphTitle}>{meta.name}</div>
                  <div style={styles.graphSub}>
                    {mineN} in your book · {meta.n} orgs in cohort · nodes sized by ARR, colored by
                    exposure · rotating 3D — hover to pause
                  </div>
                </div>
                <button style={styles.closeBtn} onClick={() => setGraphIndustry(null)} aria-label="Close">
                  ✕
                </button>
              </div>

              <svg
                viewBox={`0 0 ${W} ${H}`}
                style={styles.graphSvg}
                role="img"
                onMouseEnter={() => setSpinPaused(true)}
                onMouseLeave={() => setSpinPaused(false)}
              >
                <defs>
                  <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#D28EFF" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#D28EFF" stopOpacity={0} />
                  </radialGradient>
                </defs>

                {/* edges hub -> node (depth-faded) */}
                {painted.map((n) => {
                  const edgeOp = (n.mine ? 0.5 : 0.14) * (0.35 + n.depth * 0.65);
                  return (
                    <line
                      key={`e-${n.id}`}
                      x1={cx}
                      y1={cy}
                      x2={n.px}
                      y2={n.py}
                      stroke={`rgba(210,142,255,${edgeOp.toFixed(3)})`}
                      strokeWidth={(n.mine ? 1.6 : 1) * n.persp}
                    />
                  );
                })}

                {/* hub */}
                <circle cx={cx} cy={cy} r={70} fill="url(#hubGlow)" />
                <circle cx={cx} cy={cy} r={30} fill="#1B0E2B" stroke="#D28EFF" strokeWidth={1.5} />
                <text x={cx} y={cy - 2} textAnchor="middle" style={styles.hubText}>
                  {graphIndustry.toUpperCase()}
                </text>
                <text x={cx} y={cy + 13} textAnchor="middle" style={styles.hubSub}>
                  {meta.n} orgs
                </text>

                {/* nodes — painted back-to-front, depth drives size + opacity */}
                {painted.map((n) => {
                  const baseOp = n.mine ? 0.95 : 0.5;
                  const op = baseOp * (0.4 + n.depth * 0.6); // far = dimmer
                  return (
                    <g
                      key={n.id}
                      style={{ cursor: n.mine ? "pointer" : "default" }}
                      onClick={() => {
                        if (n.mine) {
                          const acct = BOOK.find((a) => a.id === n.id);
                          if (acct) { setGraphReturn(graphIndustry); setGraphIndustry(null); setSelected(acct); }
                        }
                      }}
                    >
                      {n.mine && (
                        <circle cx={n.px} cy={n.py} r={n.rad + 5} fill="#D28EFF22" />
                      )}
                      <circle
                        cx={n.px}
                        cy={n.py}
                        r={n.rad}
                        fill={n.color}
                        fillOpacity={op}
                        stroke={n.mine ? "#F6E8FF" : "none"}
                        strokeWidth={n.mine ? 1.5 * n.persp : 0}
                      />
                      {n.mine && n.depth > 0.35 && (
                        <text
                          x={n.px}
                          y={n.py + n.rad + 12}
                          textAnchor="middle"
                          style={{ ...styles.nodeLabel, fill: "#F6E8FF", opacity: n.depth }}
                        >
                          {n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              <div style={styles.graphLegend}>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, background: "#D28EFF", boxShadow: "0 0 0 3px #D28EFF33" }} />
                  your account (click to open)
                </span>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, background: "var(--coral)" }} /> elevated
                </span>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, background: "var(--amber)" }} /> watch
                </span>
                <span style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, background: "var(--lime)" }} /> baseline
                </span>
                <span style={{ ...styles.graphNote }}>
                  Peer nodes are synthetic &amp; anonymized; your accounts are named (internal view).
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* REMEDIATION PLAYBOOK — concise, actionable steps grounded in Cyera actions */}
      {playbook && (() => {
        const pb = REMEDIATION_PLAYBOOKS[playbook.key];
        if (!pb) return null;
        const targets = playbook.targetIds
          .map((id) => BOOK.find((a) => a.id === id))
          .filter(Boolean);
        const close = () => { setPlaybook(null); setCopied(false); setNotionPushed(false); };
        const copySteps = () => {
          const text =
            `Cyera Pulse — Remediation: ${pb.title}\n` +
            `Where: ${pb.where}\n` +
            (targets.length ? `Accounts: ${targets.map((t) => t.name).join(", ")}\n` : "") +
            `\n` +
            pb.steps.map((s, i) => `${i + 1}. ${s.do}`).join("\n");
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
          setCopied(true);
        };
        // Push to Notion goes through the BFF (browser can't call Notion directly).
        // Today it prepares the project payload + confirms; wire to the BFF to persist.
        const pushToNotion = () => setNotionPushed(true);
        return (
          <div style={styles.overlay} onClick={close}>
            <div style={styles.deployModal} onClick={(e) => e.stopPropagation()}>
              <div style={styles.graphHead}>
                <div>
                  <div style={styles.graphTitle}>{pb.title}</div>
                  <div style={styles.graphSub}>
                    {pb.where} · <span style={{ color: "var(--lime)" }}>{pb.est}</span>
                  </div>
                </div>
                <button style={styles.closeBtn} onClick={close} aria-label="Close">✕</button>
              </div>

              {targets.length > 0 && (
                <div style={styles.pbTargets}>
                  Applies to: {targets.map((t) => (
                    <span
                      key={t.id}
                      style={styles.pbTargetChip}
                      onClick={() => { setPlaybook(null); setGraphReturn(null); setSelected(t); }}
                      title={`Open ${t.name}`}
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              )}

              <div style={styles.drawerSection}>STEPS</div>
              <div>
                {pb.steps.map((s, i) => (
                  <div key={i} style={styles.pbStep}>
                    <span style={styles.pbStepNum}>{i + 1}</span>
                    <div style={styles.pbStepBody}>
                      <div style={styles.pbStepDo}>{s.do}</div>
                      <div style={styles.pbStepWhy}>{s.why}</div>
                    </div>
                  </div>
                ))}
              </div>

              {notionPushed && (
                <div style={styles.notionConfirm}>
                  ✓ Project “{pb.title}” prepared for Notion with {pb.steps.length} checklist items
                  {targets.length ? ` for ${targets.map((t) => t.name).join(", ")}` : ""}. Assign an
                  owner and due date in Notion to kick it off.
                </div>
              )}
              <div style={styles.deployActions}>
                <button style={styles.deployCancel} onClick={copySteps}>
                  {copied ? "✓ copied" : "Copy steps"}
                </button>
                <button style={styles.deployGo} onClick={pushToNotion} disabled={notionPushed}>
                  {notionPushed ? "✓ Created in Notion" : pb.action + " →"}
                </button>
              </div>

              <div style={styles.drawerNote}>
                Steps map to Cyera's built-in remediation actions. "Create Project in Notion" pushes
                these steps as a checklist to the team's Notion workspace (via the backend when
                wired) so anyone can pick it up, assign, and track to done. Human-run — no autonomous
                changes. (Synthetic account data.)
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const styles = {
  page: {
    /* Cyera brand palette (Employee Brand Kit 2026) */
    "--bg": "#160923",              /* Black */
    "--panel": "rgba(109,45,147,0.12)",   /* Aubergine tint — elevated surface */
    "--panel-alt": "rgba(109,45,147,0.20)",
    "--fog": "rgba(232,198,255,0.66)",    /* Haze, muted body text */
    "--fog-dim": "rgba(232,198,255,0.42)",
    "--lilac": "#D28EFF",          /* brand accent — mark, LIVE, glow */
    "--lime": "#BFFFA2",           /* brand accent — Baseline / improving */
    "--amber": "#F2A93B",          /* functional status (non-brand) — Watch */
    "--coral": "#FF5D5D",          /* functional status (non-brand) — Elevated */
    "--hair": "rgba(210,142,255,0.14)",   /* Lilac hairline */
    minHeight: "100vh",
    background: "var(--bg)",
    color: "#F6E8FF",              /* Whisper */
    fontFamily: "'Inter', sans-serif",
    padding: "28px 20px 60px",
    position: "relative",
    overflow: "hidden",
  },
  vignette: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(210,142,255,0.12), transparent 60%)",
    pointerEvents: "none",
  },
  header: {
    position: "relative",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "12px",
    maxWidth: 980,
    margin: "0 auto 28px",
  },
  brandRow: { display: "flex", alignItems: "center", gap: "12px" },
  mark: { width: 34, height: 34, display: "block" },
  brandTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: "0.08em",
  },
  brandSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog)",
    marginTop: 2,
  },
  liveRow: { display: "flex", alignItems: "center", gap: "8px", marginTop: 4 },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--lilac)",
    boxShadow: "0 0 0 3px rgba(210,142,255,0.20)",
  },
  liveText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.12em",
    color: "var(--lilac)",
  },
  srcBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    letterSpacing: "0.05em",
    border: "1px solid",
    borderRadius: 999,
    padding: "1px 7px",
  },
  updatedText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    marginLeft: 4,
  },
  main: { position: "relative", maxWidth: 980, margin: "0 auto", display: "grid", gap: 36 },
  viewToggle: {
    display: "inline-flex",
    gap: 4,
    padding: 4,
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 999,
    width: "fit-content",
  },
  viewTab: {
    background: "transparent",
    border: "none",
    color: "var(--fog)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    padding: "6px 18px",
    borderRadius: 999,
    cursor: "pointer",
  },
  viewTabActive: { background: "rgba(210,142,255,0.18)", color: "var(--lilac)" },
  teamKpis: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 14,
    padding: "18px 22px",
  },
  teamKpi: { display: "flex", flexDirection: "column", gap: 3, flex: "1 1 120px" },
  teamKpiNum: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 26,
    color: "#F6E8FF",
    lineHeight: 1,
  },
  teamKpiLbl: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    letterSpacing: "0.04em",
  },
  teamTabs: { display: "flex", flexWrap: "wrap", gap: 8 },
  teamTab: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    color: "var(--fog)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11.5,
    padding: "8px 14px",
    borderRadius: 999,
    cursor: "pointer",
  },
  teamTabActive: { borderColor: "var(--lilac)", color: "var(--lilac)", background: "rgba(210,142,255,0.10)" },
  teamPanel: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 14,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  csRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(150px,1.4fr) 1fr auto auto",
    alignItems: "center",
    gap: 14,
    padding: "12px 6px",
    borderBottom: "1px solid var(--hair)",
    cursor: "pointer",
    borderRadius: 8,
  },
  drillHead: { display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" },
  drillTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 17,
    color: "#F6E8FF",
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },
  drillSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    fontWeight: 400,
  },
  csRank: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 15,
    color: "var(--fog-dim)",
    width: 18,
    textAlign: "center",
  },
  csName: { display: "flex", flexDirection: "column", gap: 2, fontSize: 13.5, fontWeight: 600, color: "#F6E8FF" },
  csYou: {
    marginLeft: 8,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 8.5,
    color: "var(--lilac)",
    border: "1px solid rgba(210,142,255,0.4)",
    borderRadius: 999,
    padding: "1px 6px",
    fontWeight: 400,
  },
  csSub: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--fog-dim)", fontWeight: 400 },
  csSubRight: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--fog-dim)" },
  csTrack: { height: 8, borderRadius: 4, background: "rgba(232,198,255,0.08)", overflow: "hidden" },
  csFill: { display: "block", height: "100%", borderRadius: 4 },
  csIndex: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 16,
    textAlign: "right",
    minWidth: 44,
  },
  csDelta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    minWidth: 40,
    textAlign: "right",
  },
  mission: {
    display: "flex",
    flexWrap: "wrap",
    gap: 24,
    alignItems: "center",
    justifyContent: "space-between",
    background: "linear-gradient(135deg, rgba(210,142,255,0.10), rgba(191,255,162,0.05))",
    border: "1px solid rgba(210,142,255,0.24)",
    borderRadius: 16,
    padding: "22px 26px",
  },
  missionLeft: { flex: 1, minWidth: 280, maxWidth: 560 },
  missionEyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.16em",
    color: "var(--lilac)",
    marginBottom: 8,
  },
  missionLine: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 17,
    fontWeight: 500,
    lineHeight: 1.45,
    color: "#F6E8FF",
  },
  missionStats: { display: "flex", gap: 26, flexWrap: "wrap" },
  missionStat: { display: "flex", flexDirection: "column", gap: 3 },
  missionNum: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 22,
    color: "#F6E8FF",
    lineHeight: 1,
    transition: "color 0.3s ease",
  },
  missionLbl: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
    color: "var(--fog-dim)",
    letterSpacing: "0.04em",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 320px) 1fr",
    gap: 28,
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 14,
    padding: "28px 28px 20px",
    alignItems: "center",
  },
  heroLeft: { display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center" },
  eyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "var(--fog-dim)",
  },
  heroNumberRow: { display: "flex", alignItems: "baseline", justifyContent: "center", gap: 12, cursor: "pointer" },
  heroNumber: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 56,
    lineHeight: 1,
  },
  heroDelta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 14,
    fontWeight: 600,
  },
  riskChip: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.08em",
    border: "1px solid",
    borderRadius: 999,
    padding: "3px 10px",
    width: "fit-content",
  },
  heroChipRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 4, flexWrap: "wrap" },
  decomposeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--lilac)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
  },
  trajectory: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    fontSize: 12.5,
    color: "var(--fog)",
    lineHeight: 1.45,
    maxWidth: 320,
  },
  trajArrow: {
    color: "var(--coral)",
    fontSize: 16,
    lineHeight: 1,
    flexShrink: 0,
  },
  heroChart: { minWidth: 0 },
  chartLegendRow: { display: "flex", gap: 16, justifyContent: "flex-end", marginTop: 4 },
  chartLegendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
  },
  legendLine: { width: 14, height: 2, borderRadius: 2 },
  legendLineDash: {
    width: 14,
    height: 0,
    borderTop: "2px dashed var(--lilac)",
  },
  decomposePanel: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 14,
    padding: "18px 20px",
    marginTop: -18,
  },
  contribList: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  contribRow: {
    display: "grid",
    gridTemplateColumns: "minmax(120px,180px) 1fr 44px minmax(150px,180px)",
    alignItems: "center",
    gap: 12,
    padding: "10px 8px",
    borderRadius: 8,
    cursor: "pointer",
    borderBottom: "1px solid var(--hair)",
  },
  contribName: { fontSize: 13, fontWeight: 600, color: "#F6E8FF" },
  contribBarTrack: {
    height: 8,
    borderRadius: 4,
    background: "rgba(232,198,255,0.08)",
    overflow: "hidden",
  },
  contribBarFill: { display: "block", height: "100%", borderRadius: 4 },
  contribShare: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    textAlign: "right",
  },
  contribMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: "var(--fog-dim)",
    textAlign: "right",
  },
  pillarMixLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--fog-dim)",
    marginBottom: 8,
  },
  pillarMixBar: {
    display: "flex",
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
    gap: 2,
  },
  pillarMixSeg: { height: "100%" },
  pillarMixLegend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 8,
  },
  pillarMixLegItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: "var(--fog)",
  },
  pillarMixDot: { width: 8, height: 8, borderRadius: 2 },
  sectionLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "var(--fog-dim)",
    marginBottom: 12,
  },
  card: {
    position: "relative",
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 14,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    cursor: "pointer",
  },
  cardAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    opacity: 0.9,
  },
  cardBody: { padding: "18px 18px 8px" },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardName: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#E8C6FF",
    letterSpacing: "0.01em",
    lineHeight: 1.3,
    // reserve two lines so short + long names occupy equal height → rows align
    minHeight: 32,
    display: "flex",
    alignItems: "flex-start",
  },
  statusPill: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    border: "1px solid",
    borderRadius: 999,
    padding: "2px 8px",
    whiteSpace: "nowrap",
    flexShrink: 0,
    lineHeight: 1.4,
  },
  deltaBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 999,
    padding: "2px 8px",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
  },
  cardNumberRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 14,
  },
  cardNumberWrap: { display: "flex", alignItems: "baseline", gap: 5 },
  cardNumber: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 32,
    lineHeight: 1,
    color: "#F6E8FF",
    letterSpacing: "-0.02em",
  },
  cardScale: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "var(--fog-dim)",
  },
  cardExplore: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
  },
  exploreArrow: { color: "var(--lilac)", letterSpacing: "0.04em" },
  cardChart: { marginTop: "auto" },
  benchHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  queueRollup: { display: "flex", alignItems: "center" },
  predictPulse: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--lilac)",
    marginRight: 8,
    boxShadow: "0 0 0 3px rgba(210,142,255,0.25)",
    verticalAlign: "middle",
  },
  predictGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  predictCard: {
    position: "relative",
    background: "linear-gradient(160deg, rgba(210,142,255,0.10), rgba(109,45,147,0.06))",
    border: "1px solid rgba(210,142,255,0.28)",
    borderRadius: 14,
    padding: "16px 18px 18px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  predictTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  predictEta: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    color: "var(--lilac)",
    letterSpacing: "0.02em",
  },
  predictConf: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    letterSpacing: "0.06em",
  },
  predictHeadline: {
    fontSize: 14,
    lineHeight: 1.45,
    color: "#F6E8FF",
  },
  predictAcct: { fontWeight: 700 },
  predictPattern: { color: "var(--lilac)", fontWeight: 600 },
  predictBar: { display: "flex", flexDirection: "column", gap: 5 },
  predictBarFill: {
    height: 6,
    borderRadius: 3,
    background: "rgba(232,198,255,0.10)",
    overflow: "hidden",
  },
  predictBarInner: {
    height: "100%",
    borderRadius: 3,
    background: "linear-gradient(90deg, var(--lilac), var(--coral))",
  },
  predictBarLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog)",
  },
  predictBasis: {
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "var(--fog)",
  },
  predictAction: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#E8C6FF",
    background: "rgba(191,255,162,0.06)",
    border: "1px solid rgba(191,255,162,0.20)",
    borderRadius: 10,
    padding: "10px 12px",
    marginTop: "auto",
  },
  predictActionIcon: { color: "var(--lime)", flexShrink: 0 },
  ledger: {
    display: "flex",
    flexWrap: "wrap",
    gap: 20,
    alignItems: "stretch",
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
    padding: "14px 18px",
    marginBottom: 16,
  },
  ledgerStats: {
    display: "flex",
    gap: 22,
    alignItems: "center",
    paddingRight: 20,
    borderRight: "1px solid var(--hair)",
  },
  ledgerStat: { display: "flex", flexDirection: "column", gap: 2 },
  ledgerNum: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 24,
    color: "#F6E8FF",
    lineHeight: 1,
  },
  ledgerLbl: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
    color: "var(--fog-dim)",
    letterSpacing: "0.04em",
  },
  ledgerFeed: {
    flex: 1,
    minWidth: 260,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    justifyContent: "center",
  },
  ledgerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 11.5,
  },
  ledgerCheck: { fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, width: 12, flexShrink: 0 },
  ledgerAcct: { color: "#E8C6FF", fontWeight: 600, minWidth: 120 },
  ledgerPattern: { color: "var(--fog)", flex: 1 },
  ledgerDays: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    flexShrink: 0,
  },
  defenseBanner: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    background: "linear-gradient(135deg, rgba(191,255,162,0.10), rgba(210,142,255,0.08))",
    border: "1px solid rgba(191,255,162,0.30)",
    borderRadius: 14,
    padding: "16px 18px",
    marginBottom: 16,
  },
  defenseIcon: { fontSize: 26, flexShrink: 0 },
  defenseBody: { flex: 1, minWidth: 0 },
  defenseTitle: { fontSize: 14, fontWeight: 600, color: "#F6E8FF", lineHeight: 1.4 },
  defenseSub: { fontSize: 12, color: "var(--fog)", marginTop: 4, lineHeight: 1.45 },
  defenseBtn: {
    flexShrink: 0,
    background: "var(--lime)",
    color: "#160923",
    border: "none",
    borderRadius: 9,
    padding: "10px 16px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  deployModal: {
    margin: "auto",
    width: "min(520px, 94vw)",
    maxHeight: "92vh",
    overflow: "auto",
    background: "#1B0E2B",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    padding: "22px 24px 20px",
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
  },
  deployActions: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 },
  deployCancel: {
    background: "transparent",
    border: "1px solid var(--hair)",
    color: "var(--fog)",
    borderRadius: 9,
    padding: "9px 16px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    cursor: "pointer",
  },
  deployGo: {
    background: "var(--lime)",
    color: "#160923",
    border: "none",
    borderRadius: 9,
    padding: "9px 18px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  notionConfirm: {
    fontSize: 12.5,
    color: "#E8C6FF",
    lineHeight: 1.5,
    background: "rgba(191,255,162,0.08)",
    border: "1px solid rgba(191,255,162,0.24)",
    borderRadius: 10,
    padding: "12px 14px",
    marginTop: 16,
  },
  /* Remediation playbook modal */
  pbTargets: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    marginBottom: 4,
  },
  pbTargetChip: {
    color: "var(--lilac)",
    border: "1px solid rgba(210,142,255,0.35)",
    borderRadius: 999,
    padding: "2px 9px",
    cursor: "pointer",
  },
  pbStep: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: "11px 0",
    borderBottom: "1px solid var(--hair)",
  },
  pbStepNum: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    color: "var(--lime)",
    border: "1px solid rgba(191,255,162,0.4)",
    borderRadius: 999,
    width: 22,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pbStepBody: { display: "flex", flexDirection: "column", gap: 3 },
  pbStepDo: { fontSize: 13, color: "#F6E8FF", lineHeight: 1.4, fontWeight: 500 },
  pbStepWhy: { fontSize: 11.5, color: "var(--fog-dim)", lineHeight: 1.4 },
  pbBtnRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  pbLaunchBtn: {
    background: "rgba(210,142,255,0.10)",
    border: "1px solid rgba(210,142,255,0.32)",
    color: "var(--lilac)",
    borderRadius: 8,
    padding: "8px 12px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    cursor: "pointer",
    textAlign: "left",
  },
  rollupText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog)",
  },
  filterBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 24,
    marginBottom: 14,
    padding: "12px 16px",
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
  },
  filterGroup: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  filterLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--fog-dim)",
    marginRight: 2,
  },
  filterChip: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    background: "transparent",
    border: "1px solid var(--hair)",
    color: "var(--fog)",
    borderRadius: 999,
    padding: "4px 12px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  filterChipActive: {
    background: "rgba(210,142,255,0.16)",
    borderColor: "var(--lilac)",
    color: "var(--lilac)",
  },
  emptyState: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "var(--fog-dim)",
    textAlign: "center",
    padding: "28px 0",
  },
  pillarCard: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
    padding: "14px 14px 12px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    outline: "none",
    WebkitTapHighlightColor: "transparent",
    transition: "border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
  },
  pillarCardActive: {
    borderColor: "var(--lilac)",
    background: "rgba(210,142,255,0.10)",
    boxShadow: "0 0 0 1px var(--lilac)",
  },
  pillarGroup: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 8.5,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--fog-dim)",
  },
  pillarName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 15,
    color: "#F6E8FF",
  },
  pillarStatRow: { display: "flex", alignItems: "baseline", justifyContent: "center", gap: 5, marginTop: 4 },
  pillarFindings: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 20,
    color: "var(--lilac)",
    lineHeight: 1,
  },
  pillarFindingsLbl: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
    color: "var(--fog-dim)",
  },
  pillarMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
    color: "var(--fog)",
  },
  pillarTag: {
    justifySelf: "start",
    whiteSpace: "nowrap",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 8.5,
    letterSpacing: "0.06em",
    color: "var(--lilac)",
    border: "1px solid rgba(210,142,255,0.35)",
    borderRadius: 999,
    padding: "1px 6px",
  },
  feedPillar: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    letterSpacing: "0.05em",
    color: "var(--fog-dim)",
    border: "1px solid var(--hair)",
    borderRadius: 999,
    padding: "1px 7px",
    flexShrink: 0,
  },
  pillarExpandHint: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    color: "var(--lilac)",
    marginTop: 6,
  },
  pillarPanel: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 14,
    padding: "18px 20px",
    marginTop: 14,
  },
  pillarPanelHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  pillarPanelTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 16,
    color: "#F6E8FF",
  },
  pillarPanelBlurb: { fontSize: 12, color: "var(--fog-dim)" },
  pillarPanelCols: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 28,
  },
  pillarPanelCol: { minWidth: 0 },
  pillarColLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--fog-dim)",
    marginBottom: 10,
  },
  pillarAcctRow: {
    display: "grid",
    gridTemplateColumns: "minmax(90px,1fr) 70px auto auto",
    alignItems: "center",
    gap: 10,
    padding: "8px 6px",
    borderRadius: 8,
    cursor: "pointer",
    borderBottom: "1px solid var(--hair)",
  },
  pillarAcctName: { fontSize: 12.5, fontWeight: 600, color: "#F6E8FF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  pillarAcctBarTrack: { height: 6, borderRadius: 3, background: "rgba(232,198,255,0.08)", overflow: "hidden" },
  pillarAcctBarFill: { display: "block", height: "100%", borderRadius: 3, background: "var(--lilac)" },
  pillarAcctCount: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 600,
    fontSize: 12.5,
    color: "#E8C6FF",
    textAlign: "right",
  },
  pillarAcctTrend: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    fontWeight: 600,
    minWidth: 42,
    textAlign: "right",
  },
  pillarTypeRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "center",
    gap: 10,
    padding: "8px 6px",
    borderBottom: "1px solid var(--hair)",
  },
  pillarTypeLabel: { fontSize: 12, color: "#E8C6FF", lineHeight: 1.35 },
  pillarTypeCount: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 600,
    fontSize: 12.5,
    color: "#F6E8FF",
    textAlign: "right",
  },
  weightPanel: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
    padding: "14px 18px 16px",
    marginBottom: 14,
  },
  weightHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  weightTitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.14em",
    color: "var(--fog-dim)",
  },
  resetBtn: {
    background: "transparent",
    border: "1px solid var(--hair)",
    color: "var(--fog)",
    borderRadius: 6,
    padding: "3px 10px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    cursor: "pointer",
  },
  weightGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 18,
  },
  weightItem: { display: "flex", flexDirection: "column", gap: 6 },
  weightLabelRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  weightLabel: { fontSize: 12, color: "#E8C6FF" },
  weightPct: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    color: "var(--lilac)",
  },
  slider: { width: "100%", accentColor: "#D28EFF", cursor: "pointer" },
  queueRow: {
    display: "grid",
    gridTemplateColumns: "28px 1fr minmax(120px, 160px)",
    alignItems: "center",
    gap: 14,
    padding: "14px 8px",
    borderBottom: "1px solid var(--hair)",
    cursor: "pointer",
    borderRadius: 8,
    transition: "background 0.15s ease",
  },
  queueRank: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 18,
    color: "var(--fog-dim)",
    textAlign: "center",
  },
  queueMain: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 },
  queueNameRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  tierChip: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    letterSpacing: "0.1em",
    border: "1px solid",
    borderRadius: 999,
    padding: "2px 7px",
  },
  queueFactors: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  factor: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: "var(--fog)",
  },
  factorDot: { color: "var(--fog-dim)", fontSize: 10 },
  queueScoreWrap: { display: "flex", alignItems: "center", gap: 10 },
  meterTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: "rgba(232,198,255,0.08)",
    overflow: "hidden",
  },
  meterFill: { height: "100%", borderRadius: 3, transition: "width 0.4s ease" },
  queueScore: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 20,
    minWidth: 26,
    textAlign: "right",
  },
  benchLegend: { display: "flex", gap: 16, flexWrap: "wrap" },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
  },
  legendSwatch: { width: 18, height: 8, borderRadius: 2, opacity: 0.35 },
  legendTick: { width: 2, height: 12, background: "var(--fog)" },
  legendDot: { width: 9, height: 9, borderRadius: "50%" },
  benchPanel: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
    padding: "8px 20px",
  },
  benchRow: {
    display: "grid",
    gridTemplateColumns: "minmax(150px, 200px) 1fr minmax(120px, 150px)",
    alignItems: "center",
    gap: 18,
    padding: "16px 8px",
    borderBottom: "1px solid var(--hair)",
    cursor: "pointer",
    borderRadius: 8,
    transition: "background 0.15s ease",
  },
  benchName: { display: "flex", flexDirection: "column", gap: 2 },
  benchAcct: { fontSize: 14, fontWeight: 600, color: "#F6E8FF" },
  benchMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
  },
  track: {
    position: "relative",
    height: 14,
    borderRadius: 7,
    background: "rgba(232,198,255,0.06)",
  },
  iqrBand: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "37%", // ~25th pct of a median-58/sigma-15 field, visual approximation
    right: "22%", // ~75th pct
    background: "var(--fog-dim)",
    opacity: 0.28,
    borderRadius: 7,
  },
  medianTick: {
    position: "absolute",
    top: -3,
    bottom: -3,
    left: "50%",
    width: 2,
    background: "var(--fog)",
    transform: "translateX(-1px)",
  },
  acctDot: {
    position: "absolute",
    top: "50%",
    width: 12,
    height: 12,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    transition: "left 0.4s ease",
  },
  benchPctWrap: { display: "flex", flexDirection: "column", gap: 1, textAlign: "right" },
  benchPct: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20 },
  benchPctSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
  },
  benchNote: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    lineHeight: 1.5,
    marginTop: 10,
    maxWidth: 620,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(11,4,20,0.72)",
    backdropFilter: "blur(3px)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 50,
  },
  graphModal: {
    margin: "auto", // centers within the flex overlay
    width: "min(820px, 94vw)",
    maxHeight: "92vh",
    overflow: "auto",
    background: "#160923",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    padding: "22px 24px 20px",
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
  },
  graphHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 8,
  },
  graphTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 22,
    color: "#F6E8FF",
  },
  graphSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    marginTop: 4,
  },
  graphSvg: {
    width: "100%",
    height: "auto",
    display: "block",
  },
  hubText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    fill: "#F6E8FF",
    letterSpacing: "0.06em",
  },
  hubSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    fill: "rgba(232,198,255,0.6)",
  },
  nodeLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
  },
  graphLegend: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    marginTop: 8,
    paddingTop: 14,
    borderTop: "1px solid var(--hair)",
  },
  graphNote: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    marginLeft: "auto",
  },
  drawer: {
    width: "min(440px, 100%)",
    height: "100%",
    background: "#1B0E2B",
    borderLeft: "1px solid var(--hair)",
    padding: "26px 26px 40px",
    overflowY: "auto",
    boxShadow: "-24px 0 60px rgba(0,0,0,0.5)",
  },
  backBtn: {
    background: "rgba(210,142,255,0.12)",
    border: "1px solid var(--hair)",
    color: "var(--lilac)",
    borderRadius: 8,
    padding: "6px 12px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    cursor: "pointer",
    marginBottom: 16,
  },
  drawerHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  drawerName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 22,
    color: "#F6E8FF",
  },
  drawerMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    marginTop: 4,
  },
  closeBtn: {
    background: "transparent",
    border: "1px solid var(--hair)",
    color: "var(--fog)",
    borderRadius: 8,
    width: 30,
    height: 30,
    cursor: "pointer",
    fontSize: 13,
    flexShrink: 0,
  },
  drawerStats: { display: "flex", gap: 14, marginTop: 20 },
  statBox: {
    flex: 1,
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 10,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  statLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--fog-dim)",
  },
  statValue: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 30,
    marginTop: 4,
  },
  statSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    marginTop: 4,
  },
  drawerSection: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "var(--fog-dim)",
    marginTop: 24,
    marginBottom: 10,
  },
  findingRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto auto",
    alignItems: "center",
    gap: 12,
    padding: "10px 0",
    borderBottom: "1px solid var(--hair)",
  },
  findingLabel: { fontSize: 13, color: "#E8C6FF", lineHeight: 1.35 },
  findingCount: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 600,
    fontSize: 14,
    color: "#F6E8FF",
  },
  findingTrend: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    minWidth: 48,
    textAlign: "right",
  },
  playBox: {
    background: "rgba(191,255,162,0.06)",
    border: "1px solid rgba(191,255,162,0.22)",
    borderRadius: 10,
    padding: "14px 16px",
    fontSize: 13,
    lineHeight: 1.55,
    color: "#E8C6FF",
  },
  drawerNote: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--fog-dim)",
    lineHeight: 1.5,
    marginTop: 20,
  },
  feedPanel: {
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
    padding: "6px 18px",
  },
  feedRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 0",
    borderBottom: "1px solid var(--hair)",
    transition: "opacity 0.4s ease",
  },
  feedDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  feedText: { fontSize: 13, color: "#E8C6FF", lineHeight: 1.4, flex: 1 },
  feedTime: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    flexShrink: 0,
  },
  footer: {
    position: "relative",
    maxWidth: 980,
    margin: "36px auto 0",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--fog-dim)",
    textAlign: "center",
    lineHeight: 1.6,
  },
};
