# RES-02 — Resolution: Antigravity Account Switching Mechanism

**Status:** Closed ✅
**Resolved:** 2026-09-30

---

## Answer

### Credential Storage

Antigravity uses **Google OAuth 2.0**. The primary credential storage locations on Windows are:

1. **`~/.gemini/oauth_creds.json`** — primary OAuth token file (access + refresh tokens)
2. **`~/.gemini/google_accounts.json`** — cached account states (may exist alongside oauth_creds.json)
3. **Windows Credential Manager** — OS-level secure keychain holds refresh tokens (deleting files alone may not fully clear a session)
4. **`%APPDATA%\Antigravity`** — additional application-specific storage

On this machine, the relevant directory is `C:\Users\Blaise Rodrigues\.gemini\` (confirmed present).

### Switching Mechanism — Options (in preference order)

#### Option 1: VS Code Command Palette command (Best if exists)
- Search: `"Antigravity: Switch Account"` or `"Antigravity: Sign Out"` + sign in
- **Status: Unconfirmed** — no documented command found. The IDE does have `"Antigravity: Reset Onboarding"` command.
- If such a command is exposed via `vscode.commands.executeCommand`, the extension can call it directly.

#### Option 2: Credential file swap (Viable but risks)
- Replace `~/.gemini/oauth_creds.json` with the target account's token file
- Signal Antigravity to reload (via VS Code reload or file-watcher trigger)
- **Risk**: Antigravity may cache the session in memory; a file swap alone may not take effect without a window reload

#### Option 3: VS Code Profile isolation
- Each Google account gets its own VS Code Profile with separate `--user-data-dir`
- Switching = VS Code switches profile (full reload, not seamless)
- **Limitation**: Requires window reload — violates user requirement

#### Option 4: Antigravity internal IPC / local server command
- If Antigravity's local language server (found in Option A of RES-01) accepts auth commands, the extension could send a session-switch command over localhost
- **Status: Unconfirmed** — needs source inspection

### Recommended Strategy
Build around **Option 1** (VS Code command, if discoverable) with **Option 2** (file swap + reload prompt) as fallback. The extension should:
1. Store per-account OAuth tokens in VS Code SecretStorage
2. On "Switch": write target token to `~/.gemini/oauth_creds.json`
3. Trigger reload via VS Code command or prompt user if reload is necessary

### Key File Path (Confirmed on this machine)
```
C:\Users\Blaise Rodrigues\.gemini\  (root)
├── antigravity\          (IDE-specific state, brain, conversations)
├── antigravity-ide\      (IDE app data)
├── config\               (global config, plugins, skills)
│   └── config.json       (plugin settings, userSettings)
```
Note: `oauth_creds.json` was **NOT found** in the current `.gemini` root — Antigravity IDE may store auth differently (possibly in Windows Credential Manager or a different path). This needs hands-on investigation during build phase.
