# GRL-01 — Resolution: Account Storage & Credential Security Design

**Status:** Closed ✅
**Resolved:** 2026-09-30

---

## Answer

All design decisions for account storage and credential management are locked:

### Account Add Flow
- **Method:** OAuth browser flow inside VS Code — `vscode.env.openExternal()` launches Google OAuth consent screen; the extension handles the redirect via a local callback server (localhost redirect URI), exchanges the code for tokens, and stores them.
- **Account limit:** Unlimited accounts.

### Credential Storage
- **Store:** VS Code `SecretStorage` (encrypted, tied to OS keychain — `context.secrets.store(key, value)`).
- **Key scheme:** `accsnipe.account.<email>` → serialized JSON `{ accessToken, refreshToken, email, displayName, planTier, addedAt }`.
- **Account list index:** Stored in `context.globalState` (non-secret metadata: email, displayName, planTier, isActive) — not in SecretStorage since it's non-sensitive.

### Token Lifecycle
- **Auto-refresh:** Silent background refresh using the OAuth `refresh_token` before the access token expires. No user prompt. Use standard Google OAuth token refresh endpoint: `POST https://oauth2.googleapis.com/token`.
- **On removal:** Revoke the token with Google (`POST https://oauth2.googleapis.com/revoke?token=<token>`), then delete from SecretStorage and the account list index.

### Switch Behavior
- **When:** Switch is available immediately (not gated on quota level) — always available on demand.
- **How:** Write the target account's token to `~/.gemini/oauth_creds.json` (or wherever Antigravity reads it — exact path TBD during build), then trigger Antigravity reload via VS Code command or window reload.
- **Active account display:** Only one active at a time. Active account shows a **green dot / checkmark** and is visually distinguished. Non-active accounts show the Switch button.

### Error / Stale Data
- **Quota fetch failure:** Silently retry in background; show last known data greyed out with a stale indicator (e.g. "last updated Xm ago").

### State Persistence
- **Persists** across VS Code restarts: account list, active account, and sort preference all saved in `context.globalState`.

---

### Data Model (locked)

```typescript
interface AccountMeta {        // stored in globalState (non-secret)
  email: string;
  displayName: string;
  planTier: 'free' | 'plus' | 'pro' | 'ultra';
  isActive: boolean;
  addedAt: number;             // epoch ms
}

interface AccountSecrets {    // stored in SecretStorage
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;         // epoch ms
}

interface QuotaState {        // in-memory + globalState cache
  fiveHourRemaining: number | null;  // null = no 5h quota (free plan)
  fiveHourResetAt: number | null;    // epoch ms
  weeklyRemaining: number;
  weeklyResetAt: number;             // epoch ms
  lastFetchedAt: number;             // epoch ms (for stale indicator)
  isStale: boolean;
}
```
