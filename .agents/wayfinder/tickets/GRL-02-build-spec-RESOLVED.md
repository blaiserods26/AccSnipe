# GRL-02 — Resolution: Extension Architecture & Build Spec

**Status:** Closed ✅
**Resolved:** 2026-09-30

---

## Complete Build Specification: AccSnipe

### 1. Extension Profile & Packaging
- **Name:** `accsnipe`
- **Display Name:** `AccSnipe — Antigravity Quota Manager & Account Switcher`
- **Target Platform:** Standard VS Code Extension (`.vsix` package) installable in Google Antigravity IDE and VS Code.
- **Language & Toolchain:** TypeScript (strict mode) + `esbuild` for instant sub-second bundling.
- **VS Code Engine Compatibility:** `^1.85.0`.

---

### 2. Extension Architecture & Modules

```
src/
├── extension.ts              # Activation, command registrations, service lifecycle
├── services/
│   ├── accountStore.ts       # Account CRUD, globalState index, SecretStorage encrypted tokens
│   ├── authService.ts        # OAuth 2.0 loopback server, Google consent redirect, token exchange & refresh
│   ├── quotaService.ts       # Loopback client (IDE language server) + Cloud Code API fallback
│   └── switcherService.ts    # Soft switcher: token injection + command dispatch + reload prompt
├── views/
│   └── accSnipeViewProvider.ts # WebviewViewProvider hosting Variant B rich UI
└── models/
    └── types.ts              # Canonical interfaces (AccountMeta, AccountSecrets, QuotaState)
```

#### Module Responsibilities

1. **`accountStore.ts`**:
   - Manages list of accounts in `context.globalState` (`accsnipe.accounts.index`).
   - Securely stores access/refresh tokens in `context.secrets` with key `accsnipe.account.<email>`.
   - Emits event `onDidChangeAccounts` when accounts are added, removed, or switched.

2. **`authService.ts`**:
   - Spawns local ephemeral HTTP server on `http://127.0.0.1:<random_port>/callback`.
   - Opens browser to Google OAuth 2.0 authorization endpoint requesting offline access.
   - Handles OAuth callback, exchanges authorization code for refresh/access tokens.
   - Exposes `refreshToken(email)` to run silent background refreshes using `https://oauth2.googleapis.com/token`.
   - Exposes `revokeToken(email)` calling `https://oauth2.googleapis.com/revoke` upon account deletion.

3. **`quotaService.ts`**:
   - **Local Mode (Primary):** Checks active local Antigravity Language Server loopback port to extract real-time compute quotas.
   - **Cloud Mode (Fallback):** Queries `https://daily-cloudcode-pa.googleapis.com` with the respective account's access token to fetch multi-account quotas even when idle.
   - Computes 5-hour rolling compute effort percentage and weekly remaining limit.
   - Calculates remaining countdown minutes to quota refresh.
   - Background poller runs every **5 minutes** (configurable in VS Code settings) + responds to manual header refresh command.

4. **`switcherService.ts`**:
   - Sets target account `isActive: true` in `accountStore`.
   - Injects active OAuth session into `~/.gemini/` configuration store or invokes Antigravity's internal authentication provider command.
   - Attempts hot-session switch; if Antigravity requires window reload, displays a non-intrusive notification:
     `"Switched active account to <email>. Reload window to apply changes?"` with a single-click `[Reload Window]` action.

5. **`accSnipeViewProvider.ts`**:
   - Implements VS Code `vscode.WebviewViewProvider` registered for view id `accsnipe.views.sidebar`.
   - Renders Variant B design:
     - Header actions: `＋` Add Account, `↻` Force Refresh
     - Sort dropdown: `Quota Remaining (High to Low)`, `Refresh Time`, `Plan Tier`, `Account Name`
     - Account Cards with dual gradient bars (5h rolling compute + weekly cap)
     - Dynamic buttons: `⚡ Switch (Ready)` vs standard `Switch` vs `Active` pill
   - Bidirectional message passing between Webview and extension (`switchAccount`, `deleteAccount`, `addAccount`, `changeSort`).

---

### 3. Canonical Data Models

```typescript
export type PlanTier = 'free' | 'plus' | 'pro' | 'ultra';

export interface AccountMeta {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  planTier: PlanTier;
  isActive: boolean;
  addedAt: number;
}

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface QuotaBreakdown {
  remainingPercent: number; // 0 - 100
  totalLimit?: number;
  resetAtEpochMs: number;
}

export interface AccountQuota {
  accountId: string;
  fiveHourQuota: QuotaBreakdown | null; // null for free accounts
  weeklyQuota: QuotaBreakdown;
  lastUpdated: number;
  isStale: boolean;
  isRefreshed: boolean; // true if 5h quota has refreshed to >= 80%
}
```

---

### 4. VS Code Contribution Points (`package.json`)

```json
{
  "name": "accsnipe",
  "displayName": "AccSnipe",
  "description": "Antigravity Google Account Quota Tracker & Account Switcher",
  "version": "0.1.0",
  "publisher": "accsnipe",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "onView:accsnipe.views.sidebar"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "accsnipe-container",
          "title": "AccSnipe",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "accsnipe-container": [
        {
          "type": "webview",
          "id": "accsnipe.views.sidebar",
          "name": "Accounts & Quota"
        }
      ]
    },
    "commands": [
      {
        "command": "accsnipe.addAccount",
        "title": "Add Google Account",
        "icon": "$(plus)"
      },
      {
        "command": "accsnipe.refreshQuotas",
        "title": "Refresh All Quotas",
        "icon": "$(refresh)"
      },
      {
        "command": "accsnipe.switchAccount",
        "title": "Switch Active Account"
      }
    ]
  }
}
```

---

### 5. Implementation Readiness
- All decisions from RES-01, RES-02, GRL-01, and PRO-01 are synthesized.
- Next step: Hand off to Build Agent to scaffold project files, configure `esbuild`, implement modules, and produce the working extension.
