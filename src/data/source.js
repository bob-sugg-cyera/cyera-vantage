/* =========================================================================
   Cyera Pulse — data-source seam
   -------------------------------------------------------------------------
   The single place the frontend reaches for data. Today it returns the
   built-in SYNTHETIC model (Pulse's BOOK/pillars/etc. live in the component).
   When a real backend is ready, flip `enabled` on and point `apiBase` at the
   BFF (see ../bff). The browser only ever holds a short-lived bearer token
   from the IdP — never DB creds or API keys.

   SECURITY PRINCIPLE (inherited from the BFF scaffold):
   Customer data flows browser ↔ BFF ↔ source. Claude is only ever in the
   build plane and never sits in this data path.
   ========================================================================= */

export const DATA_CONFIG = {
  // Master switch. false = pure synthetic (current default, nothing changes).
  // true  = attempt the BFF, fall back to synthetic if unreachable.
  enabled: false,

  apiBase: "http://localhost:8787", // BFF origin (see ../bff/server.js)
  endpoint: "/api/metrics",
  pollMs: 15000,

  // In production this comes from the OIDC login flow, held in memory
  // (NOT localStorage). This demo value matches the BFF's demo-token stub.
  getToken: () => "demo-token-admin",
};

/* Connection states the UI can surface. */
export const CONN = {
  OFF: "off",            // synthetic-only, backend seam disabled
  CONNECTED: "connected", // live data from BFF
  FALLBACK: "fallback",   // backend enabled but unreachable → synthetic
};

/**
 * Fetch live metrics from the BFF. Returns the parsed payload or throws.
 * The shape the BFF must return to fully drive Pulse is documented in
 * ../bff/README.md — today's BFF serves a simpler metrics payload, so the
 * `loadMetrics` there needs to be extended to Pulse's model (book, pillars,
 * predictions, composite) before this replaces the in-component synthetic data.
 */
export async function fetchLive() {
  const res = await fetch(DATA_CONFIG.apiBase + DATA_CONFIG.endpoint, {
    headers: { Authorization: "Bearer " + DATA_CONFIG.getToken() },
    // credentials: "include"  // if you switch to cookie sessions
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/**
 * The one call the app makes. When disabled (default), resolves immediately
 * to { conn: OFF }. When enabled, tries the BFF and reports connected/fallback.
 * It never throws — the caller always gets a usable status so the page renders.
 */
export async function getMetrics() {
  if (!DATA_CONFIG.enabled) return { conn: CONN.OFF, data: null };
  try {
    const data = await fetchLive();
    return { conn: CONN.CONNECTED, data };
  } catch (_e) {
    return { conn: CONN.FALLBACK, data: null };
  }
}
