import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AccountStore } from './accountStore';

export class SwitcherService {
  constructor(private readonly accountStore: AccountStore) {}

  /**
   * Switches the active Google account, syncs credentials to disk, and handles IDE reload prompt.
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

      // 1. Update active account in AccountStore
      await this.accountStore.setActiveAccount(targetAccountId);

      // 2. Fetch target account credentials
      const tokens = await this.accountStore.getTokens(targetAccountId);
      if (tokens) {
        await this.syncTokensToAntigravityDisk(target.email, tokens);
      }

      // 3. Try to notify internal Antigravity command if registered
      try {
        const commands = await vscode.commands.getCommands(true);
        if (commands.includes('antigravity.switchAccount')) {
          await vscode.commands.executeCommand('antigravity.switchAccount', { email: target.email });
        }
      } catch {
        // Internal command optional
      }

      // 4. Handle reload flow
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
