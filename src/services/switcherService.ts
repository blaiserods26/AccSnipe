import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AccountStore } from './accountStore';
import { AuthService } from './authService';
import { QuotaService } from './quotaService';

export class SwitcherService {
  constructor(
    private readonly accountStore: AccountStore,
    private readonly authService?: AuthService,
    private readonly quotaService?: QuotaService
  ) {}

  /**
   * Switches the active Google account, updates Antigravity IDE state sync, syncs credentials to disk, and handles IDE reload prompt.
   */
  public async switchAccount(
    targetAccountId: string,
    promptReload: boolean = true
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const accounts = this.accountStore.getAccounts();
      const target = accounts.find(a => a.id === targetAccountId);
      if (!target) {
        return { success: false, error: 'Target account not found' };
      }

      // 1. Fetch target account credentials
      let tokens = await this.accountStore.getTokens(targetAccountId);

      // Check if tokens are real OAuth tokens or dummy/missing
      const hasValidOAuthTokens = tokens &&
        tokens.accessToken &&
        tokens.accessToken !== 'manual_token' &&
        tokens.accessToken !== 'local_active_session';

      // 2. If tokens are missing or manual/dummy, prompt/perform Google login for this account
      if (!hasValidOAuthTokens) {
        if (!this.authService) {
          return { success: false, error: 'Account has no valid OAuth tokens and AuthService is not available.' };
        }
        vscode.window.showInformationMessage(`AccSnipe: Logging in to ${target.email} via Google...`);
        const loginRes = await this.authService.loginWithGoogle();
        tokens = loginRes.tokens;
        await this.accountStore.updateTokens(targetAccountId, tokens);
      } else if (tokens && tokens.refreshToken && tokens.refreshToken !== 'manual_refresh' && this.authService) {
        // Refresh token if expired or expiring soon
        const isExpiredOrExpiring = Date.now() >= (tokens.expiresAt - 60000);
        if (isExpiredOrExpiring) {
          try {
            tokens = await this.authService.refreshAccessToken(tokens.refreshToken);
            await this.accountStore.updateTokens(targetAccountId, tokens);
          } catch (refreshErr) {
            console.warn('AccSnipe: Failed to refresh token, prompting Google login:', refreshErr);
            vscode.window.showInformationMessage(`AccSnipe: Session expired for ${target.email}. Re-authenticating...`);
            const loginRes = await this.authService.loginWithGoogle();
            tokens = loginRes.tokens;
            await this.accountStore.updateTokens(targetAccountId, tokens);
          }
        }
      }

      // 3. Update active account in AccountStore
      await this.accountStore.setActiveAccount(targetAccountId);

      // 4. Update Antigravity IDE Unified State Sync (USS) if available
      const antigravityUss = (vscode as any).antigravityUnifiedStateSync;
      if (antigravityUss?.OAuthPreferences?.setOAuthTokenInfo && tokens) {
        try {
          const expiryDateSeconds = tokens.expiresAt ? Math.floor(tokens.expiresAt / 1000) : Math.floor(Date.now() / 1000) + 3600;
          await antigravityUss.OAuthPreferences.setOAuthTokenInfo({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || '',
            expiryDateSeconds,
            tokenType: 'Bearer',
            isGcpTos: true
          });
          // NOTE: Do NOT call clearUserStatus() here! Calling clearUserStatus wipes userStatus to empty,
          // which causes Antigravity's getSessions() to return [] and throws 'No auth token found - should never happen'.
        } catch (ussErr) {
          console.warn('AccSnipe: Error updating Antigravity USS:', ussErr);
        }
      }

      // 5. Sync tokens to disk for CLI/external tools
      if (tokens) {
        await this.syncTokensToAntigravityDisk(target.email, tokens);
      }

      // 6. Notify Antigravity IDE commands
      try {
        await vscode.commands.executeCommand('antigravity.handleAuthRefresh');
      } catch {
        // Internal command optional
      }

      try {
        await vscode.commands.executeCommand('antigravity.restartLanguageServer');
      } catch {
        // Optional
      }

      // 7. Refresh quotas for the newly active account
      if (this.quotaService) {
        try {
          await this.quotaService.fetchQuotaForAccount(target, tokens);
        } catch (quotaErr) {
          console.warn('AccSnipe: Error fetching quota after switch:', quotaErr);
        }
      }

      // 8. Handle reload flow
      if (promptReload) {
        const config = vscode.workspace.getConfiguration('accsnipe');
        const autoReload = config.get<boolean>('autoReloadOnSwitch', false);

        if (autoReload) {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else {
          const selection = await vscode.window.showInformationMessage(
            `AccSnipe: Switched active session to ${target.email}.`,
            'Reload Window',
            'Later'
          );
          if (selection === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Writes the selected account's credentials to the ~/.gemini/ configuration directory.
   */
  private async syncTokensToAntigravityDisk(email: string, tokens: { accessToken: string; refreshToken: string; expiresAt: number }): Promise<void> {
    try {
      const geminiDir = path.join(os.homedir(), '.gemini');
      if (!fs.existsSync(geminiDir)) {
        fs.mkdirSync(geminiDir, { recursive: true });
      }

      const credsPath = path.join(geminiDir, 'oauth_creds.json');
      const credsData = {
        email,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
        token_type: 'Bearer',
        updated_at: new Date().toISOString()
      };

      fs.writeFileSync(credsPath, JSON.stringify(credsData, null, 2), 'utf-8');
    } catch {
      // Non-fatal if directory is permission-restricted
    }
  }
}
