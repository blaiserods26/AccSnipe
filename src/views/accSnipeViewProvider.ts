import * as vscode from 'vscode';
import { AccountStore } from '../services/accountStore';
import { QuotaService } from '../services/quotaService';
import { SwitcherService } from '../services/switcherService';
import { AuthService } from '../services/authService';
import { AccountMeta, AccountQuota, PlanTier, SortCriteria } from '../models/types';

const STORAGE_KEY_SORT = 'accsnipe.preferences.sort';

function formatCountdown(resetEpochMs?: number): string {
  if (!resetEpochMs) return '--';
  const diff = resetEpochMs - Date.now();
  if (diff <= 0) return 'Refreshed!';

  const totalMinutes = Math.floor(diff / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

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

        case 'editPlanTier':
          await this.handleEditPlanTier(message.accountId);
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

  public async handleEditPlanTier(accountId: string): Promise<void> {
    const acc = this.accountStore.getAccounts().find(a => a.id === accountId);
    if (!acc) return;

    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Free Tier', description: 'Free plan (Gemini Flash only, no Claude models)', tier: 'free' },
        { label: 'Google AI Pro', description: 'Pro plan with Gemini & Claude model quotas', tier: 'pro' },
        { label: 'Google AI Plus', description: 'Plus plan', tier: 'plus' },
        { label: 'Google AI Ultra', description: 'Ultra plan with highest quota', tier: 'ultra' }
      ],
      { placeHolder: `Select plan tier for ${acc.email} (current: ${acc.planTier.toUpperCase()})` }
    );

    if (picked) {
      await this.accountStore.updateAccount(acc.id, {
        planTier: picked.tier as PlanTier,
        planDisplayName: picked.label
      });
      const updated = this.accountStore.getAccounts().find(a => a.id === acc.id);
      if (updated) {
        await this.quotaService.fetchQuotaForAccount(updated);
      }
      vscode.window.showInformationMessage(`AccSnipe: Updated ${acc.email} to ${picked.label}`);
    }
  }

  public async handleAddAccount(): Promise<void> {
    try {
      const activeStatus = await this.quotaService.detectActiveUserStatus();

      const options = [
        ...(activeStatus ? [{
          label: `$(sparkle) Auto-Import Active Account (${activeStatus.planDisplayName})`,
          description: `${activeStatus.email} • Detected ${activeStatus.planTier.toUpperCase()}`,
          isAutoDetect: true
        }] : []),
        {
          label: '$(globe) Sign in with Google (Browser OAuth)',
          description: 'Opens browser consent screen to add account'
        },
        {
          label: '$(edit) Enter Account Details Manually',
          description: 'Specify email and choose plan tier'
        }
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select how you want to add this Google account'
      });

      if (!choice) return;

      // 1. Auto-Import Current Active Antigravity Account
      if ((choice as any).isAutoDetect && activeStatus) {
        const existing = this.accountStore.getAccounts().find(a => a.email.toLowerCase() === activeStatus.email.toLowerCase());
        if (existing) {
          vscode.window.showInformationMessage(`Account ${activeStatus.email} is already in AccSnipe!`);
          return;
        }

        let capturedTokens = {
          accessToken: 'local_active_session',
          refreshToken: '',
          expiresAt: Date.now() + 30 * 86400000
        };

        const antigravityUss = (vscode as any).antigravityUnifiedStateSync;
        if (antigravityUss?.OAuthPreferences?.getOAuthTokenInfo) {
          try {
            const currentTokenInfo = await antigravityUss.OAuthPreferences.getOAuthTokenInfo();
            if (currentTokenInfo?.accessToken) {
              capturedTokens = {
                accessToken: currentTokenInfo.accessToken,
                refreshToken: currentTokenInfo.refreshToken || '',
                expiresAt: currentTokenInfo.expiryDateSeconds ? currentTokenInfo.expiryDateSeconds * 1000 : Date.now() + 3600000
              };
            }
          } catch {}
        }

        const newAcc = await this.accountStore.addAccount({
          email: activeStatus.email,
          displayName: activeStatus.name,
          planTier: activeStatus.planTier,
          planDisplayName: activeStatus.planDisplayName,
          isActive: true
        }, capturedTokens);

        await this.quotaService.fetchQuotaForAccount(newAcc, capturedTokens);
        vscode.window.showInformationMessage(`AccSnipe: Connected ${activeStatus.email} with plan ${activeStatus.planDisplayName}!`);
        return;
      }

      // 2. Sign In With Google (Browser OAuth)
      if (choice.label.includes('Browser OAuth')) {
        vscode.window.showInformationMessage('Opening Google authorization page in browser...');
        const result = await this.authService.loginWithGoogle();

        let planTier: PlanTier = 'free';
        let planDisplayName = 'Free Tier';

        // Check if the signed in account matches the current active IDE session
        if (activeStatus && activeStatus.email.toLowerCase() === result.email.toLowerCase()) {
          planTier = activeStatus.planTier;
          planDisplayName = activeStatus.planDisplayName;
        } else {
          // Probe Google Cloud Code endpoint using this account's access token
          const tokenPlan = await this.quotaService.detectPlanTierFromToken(result.tokens.accessToken);
          if (tokenPlan) {
            planTier = tokenPlan.planTier;
            planDisplayName = tokenPlan.planDisplayName;
          } else {
            // If auto-detection inconclusive, ask user (Free Tier as default!)
            const picked = await vscode.window.showQuickPick(
              [
                { label: 'Free Tier', description: 'Free account (Gemini Flash only)', tier: 'free' },
                { label: 'Google AI Pro', description: 'Paid plan (Gemini & Claude)', tier: 'pro' },
                { label: 'Google AI Plus', description: 'Paid plan', tier: 'plus' },
                { label: 'Google AI Ultra', description: 'Paid plan', tier: 'ultra' }
              ],
              { placeHolder: `Select plan tier for ${result.email}` }
            );
            if (picked) {
              planTier = picked.tier as PlanTier;
              planDisplayName = picked.label;
            }
          }
        }

        await this.accountStore.addAccount({
          email: result.email,
          displayName: result.displayName,
          planTier,
          planDisplayName,
          isActive: this.accountStore.getAccounts().length === 0
        }, result.tokens);

        const added = this.accountStore.getAccounts().find(a => a.email === result.email);
        if (added) {
          await this.quotaService.fetchQuotaForAccount(added, result.tokens);
        }

        vscode.window.showInformationMessage(`AccSnipe: Connected ${result.email} (${planDisplayName})!`);
      } else {
        // 3. Manual Entry
        const email = await vscode.window.showInputBox({
          prompt: 'Enter Google account email',
          placeHolder: 'name@gmail.com'
        });
        if (!email) return;

        let planTier: PlanTier = 'free';
        let planDisplayName = 'Free Tier';

        if (activeStatus && activeStatus.email.toLowerCase() === email.toLowerCase()) {
          planTier = activeStatus.planTier;
          planDisplayName = activeStatus.planDisplayName;
        } else {
          const picked = await vscode.window.showQuickPick(
            [
              { label: 'Free Tier', description: 'Free account (Gemini Flash only)', tier: 'free' },
              { label: 'Google AI Pro', description: 'Paid plan (Gemini & Claude)', tier: 'pro' },
              { label: 'Google AI Plus', description: 'Paid plan', tier: 'plus' },
              { label: 'Google AI Ultra', description: 'Paid plan', tier: 'ultra' }
            ],
            { placeHolder: `Select plan tier for ${email}` }
          );
          if (!picked) return;
          planTier = picked.tier as PlanTier;
          planDisplayName = picked.label;
        }

        await this.accountStore.addAccount({
          email,
          displayName: email.split('@')[0],
          planTier,
          planDisplayName,
          isActive: this.accountStore.getAccounts().length === 0
        }, {
          accessToken: 'manual_token',
          refreshToken: 'manual_refresh',
          expiresAt: Date.now() + 86400000
        });

        const added = this.accountStore.getAccounts().find(a => a.email === email);
        if (added) {
          await this.quotaService.fetchQuotaForAccount(added);
        }

        vscode.window.showInformationMessage(`AccSnipe: Added ${email} (${planDisplayName})`);
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
        const valA = qA?.geminiQuota?.weeklyQuota.remainingPercent ?? (qA?.weeklyQuota.remainingPercent ?? 0);
        const valB = qB?.geminiQuota?.weeklyQuota.remainingPercent ?? (qB?.weeklyQuota.remainingPercent ?? 0);
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
        <p style="margin-bottom: 16px; line-height: 1.5;">Connect your Google accounts to monitor Gemini & Claude limits and switch accounts.</p>
        <button class="primary-btn" onclick="postMsg('addAccount')">＋ Add Account</button>
      </div>
    ` : accounts.map(acc => {
      const quota = quotas.get(acc.id);
      const isFree = acc.planTier === 'free';
      const hasVerified = quota?.hasVerifiedData !== false && (quota?.geminiQuota || quota?.claudeQuota);

      const gemini = quota?.geminiQuota;
      const claude = quota?.claudeQuota;

      const gWeeklyPct = gemini ? gemini.weeklyQuota.remainingPercent : null;
      const gWeeklyCountdown = gemini ? formatCountdown(gemini.weeklyQuota.resetAtEpochMs) : null;
      const g5hPct = gemini?.fiveHourQuota ? gemini.fiveHourQuota.remainingPercent : null;
      const g5hCountdown = gemini?.fiveHourQuota ? formatCountdown(gemini.fiveHourQuota.resetAtEpochMs) : null;

      const cWeeklyPct = claude ? claude.weeklyQuota.remainingPercent : null;
      const cWeeklyCountdown = claude ? formatCountdown(claude.weeklyQuota.resetAtEpochMs) : null;
      const c5hPct = claude?.fiveHourQuota ? claude.fiveHourQuota.remainingPercent : null;
      const c5hCountdown = claude?.fiveHourQuota ? formatCountdown(claude.fiveHourQuota.resetAtEpochMs) : null;

      const getColor = (pct: number | null) => {
        if (pct === null) return 'gray';
        if (pct > 60) return 'green';
        if (pct > 25) return 'amber';
        return 'red';
      };

      const isRefreshed = quota?.isRefreshed ?? false;

      return `
        <div class="account-card ${acc.isActive ? 'active-account' : ''}">
          <div class="card-top-row">
            <div class="user-info">
              <div class="user-email" title="${acc.email}">${acc.displayName || acc.email}</div>
              <div class="user-subtext">
                <span class="tier-tag ${acc.planTier}" title="Click to change plan tier" onclick="postMsg('editPlanTier', { accountId: '${acc.id}' })">
                  ${acc.planTier.toUpperCase()} ✎
                </span>
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

          <!-- Gemini Models Limit Breakdown -->
          <div class="model-section">
            <div class="section-title">
              <span>✦ Gemini Models</span>
            </div>
            ${hasVerified ? `
              <div class="quota-meters">
                <div class="meter-box">
                  <div class="meter-head">
                    <span>Weekly</span>
                    <span class="meter-value">${gWeeklyPct !== null ? gWeeklyPct + '%' : '--'}</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${getColor(gWeeklyPct)}" style="width: ${gWeeklyPct ?? 0}%;"></div>
                  </div>
                  <div class="sub-timer">⏱ ${gWeeklyCountdown || '--'}</div>
                </div>

                <div class="meter-box">
                  <div class="meter-head">
                    <span>5-Hour</span>
                    <span class="meter-value">${isFree ? 'N/A' : (g5hPct !== null ? g5hPct + '%' : '--')}</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${getColor(g5hPct)}" style="width: ${g5hPct ?? 0}%;"></div>
                  </div>
                  <div class="sub-timer">${isFree ? 'Free Tier' : '⏱ ' + (g5hCountdown || '--')}</div>
                </div>
              </div>
            ` : `
              <div class="awaiting-sync">Switch to this account to sync live quota</div>
            `}
          </div>

          <!-- Claude and GPT Models Limit Breakdown -->
          <div class="model-section">
            <div class="section-title">
              <span>✦ Claude & GPT Models</span>
            </div>
            ${isFree ? `
              <div class="not-included">Not included in Free tier</div>
            ` : (hasVerified ? `
              <div class="quota-meters">
                <div class="meter-box">
                  <div class="meter-head">
                    <span>Weekly</span>
                    <span class="meter-value">${cWeeklyPct !== null ? cWeeklyPct + '%' : '--'}</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${getColor(cWeeklyPct)}" style="width: ${cWeeklyPct ?? 0}%;"></div>
                  </div>
                  <div class="sub-timer">⏱ ${cWeeklyCountdown || '--'}</div>
                </div>

                <div class="meter-box">
                  <div class="meter-head">
                    <span>5-Hour</span>
                    <span class="meter-value">${c5hPct !== null ? c5hPct + '%' : '--'}</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${getColor(c5hPct)}" style="width: ${c5hPct ?? 0}%;"></div>
                  </div>
                  <div class="sub-timer">⏱ ${c5hCountdown || '--'}</div>
                </div>
              </div>
            ` : `
              <div class="awaiting-sync">Switch to this account to sync live quota</div>
            `)}
          </div>

          <div class="card-footer">
            <div class="footer-status">
              ${acc.isActive ? (isRefreshed ? '<span class="ready-badge">⚡ Ready</span>' : '<span class="in-use-badge">In Session</span>') : '<span class="in-use-badge">Inactive</span>'}
            </div>
            ${acc.isActive ? `
              <div class="active-label-btn">Active</div>
            ` : `
              <button class="switch-btn" onclick="postMsg('switchAccount', { accountId: '${acc.id}' })">
                Switch Account
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
            background: #142217;
            box-shadow: 0 0 12px rgba(34, 197, 94, 0.12);
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
            cursor: pointer;
          }
          .tier-tag:hover {
            opacity: 0.8;
            outline: 1px dashed currentColor;
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

          .model-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: rgba(0,0,0,0.22);
            border-radius: 6px;
            padding: 6px 8px;
            border: 1px solid rgba(255,255,255,0.04);
          }
          .section-title {
            font-size: 10px;
            font-weight: 600;
            color: var(--vscode-foreground);
            opacity: 0.85;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .not-included {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 4px 0;
          }
          .awaiting-sync {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            padding: 4px 0;
          }

          .quota-meters {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .meter-box {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .meter-head {
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
          }
          .meter-value {
            font-weight: 700;
            color: var(--vscode-foreground);
            font-size: 10px;
          }
          .progress-track {
            height: 4px;
            background: rgba(255,255,255,0.08);
            border-radius: 2px;
            overflow: hidden;
            margin: 1px 0;
          }
          .progress-fill {
            height: 100%;
            border-radius: 2px;
            transition: width 0.3s ease;
          }
          .progress-fill.green { background: #22c55e; }
          .progress-fill.amber { background: #f59e0b; }
          .progress-fill.red { background: #ef4444; }
          .progress-fill.gray { background: #64748b; }

          .sub-timer {
            font-size: 8.5px;
            color: #38bdf8;
          }

          .card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 10px;
            margin-top: 2px;
          }
          .footer-status {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 9.5px;
          }
          .ready-badge {
            color: #4ade80;
            font-weight: 700;
          }
          .in-use-badge {
            color: var(--vscode-descriptionForeground);
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
