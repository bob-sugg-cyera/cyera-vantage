# Cyera Vantage — Data Access & Entitlement Spec

How Vantage ingests **all** the data to generate insights while ensuring each
person only sees — and acts on — the accounts they're entitled to.

Demonstrated working (synthetic) in `logic.js` + `server.js`. This doc is the
production build guide.

---

## The principle: two layers, one pipeline

Every number in Vantage is one of two tiers, gated differently:

| Layer | What | Who sees it | Named? | Endpoint |
|---|---|---|---|---|
| **Collective** | Cross-account aggregates — cohort benchmarks, composite index, predictive patterns, pillar mix | Everyone (auth'd) | **Never** — anonymized + min-cohort floor | `GET /api/collective` |
| **Entitled** | The caller's own accounts (manager: their team's) — findings, drill-downs, remediation | Owner + their manager | **Yes** — fully named | `GET /api/my-book` |

The insight engine reads **all** accounts to compute Collective; the Entitled
layer is filtered to what the caller owns. **Aggregate broadly, expose narrowly.**

---

## Data flow

```
Cyera sources (ALL accounts)          BFF (only tier touching real data)        Browser (Vantage)
──────────────────────────           ──────────────────────────────────        ───────────────
Salesforce  → owner, ARR, industry ─┐
Vitally     → health score         ─┼─► loadCollective()  — aggregate all,  ──► Collective layer
DataPort    → findings, exposure   ─┘     strip identity, apply MIN_COHORT       (same for all)
                                     └─► loadMyBook(scope) — WHERE owner IN   ──► Entitled layer
                                          scope.ownerIds (source-side filter)     (only your accts)
```

**The entitlement key is the Salesforce account `owner`.** It's the source of
truth for "whose account is this." The team roster and every drill-down key off it.

---

## Authentication (the `[AUTH]` layer)

Auth answers **"who are you"**; entitlement (below) answers **"what can you see."**
They are separate steps — and keeping them separate is what makes the whole
model trustworthy: the ownership filter keys off an identity that is
cryptographically proven, never self-asserted by the browser.

### Identity provider: Okta (OIDC)
Cyera authenticates internal apps via **Okta**. Vantage should use the same SSO —
**zero new logins for the team**. Standard flow: **OIDC / OAuth2 Authorization
Code + PKCE** (correct for a browser SPA + BFF; no client secret in the browser).

```
Browser (Vantage SPA)        Okta (IdP)            BFF (server)            Cyera data
──────────────────        ──────────            ────────────            ──────────
1. no session → redirect ─► Okta login (SSO, MFA)
2. ◄── redirect back with authorization code
3. exchange code → ID token + access token (JWT)
4. GET /api/my-book ─────────────────────────► 5. verify JWT vs Okta JWKS
   Authorization: Bearer <access token>            (sig, iss, aud, exp)
                                                6. scopeForUser(claims) ─► WHERE owner IN…
                                                ◄── entitled data only
```

The browser **never holds a Cyera-data credential** — only a short-lived,
Okta-issued JWT. The BFF trusts it *only after verification*.

### What `validateToken` must do (replaces the demo-token stub)
The current `validateToken` does a dictionary lookup. Production must verify:

1. **Signature** — validate against Okta's **JWKS** (public keys from Okta's
   `/.well-known/jwks.json`, fetched + cached). Proves the token is genuinely
   from Okta and untampered.
2. **`iss`** — issuer matches your Okta authorization server exactly.
3. **`aud`** — audience is Vantage (token minted for this app, not another).
4. **`exp`** — not expired. Keep access-token lifetimes short (~15–60 min).
5. **Claims → identity** — extract stable `sub` + email → this is the input to
   `scopeForUser()`.

Any check fails → **401**. Never trust an unverified token. (Use a maintained
library — e.g. `jose` / `express-oauth2-jwt-bearer` — do not hand-roll JWT
verification.)

### Token storage
Hold the token in an **in-memory OIDC session** (or an httpOnly, Secure,
SameSite cookie) — **never `localStorage`** (XSS-exfiltratable). The demo
`getToken: () => "demo-token-admin"` in `../src/data/source.js` gets replaced by
the token from the Okta session.

