# Secure live-feed dashboard — scaffold

Three pieces that keep Claude out of the customer-data path while giving the
dashboard a live feed:

- `../dashboard-live.html` — the frontend shell + fetch layer (polls the BFF, falls back to synthetic data if unreachable).
- `server.js` — the Backend-for-Frontend. The only tier that touches real data.
- `logic.js` — framework-free auth / entitlement / query logic (unit-tested).

## Run locally

```bash
cd bff
npm install
npm start          # http://localhost:8787
```

Then open `dashboard-live.html` in a browser. With the BFF running it shows
live (synthetic) data with a green "connected" status; with it stopped it
falls back to synthetic data and shows an amber status — so the page always renders.

Quick API check:

```bash
curl -H "Authorization: Bearer demo-token-admin"   http://localhost:8787/api/metrics   # us+eu, unmasked
curl -H "Authorization: Bearer demo-token-analyst" http://localhost:8787/api/metrics   # us only, masked
curl http://localhost:8787/api/metrics                                                 # 401
```

## What to replace for production (all in `logic.js`)

| Marker | Now (demo) | Production |
|---|---|---|
| `[AUTH]` `validateToken` | maps demo tokens to users | verify the OIDC JWT against Okta's JWKS (signature, issuer, audience, expiry) |
| `[ENTITLE]` `scopeForUser` | hardcoded region/role | look up the user's real entitlements |
| `[DATA]` `loadMetrics` | synthetic generator | your real parameterized query; apply `scope` as a WHERE clause at the source; return aggregates, not raw rows |

Also for production: serve over TLS, set `ALLOWED_ORIGIN` to your dashboard host,
move the frontend token into the in-memory OIDC session (not `localStorage`),
put the data source on a private endpoint, and add audit logging.

## Endpoints to add for go-live

| Endpoint | Method | Purpose | Notes |
|---|---|---|---|
| `/api/metrics` | GET | Live dashboard data | ✅ scaffolded. Extend `loadMetrics` to Pulse's model (book, pillars, predictions, composite). |
| `/api/notion/project` | POST | Create a remediation Project in Notion from a playbook | ⬜ TODO. Body: `{ playbookKey, targetIds, steps[] }`. The BFF holds the Notion token server-side and calls the Notion API to create the checklist page (browser must NOT hold the Notion credential). Return the created page URL so the frontend can link to it. Guard behind the same `requireAuth`; apply the caller's entitlements to the accounts referenced. |

The frontend's "Create Project in Notion" button (remediation playbook modal) currently
prepares + confirms the project client-side. To persist it, POST to `/api/notion/project`
here — same `browser → BFF → source` path, Notion token never leaves the server.

**Claude is only ever in the build plane. Customer data flows browser ↔ BFF ↔ source and never through Claude.**
