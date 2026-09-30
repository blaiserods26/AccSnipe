# RES-01 — Resolution: Antigravity Quota API

**Status:** Closed ✅
**Resolved:** 2026-09-30

---

## Answer

### Quota Structure (by plan)

| Plan | 5-hour rolling quota | Weekly cap | Notes |
|------|---------------------|------------|-------|
| **Free** | None / minimal | Weekly-only reset | Baseline quota, weekly refresh |
| **Plus** | Yes — refreshes every 5 hours | Yes — weekly hard cap | Exhausting weekly cap = multi-day lockout |
| **Pro** ($19.99/mo) | Yes — refreshes every 5 hours | Yes — higher weekly cap | Compute-effort based, not token-count |
| **Ultra** ($99.99–$199.99/mo) | Yes — most generous | Yes | Designed for sustained agentic workloads |

Quota unit = **compute effort** (not tokens). Complex tasks (multi-file, agentic) drain faster than chat.

### Quota Data Sources — Two Approaches

#### Option A: Local Loopback API (Primary — IDE must be running)
- Antigravity IDE runs a **local language server** that exposes live quota data
- Community tools (e.g. `antigravity-usage` npm package) use this loopback approach
- Reference implementation: `github.com/skainguyen1412/antigravity-usage`
- **No external auth required** — uses existing IDE session
- Works while IDE is open

#### Option B: Google Cloud Code API (Fallback — IDE may be closed)
- Endpoint: `https://daily-cloudcode-pa.googleapis.com` (unofficial / subject to change)
- Requires valid Google OAuth session token
- The `antigravity-usage` CLI implements this as "Cloud Mode" fallback
- Multi-account support: pass different tokens per account

### Auth Mechanism
- Antigravity uses **Google OAuth 2.0** (SSO flow)
- Credentials stored in `~/.gemini/oauth_creds.json` (per account)
- Also stores in Windows Credential Manager (OS keychain)
- No documented public REST API for quota — all approaches are community-discovered

### Recommendation for Extension
Use **Option A (local loopback)** as primary, with **Option B (Cloud API)** as fallback. Study `antigravity-usage` npm package source to identify the exact loopback port/endpoint.

### Open Questions (for GRL-02 / build phase)
- What exact port does the local language server run on?
- What is the response shape from the loopback? (needs source inspection of `antigravity-usage`)
- Does the loopback return refresh timestamps or just remaining quota?
