import * as vscode from 'vscode';
import { AccountStore } from '../services/accountStore';
import { QuotaService } from '../services/quotaService';
import { SwitcherService } from '../services/switcherService';
import { AuthService } from '../services/authService';
import { AccountMeta, AccountQuota, PlanTier, SortCriteria } from '../models/types';

const STORAGE_KEY_SORT = 'accsnipe.preferences.sort';

export class AccSnipeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'accsnipe.views.sidebar';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly accountStore: AccountStore,
    private readonly quotaService: QuotaService,
    private readonly switcherService: SwitcherService,
    private readonly authService: AuthService
  ) {
    // Listen for data model changes to refresh the UI
    this.accountStore.onDidChangeAccounts(() => this.updateWebview());
    this.quotaService.onDidChangeQuotas(() => this.updateWebview());
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'switchAccount':
          await this.switcherService.switchAccount(message.accountId);
          break;

        case 'addAccount':
          await this.handleAddAccount();
          break;

        case 'deleteAccount':
          await this.handleDeleteAccount(message.accountId);
          break;

        case 'refreshQuotas':
          await this.handleRefreshAll();
          break;

        case 'changeSort':
          await this.context.globalState.update(STORAGE_KEY_SORT, message.sort);
          this.updateWebview();
          break;
      }
    });

    this.updateWebview();
  }

  public updateWebview(): void {
    if (!this._view) return;
    this._view.webview.html = this.getHtmlForWebview(this._view.webview);
  }

  public async handleAddAccount(): Promise<void> {
    try {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(globe) Sign in with Google (Browser OAuth)', description: 'Opens browser consent screen to add account' },
          { label: '$(edit) Enter Account Details Manually', description: 'Specify email and plan tier directly' }
        ],
        { placeHolder: 'Select how you want to add this Google account' }
      );

      if (!choice) return;

      if (choice.label.includes('Browser OAuth')) {
        vscode.window.showInformationMessage('Opening Google authorization page in browser...');
        const result = await this.authService.loginWithGoogle();
        
        // Auto-detect tier or prompt user
        const tierChoice = await vscode.window.showQuickPick(['pro', 'plus', 'free'], {
          placeHolder: `Select active plan tier for ${result.email}`
        }) as PlanTier | undefined;

        await this.accountStore.addAccount({
          email: result.email,
          displayName: result.displayName,
          planTier: tierChoice || 'pro',
          isActive: this.accountStore.getAccounts().length === 0
        }, result.tokens);

        vscode.window.showInformationMessage(`AccSnipe: Connected ${result.email}!`);
      } else {
        const email = await vscode.window.showInputBox({
          prompt: 'Enter Google account email',
          placeHolder: 'name@gmail.com'
        });
        if (!email) return;

        const tier = await vscode.window.showQuickPick(['pro', 'plus', 'free'], {
          placeHolder: `Select plan tier for ${email}`
        }) as PlanTier | undefined;
        if (!tier) return;

        await this.accountStore.addAccount({
          email,
          displayName: email.split('@')[0],
          planTier: tier,
          isActive: this.accountStore.getAccounts().length === 0
        }, {
          accessToken: 'manual_token',
          refreshToken: 'manual_refresh',
          expiresAt: Date.now() + 86400000
        });

        // Trigger immediate quota baseline fetch
        const added = this.accountStore.getAccounts().find(a => a.email === email);
        if (added) {
          await this.quotaService.fetchQuotaForAccount(added);
        }

        vscode.window.showInformationMessage(`AccSnipe: Added ${email} (${tier.toUpperCase()})`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`AccSnipe Error: ${err.message}`);
    }
  }

  private async handleDeleteAccount(accountId: string): Promise<void> {
    const acc = this.accountStore.getAccounts().find(a => a.id === accountId);
    if (!acc) return;

    const confirm = await vscode.window.showWarningMessage(
      `Remove account ${acc.email} from AccSnipe?`,
      { modal: true },
      'Remove',
      'Cancel'
    );

    if (confirm === 'Remove') {
      const tokens = await this.accountStore.getTokens(accountId);
      if (tokens?.accessToken) {
        await this.authService.revokeToken(tokens.accessToken);
      }
      await this.accountStore.removeAccount(accountId);
      vscode.window.showInformationMessage(`AccSnipe: Removed ${acc.email}`);
    }
  }

  private async handleRefreshAll(): Promise<void> {
    const accounts = this.accountStore.getAccounts();
    if (accounts.length === 0) return;

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'AccSnipe: Refreshing account quotas...'
    }, async () => {
      for (const a of accounts) {
        const tokens = await this.accountStore.getTokens(a.id);
        await this.quotaService.fetchQuotaForAccount(a, tokens);
      }
    });
  }

  private getSortedAccounts(accounts: AccountMeta[], quotas: Map<string, AccountQuota>, sort: SortCriteria): AccountMeta[] {
    const list = [...accounts];

    if (sort === 'quota_desc') {
      list.sort((a, b) => {
        const qA = quotas.get(a.id);
        const qB = quotas.get(b.id);
        const valA = qA?.fiveHourQuota ? qA.fiveHourQuota.remainingPercent : (qA?.weeklyQuota.remainingPercent ?? 0);
        const valB = qB?.fiveHourQuota ? qB.fiveHourQuota.remainingPercent : (qB?.weeklyQuota.remainingPercent ?? 0);
        return valB - valA;
      });
    } else if (sort === 'refresh_asc') {
      list.sort((a, b) => {
        const qA = quotas.get(a.id);
        const qB = quotas.get(b.id);
        const timeA = qA?.fiveHourQuota ? qA.fiveHourQuota.resetAtEpochMs : (qA?.weeklyQuota.resetAtEpochMs ?? Infinity);
        const timeB = qB?.fiveHourQuota ? qB.fiveHourQuota.resetAtEpochMs : (qB?.weeklyQuota.resetAtEpochMs ?? Infinity);
        return timeA - timeB;
      });
    } else if (sort === 'plan_tier') {
      const weights: Record<string, number> = { ultra: 4, pro: 3, plus: 2, free: 1 };
      list.sort((a, b) => (weights[b.planTier] || 0) - (weights[a.planTier] || 0));
    } else if (sort === 'alpha') {
      list.sort((a, b) => a.email.localeCompare(b.email));
    }

    return list;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const sort = this.context.globalState.get<SortCriteria>(STORAGE_KEY_SORT, 'quota_desc');
    const rawAccounts = this.accountStore.getAccounts();
    const quotas = this.quotaService.getAllCachedQuotas();
    const accounts = this.getSortedAccounts(rawAccounts, quotas, sort);

    const accountsHtml = accounts.length === 0 ? `
      <div style="text-align: center; padding: 36px 16px; color: var(--vscode-descriptionForeground); font-size: 12px;">
        <div style="font-size: 24px; margin-bottom: 8px;">🎯</div>
        <div style="font-weight: 600; color: var(--vscode-foreground); margin-bottom: 4px;">No Google Accounts Added</div>
        <p style="margin-bottom: 16px; line-height: 1.5;">Connect your Google accounts to monitor 5h & weekly limits and snipe refreshed quotas.</p>
        <button class="primary-btn" onclick="postMsg('addAccount')">＋ Add First Account</button>
      </div>
    ` : accounts.map(acc => {
      const quota = quotas.get(acc.id);
      const isFree = acc.planTier === 'free';
      const fiveHour = quota?.fiveHourQuota;
      const weekly = quota?.weeklyQuota;

      const fiveHourPercent = fiveHour ? fiveHour.remainingPercent : 0;
      const weeklyPercent = weekly ? weekly.remainingPercent : 0;

      const fiveHourColor = fiveHourPercent > 60 ? 'green' : (fiveHourPercent > 25 ? 'amber' : 'red');
      const weeklyColor = weeklyPercent > 50 ? 'purple' : 'amber';

      let refreshText = 'Calculating...';
      if (fiveHour) {
        const diffMins = Math.max(0, Math.round((fiveHour.resetAtEpochMs - Date.now()) / 60000));
        refreshText = diffMins === 0 ? 'Quota Refreshed!' : `Refreshes in ${diffMins}m`;
      } else if (weekly) {
        const diffDays = Math.max(0, Math.round((weekly.resetAtEpochMs - Date.now()) / (24 * 3600000)));
        refreshText = `Resets in ${diffDays}d`;
      }

      const isRefreshed = quota?.isRefreshed ?? false;

      return `
        <div class="account-card ${acc.isActive ? 'active-account' : ''} ${quota?.isStale ? 'stale' : ''}">
          <div class="card-top-row">
            <div class="user-info">
              <div class="user-email" title="${acc.email}">${acc.displayName || acc.email}</div>
              <div class="user-subtext">
                <span class="tier-tag ${acc.planTier}">${acc.planTier.toUpperCase()}</span>
                <span class="email-sub">${acc.email}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${acc.isActive ? `
                <div class="active-pill">
                  <span class="pulse-dot"></span>
                  ACTIVE
                </div>
              ` : `
                <button class="delete-icon-btn" title="Remove account" onclick="postMsg('deleteAccount', { accountId: '${acc.id}' })">✕</button>
              `}
            </div>
          </div>

          <div class="quota-meters">
            <div class="meter-box">
              <div class="meter-head">
                <span>5h Rolling</span>
                <span class="meter-value">${isFree ? 'N/A (Free)' : fiveHourPercent + '%'}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill ${fiveHourColor}" style="width: ${isFree ? 0 : fiveHourPercent}%;"></div>
              </div>
            </div>
            <div class="meter-box">
              <div class="meter-head">
                <span>Weekly Limit</span>
                <span class="meter-value">${weeklyPercent}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill ${weeklyColor}" style="width: ${weeklyPercent}%;"></div>
              </div>
            </div>
          </div>

          <div class="card-footer">
            <div class="refresh-timer">
              <span>⏱</span>
              <span>${refreshText}</span>
              ${quota?.isStale ? '<span style="color: #888; font-size: 9px;">(stale)</span>' : ''}
            </div>
            ${acc.isActive ? `
              <div class="active-label-btn">Active</div>
            ` : `
              <button class="switch-btn ${isRefreshed ? 'refreshed' : ''}" onclick="postMsg('switchAccount', { accountId: '${acc.id}' })">
                ${isRefreshed ? '⚡ Switch (Ready)' : 'Switch'}
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 8px;
            font-size: 12px;
          }
          .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding: 6px 4px 10px 4px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #2a2a2a);
            margin-bottom: 10px;
          }
          .sort-select {
            flex: 1;
            background: var(--vscode-dropdown-background, #25252b);
            color: var(--vscode-dropdown-foreground, #ccc);
            border: 1px solid var(--vscode-dropdown-border, #3c3c44);
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 11px;
            outline: none;
            cursor: pointer;
          }
          .account-card {
            background: var(--vscode-editor-background, #1e1e24);
            border: 1px solid var(--vscode-widget-border, #2e2e36);
            border-radius: 8px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 10px;
            transition: all 0.15s ease;
          }
          .account-card.active-account {
            border-color: #22c55e;
            background: #152219;
            box-shadow: 0 0 12px rgba(34, 197, 94, 0.12);
          }
          .account-card.stale {
            opacity: 0.75;
          }
          .card-top-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 6px;
          }
          .user-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            overflow: hidden;
          }
          .user-email {
            font-weight: 600;
            font-size: 12px;
            color: var(--vscode-foreground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .user-subtext {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .email-sub {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 140px;
          }
          .tier-tag {
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: 700;
            text-transform: uppercase;
          }
          .tier-tag.pro { background: #581c87; color: #d8b4fe; border: 1px solid #7e22ce; }
          .tier-tag.plus { background: #1e3a8a; color: #93c5fd; border: 1px solid #2563eb; }
          .tier-tag.free { background: #334155; color: #cbd5e1; border: 1px solid #475569; }
          .tier-tag.ultra { background: #831843; color: #fbcfe8; border: 1px solid #db2777; }

          .active-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 9px;
            font-weight: 700;
            color: #4ade80;
            background: #14532d44;
            border: 1px solid #22c55e44;
            padding: 1px 5px;
            border-radius: 10px;
          }
          .pulse-dot {
            width: 5px;
            height: 5px;
            background: #4ade80;
            border-radius: 50%;
            box-shadow: 0 0 5px #4ade80;
          }
          .delete-icon-btn {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 11px;
            padding: 2px 4px;
            border-radius: 3px;
          }
          .delete-icon-btn:hover {
            color: #ef4444;
            background: rgba(239, 68, 68, 0.1);
          }
          .quota-meters {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            background: rgba(0,0,0,0.2);
            padding: 6px;
            border-radius: 5px;
          }
          .meter-box {
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .meter-head {
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
          }
          .meter-value {
            font-weight: 600;
            color: var(--vscode-foreground);
            font-size: 11px;
          }
          .progress-track {
            height: 5px;
            background: rgba(255,255,255,0.08);
            border-radius: 3px;
            overflow: hidden;
          }
          .progress-fill {
            height: 100%;
            border-radius: 3px;
            transition: width 0.3s ease;
          }
          .progress-fill.green { background: #22c55e; }
          .progress-fill.amber { background: #f59e0b; }
          .progress-fill.red { background: #ef4444; }
          .progress-fill.purple { background: #a855f7; }

          .card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 10px;
          }
          .refresh-timer {
            display: flex;
            align-items: center;
            gap: 4px;
            color: #38bdf8;
            font-size: 10px;
          }
          .switch-btn {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #fff);
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
          }
          .switch-btn:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
          }
          .switch-btn.refreshed {
            background: #16a34a;
          }
          .switch-btn.refreshed:hover {
            background: #15803d;
          }
          .active-label-btn {
            color: #4ade80;
            border: 1px solid #22c55e44;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 500;
          }
          .primary-btn {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #fff);
            border: none;
            padding: 6px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 11px;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <select class="sort-select" onchange="postMsg('changeSort', { sort: this.value })">
            <option value="quota_desc" ${sort === 'quota_desc' ? 'selected' : ''}>Quota (High to Low)</option>
            <option value="refresh_asc" ${sort === 'refresh_asc' ? 'selected' : ''}>Refresh Time (Earliest)</option>
            <option value="plan_tier" ${sort === 'plan_tier' ? 'selected' : ''}>Plan Tier (Pro > Plus > Free)</option>
            <option value="alpha" ${sort === 'alpha' ? 'selected' : ''}>Account Name (A-Z)</option>
          </select>
        </div>

        <div id="accounts-container">
          ${accountsHtml}
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          function postMsg(type, data = {}) {
            vscode.postMessage({ type, ...data });
          }
        </script>
      </body>
      </html>
    `;
  }
}
