/**
 * Backend-for-Frontend (BFF) — secure live-feed scaffold
 * ------------------------------------------------------
 * This is the ONLY tier that touches customer data. The browser talks
 * to this service; this service talks to your data source. Claude never
 * sits in this path.
 *
 * What this scaffold demonstrates (and what you replace for production):
 *   [AUTH]        validateToken()  -> swap the stub for real OIDC/JWT verification (Okta)
 *   [ENTITLE]     scopeForUser()   -> swap for your real per-user entitlement lookup
 *   [DATA]        loadMetrics()    -> swap the synthetic generator for your real query
 *
 * Everything marked SYNTHETIC returns fake data so you can run end-to-end
 * with zero access to real customer data.
 *
 * Run:  npm install && npm start   (defaults to http://localhost:8787)
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

// Security-critical logic lives in a framework-free, unit-testable module.
const {
  validateToken,
  scopeForUser,
  loadCollective,
  loadMyBook,
  loadMetrics,
} = require("./logic");

const app = express();
const PORT = process.env.PORT || 8787;

// Lock the origin down to your dashboard's host. In prod set ALLOWED_ORIGIN.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";

// ---- Security headers (CSP, HSTS, no-sniff, etc.) --------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // dashboard shell is served separately; it may call this API origin
        connectSrc: ["'self'", ALLOWED_ORIGIN],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  })
);

// ---- Tight CORS: only your dashboard origin, credentials allowed -----------
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  })
);

app.use(express.json({ limit: "16kb" }));

// Auth guard — delegates verification to logic.validateToken (swap the stub
// there for real OIDC/JWT verification). Rejects any request without a valid token.
function requireAuth(req, res, next) {
  const user = validateToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  next();
}

// ---- COLLECTIVE layer — aggregate, anonymized, SAME for everyone -----------
// Auth still required (it's internal), but the payload is not scoped: every
// entitled user benefits from the whole base. No account is ever named here.
app.get("/api/collective", requireAuth, (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(loadCollective());
});

// ---- ENTITLED layer — the caller's OWN (or team's) accounts, named ---------
// scopeForUser resolves the caller's entitled account IDs; loadMyBook filters
// to exactly those. Unentitled rows never leave the server.
app.get("/api/my-book", requireAuth, (req, res) => {
  const scope = scopeForUser(req.user);
  res.set("Cache-Control", "no-store");
  res.json(loadMyBook(scope));
});

// ---- Legacy combined endpoint (kept for the original dashboard) ------------
app.get("/api/metrics", requireAuth, (req, res) => {
  const scope = scopeForUser(req.user);
  res.set("Cache-Control", "no-store");
  res.json(loadMetrics(scope));
});

// ---- Health check (no auth) ------------------------------------------------
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`BFF listening on http://localhost:${PORT}`);
  console.log(`Allowed dashboard origin: ${ALLOWED_ORIGIN}`);
  console.log(`Collective (everyone): curl -H "Authorization: Bearer demo-token-cse" http://localhost:${PORT}/api/collective`);
  console.log(`My book (CSE):         curl -H "Authorization: Bearer demo-token-cse" http://localhost:${PORT}/api/my-book`);
  console.log(`My book (manager):     curl -H "Authorization: Bearer demo-token-manager" http://localhost:${PORT}/api/my-book`);
});
