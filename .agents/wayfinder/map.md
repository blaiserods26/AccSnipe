# AccSnipe — Wayfinder Map

**Labels:** `wayfinder:map`

---

## Destination

A VS Code / Antigravity plugin (sidecar or extension) that displays a sidebar panel listing multiple Google accounts used with Antigravity. For each account it shows: plan tier (Pro / Plus / Free), 5-hour quota remaining, weekly quota remaining, and quota refresh times. Accounts are sortable (default: by quota remaining). A "Switch" button appears beside accounts whose quota has refreshed, letting the user hot-swap the active Antigravity account without reloading the window.

## Notes

- Domain: VS Code Extension API + Antigravity Plugin system
- Skills every session should consult: `research`, `prototype`, `antigravity-guide`
- All plan tiers: Pro, Plus, Free (Ultra as bonus)
- Default sort: quota remaining (most first)
- Account identity: email / Google display name
- No tracker configured — using local-markdown tracker (this directory)
- Tickets live in `.agents/wayfinder/tickets/`

## Decisions so far

- [RES-01 — Antigravity Quota API](tickets/RES-01-quota-api-RESOLVED.md): Quota is compute-effort based (not tokens); Free has weekly-only refresh, Pro/Plus/Ultra have 5-hour rolling refresh + weekly cap. Two data sources available: (A) Antigravity local loopback language server (primary), (B) `https://daily-cloudcode-pa.googleapis.com` (fallback). Reference: `antigravity-usage` npm package. No official public API exists.

- [RES-02 — Antigravity Account Switching Mechanism](tickets/RES-02-account-switching-RESOLVED.md): Antigravity uses Google OAuth 2.0. Credentials likely stored in `~/.gemini/oauth_creds.json` + Windows Credential Manager. Switching strategy: (1) check for VS Code command `Antigravity: Switch Account`, (2) fallback to file-swap of `oauth_creds.json` + reload signal. The `oauth_creds.json` was NOT found on this machine's `.gemini` root — exact credential path needs hands-on investigation during build.

- [GRL-01 — Account Storage & Credential Security Design](tickets/GRL-01-credential-storage-RESOLVED.md): OAuth browser flow (VS Code opens Google consent screen); unlimited accounts; tokens in VS Code `SecretStorage`; account index in `globalState`. Token auto-refreshes silently. Removing an account revokes token with Google. Switch is always available (not quota-gated). Active account shown with green dot. Last-known quota shown greyed-out when stale. All state persists across VS Code restarts. Data models locked (see ticket).

- [PRO-01 — Sidebar UI Prototype](tickets/PRO-01-sidebar-ui-RESOLVED.md): Selected **Variant B (Rich Visual Cards)** built with a VS Code `WebviewViewProvider`. Each account displays dual visual progress bars (5-hour rolling compute quota + weekly limit), color-coded threshold gradients, glowing green active status badge, `⚡ Switch (Ready)` action buttons for refreshed accounts, and a top toolbar sort dropdown. Prototype artifact: [`prototype-sidebar.html`](../../prototype-sidebar.html).

- [GRL-02 — Extension Architecture & Build Spec](tickets/GRL-02-build-spec-RESOLVED.md): Complete architecture locked for a standard VS Code extension (`.vsix`) with TypeScript + esbuild. Four modular services (`accountStore`, `authService`, `quotaService`, `switcherService`) powering `accSnipeViewProvider` (Webview). Polling interval set to 5 minutes with manual trigger. Soft-switch strategy with reload prompt fallback. Data models and `package.json` schema fully specified.

## Not yet specified

<!-- All foundational decisions resolved! The way to the destination is completely clear. Ready for build execution. -->

## Out of scope

<!-- nothing ruled out yet -->
