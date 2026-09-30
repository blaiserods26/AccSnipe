# RES-02 — Antigravity Account Switching Mechanism

**Labels:** `wayfinder:research`
**Status:** Open (unclaimed)
**Blocks:** GRL-01, PRO-01

---

## Question

How does Antigravity store and manage the currently active Google account, and what is the minimum action required to switch to a different account **without** reloading the Antigravity window?

Investigate:
1. How Antigravity authenticates with Google — OAuth tokens, session cookies, browser profile, or a config file at a known path under `~/.gemini/` or `%APPDATA%`.
2. Whether Antigravity exposes a VS Code command (e.g. `antigravity.switchAccount`) that changes the active session.
3. Whether swapping a token/config file on disk and signaling Antigravity (e.g. via a VS Code extension API, IPC, or file-watcher) is sufficient to hot-swap.
4. Whether multiple accounts require separate browser profiles or simply separate OAuth token files.
5. Any Antigravity plugin / sidecar API that could be called to change the active session.

Record: the exact file path(s) or API call needed to change the active account, the format of the credential, and any side effects (e.g. ongoing requests are cancelled, rate-limit counters reset).