### Manager scope from Okta groups (preferred)
Model the org hierarchy as **Okta groups** (e.g. `vantage-cse`, `vantage-manager`,
or a group per team) surfaced as a token claim. Then `scopeForUser` reads the
group claim instead of the hardcoded `TEAM_OF` map — the hierarchy lives in the
IdP, not the app. Fall back to a Salesforce/entitlements-table lookup if groups
don't model team membership.

### Questions for Platform / IT (before building)
These are **UNKNOWN** and must be confirmed — they're org config, not code:

- [ ] **Access proxy?** Does Cyera front internal apps with an access gateway /
  reverse proxy (e.g. Okta Access Gateway) that terminates auth *before* the
  app? If yes, the BFF may just read a trusted, proxy-injected identity header
  instead of verifying JWTs itself — significantly simpler. **Ask this first.**
- [ ] **App registration** — register Vantage as an OIDC app in Okta; obtain the
  **client ID** and configure the **redirect URI**.
- [ ] **Issuer / authorization-server URL** and expected **audience** value.
- [ ] **Groups** — do existing Okta groups model CSE team membership, or do we
  need a new entitlements source for the manager hierarchy?

---

## The three enforcement rules

1. **Scope at the source, never in the browser.**
   The entitled query applies `WHERE owner IN (:ownerIds)` as a **DB/API filter
   at the source** — unentitled rows never leave the BFF. Never fetch-all-then-
   filter-in-React. (This is the `[DATA]` marker in `logic.js`.)

2. **Entitlements come from a trusted lookup, not the client.**
   `scopeForUser()` = verify Okta identity → look up role + owned accounts +
   (if manager) team → return `{ userId, isManager, ownerIds, accountIds }`.
   The browser cannot assert what it owns; the BFF decides.

3. **Manager hierarchy is a wider scope, not a bypass.**
   A CSE's scope = their accounts. A manager's scope = `owner IN their_team`.
   Nobody gets "all company named data" unless explicitly entitled. The
   collective layer is the only thing everyone shares — and it's anonymized.

---

## Why the collective layer is safe to show everyone

Collective aggregates carry **no identity**, and the **minimum-cohort floor**
(`MIN_COHORT`, ~10 orgs) suppresses any cohort small enough to reverse-engineer.
"63% of Financial Services 5K+ orgs saw pattern X" reveals nothing about a
specific customer. That's what lets a CSE benefit from the whole base's signal
without seeing anyone else's accounts — and it's the privacy-preserving basis
for the "collective intelligence" vision.

---

## Production build checklist (replace the STUBs in `logic.js`)

| Function | Demo (now) | Production |
|---|---|---|
| `validateToken` `[AUTH]` | demo token → user | verify OIDC JWT against Okta JWKS (signature, issuer, audience, expiry) |
| `scopeForUser` `[ENTITLE]` | hardcoded team map | real org-hierarchy + account-ownership lookup (Salesforce owner + a role/entitlements table) |
| `loadCollective` `[DATA]` | in-memory aggregate | query aggregates across all accounts; enforce `MIN_COHORT`; return **no** identifiers |
| `loadMyBook` `[DATA]` | array filter | parameterized query `WHERE owner IN (:ownerIds)` against Salesforce/DataPort/Vitally; return named, entitled rows only |

Plus: TLS, `ALLOWED_ORIGIN` = dashboard host, token in in-memory OIDC session
(not localStorage), private data-source endpoints, and **audit logging** of who
accessed which entitled accounts.

---

## Verify (works today against the synthetic scaffold)

```bash
cd bff && npm install && npm start

# CSE sees only their book:
curl -H "Authorization: Bearer demo-token-cse"     localhost:8787/api/my-book
# Manager sees their whole team:
curl -H "Authorization: Bearer demo-token-manager" localhost:8787/api/my-book
# Collective — same for everyone, no names, small cohorts suppressed:
curl -H "Authorization: Bearer demo-token-cse"     localhost:8787/api/collective
# No token → 401:
curl -i localhost:8787/api/my-book
```

**Claude is only ever in the build plane. Customer data flows browser ↔ BFF ↔
source and never through Claude.**
