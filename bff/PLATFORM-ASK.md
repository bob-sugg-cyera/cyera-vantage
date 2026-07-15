# Cyera Vantage — go-live: what Platform/IT must confirm

The Vantage BFF code is written and tested for the two decisions already made:
**deploy on cyera-flux/K8s**, **auth via the access proxy** (BFF trusts a
proxy-injected identity header). The items below are the remaining UNKNOWNS —
they are org/infra config, not code, and none can be safely guessed. Each blocks
go-live.

## 1. Access proxy — identity header  ⛔ BLOCKER
- **What is the exact header name the access proxy injects** with the
  authenticated user's email? The code reads `IDENTITY_HEADER` (default
  `x-auth-request-email`, an oauth2-proxy convention — **unverified**).
- **Does the proxy also inject a signature/JWT** we should verify, or is the
  header trusted purely because the proxy is the only ingress path?
- **Which namespace + pod label is the proxy?** Needed for the NetworkPolicy
  that makes the header trustworthy (`deploy/vantage-bff.yaml`).

## 2. Snowflake service account  ⛔ BLOCKER
- The BFF needs **its own read-only service user** — it must NOT reuse the
  `CLAUDE_CODE_SERVICE` account (governance-restricted to Claude Code).
- Scope: `SELECT` on `CYERA_BI_DBT_PROD.CS.CS__CUSTOMER_RISK` and
  `CYERA_BI_DBT_PROD.PRODUCT.PRODUCT__TENANT_ISSUE_METRICS`, plus a small
  warehouse. Delivered as k8s Secret `vantage-bff-snowflake`
  (username/password/role/warehouse).

## 3. Ingress host + registry
- The public (VPN-internal) host for the dashboard → sets `ALLOWED_ORIGIN` and
  the frontend's `apiBase`.
- Container registry + CI to build/push `vantage-bff:<tag>`.

## 4. Manager hierarchy (needed for manager scope, not for CSE go-live)
- A CSE sees accounts where they are the SE (`SE_USER_EMAIL` = them) — works
  today. A **manager** should see their whole team's books. **What is the
  manager→reports source** — Okta groups (preferred) or an entitlements table?
  Until confirmed, a manager sees only their own SE'd accounts (documented in
  `server.js`, no data leak — just narrower than intended).

## Frontend switch (our side, after the above)
- Point `src/data/source.js` `DATA_CONFIG` at the BFF host, set `enabled: true`,
  `endpoint: "/api/my-book"` + `/api/collective`, and drop the demo `getToken`
  (the proxy handles auth — no browser-held token).
