# AccSnipe 🎯

**Antigravity & VS Code Google Account Quota Tracker & Account Switcher**

AccSnipe is a VS Code extension built for Google Antigravity power users to monitor multi-account compute limits (5-Hour rolling limits and Weekly caps) and hot-switch active sessions to snipe refreshed quotas without workflow disruption.

---

## ⚡ Key Features

- **Dual Quota Telemetry (Inline):**
  - **5-Hour Rolling Meter:** Real-time compute effort % remaining with countdown timers (`Refreshes in 42m` or `Quota Refreshed!`).
  - **Weekly Cap Meter:** Overall weekly consumption progress with reset day countdown.
- **One-Click Hot Switching:**
  - Instant `⚡ Switch (Ready)` action buttons for accounts that have replenished their quotas.
  - Clear visual indicator (`ACTIVE` badge with glowing pulse dot) on the active session.
  - Soft-switch architecture updates credentials in `~/.gemini/` and provides a 1-click reload action.
- **Flexible Sorting:**
  - Top toolbar dropdown with 4 sort criteria:
    - **Quota Remaining (High to Low)** *(Default)*
    - **Refresh Time (Earliest First)**
    - **Plan Tier (Pro > Plus > Free)**
    - **Account Name (A-Z)**
- **Multi-Account Security:**
  - Connect unlimited Google accounts via OAuth 2.0 browser consent flow or manual input.
  - Access and refresh tokens encrypted in VS Code `SecretStorage` (backed by OS keychain / Windows Credential Manager).
  - Silent background token refresh.
  - One-click account removal with Google OAuth token revocation.
- **Background Quota Poller:**
  - Automatically updates quota telemetry every 5 minutes (configurable) with manual instant refresh option (`↻`).

---

## 🚀 Installation & Usage

### Installing from `.vsix`
1. Open Antigravity IDE or VS Code.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run:
   ```
   Extensions: Install from VSIX...
   ```
3. Select `accsnipe-0.1.0.vsix` located in the root of this project.

### Connecting an Account
1. Click the **AccSnipe** target icon on the Activity Bar (left rail).
2. Click the `＋` button in the header (or run command `AccSnipe: Add Google Account`).
3. Choose **Sign in with Google (Browser OAuth)** or **Enter Account Details Manually**.
4. Select the account's plan tier (`Pro`, `Plus`, or `Free`).
5. Your account appears immediately in the sidebar with live quota meters!

---

## 🛠️ Architecture

- **`src/services/accountStore.ts`**: Account metadata index in `globalState` + encrypted token vault in `SecretStorage`.
- **`src/services/authService.ts`**: Loopback HTTP server on `127.0.0.1` for OAuth consent redirect and token exchange.
- **`src/services/quotaService.ts`**: Local language server loopback client, Cloud Code fallback, and recurring background poller.
- **`src/services/switcherService.ts`**: Session synchronizer writing to `~/.gemini/oauth_creds.json` and managing IDE session handover.
- **`src/views/accSnipeViewProvider.ts`**: Webview View Provider implementing rich visual cards with real-time dynamic meters.
