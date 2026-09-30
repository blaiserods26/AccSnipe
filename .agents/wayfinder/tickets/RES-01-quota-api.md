# RES-01 — Antigravity Quota API

**Labels:** `wayfinder:research`
**Status:** Open (unclaimed)
**Blocks:** RES-02, PRO-01, GRL-01

---

## Question

Does Antigravity expose a documented (or discoverable) API or local data source that returns:
- The active account's quota type (5-hour / weekly)
- The amount of quota remaining
- The quota reset / refresh timestamp
- The plan tier (Pro, Plus, Free) of the account

Investigate:
1. The Antigravity app data directory at `C:\Users\Blaise Rodrigues\.gemini\` for any config files, quota snapshots, or local databases that contain this data.
2. Whether the Antigravity IDE or its background processes make network requests to a quota endpoint (check `antigravity-guide` skill for API/config docs).
3. Whether there is a public Gemini/Antigravity REST API with a `quota` or `usage` endpoint that can be called with an OAuth token.
4. What OAuth scopes (if any) are needed to query quota on behalf of a Google account.

Record: the URL/path/method to retrieve quota, the response schema, and the auth flow required.
