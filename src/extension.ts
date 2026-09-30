import * as vscode from 'vscode';
import { AccountStore } from './services/accountStore';
import { AuthService } from './services/authService';
import { QuotaService } from './services/quotaService';
import { SwitcherService } from './services/switcherService';
import { AccSnipeViewProvider } from './views/accSnipeViewProvider';

export function activate(context: vscode.ExtensionContext) {
  // 1. Initialize Core Services
  const accountStore = new AccountStore(context.globalState, context.secrets);
  const authService = new AuthService();
  const quotaService = new QuotaService();
  const switcherService = new SwitcherService(accountStore);

  // 2. Register Webview Provider
  const viewProvider = new AccSnipeViewProvider(
    context,
    accountStore,
    quotaService,
    switcherService,
    authService
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AccSnipeViewProvider.viewType,
      viewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 3. Register Extension Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('accsnipe.addAccount', async () => {
      await viewProvider.handleAddAccount();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('accsnipe.refreshQuotas', async () => {
      const accounts = accountStore.getAccounts();
      if (accounts.length === 0) {
        vscode.window.showInformationMessage('AccSnipe: No accounts to refresh.');
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'AccSnipe: Refreshing account quotas...'
      }, async () => {
        for (const a of accounts) {
          const tokens = await accountStore.getTokens(a.id);
          await quotaService.fetchQuotaForAccount(a, tokens);
        }
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('accsnipe.switchAccount', async () => {
      const accounts = accountStore.getAccounts();
      if (accounts.length === 0) {
        vscode.window.showInformationMessage('AccSnipe: No accounts available. Please add an account first.');
        return;
      }

      const items = accounts.map(a => ({
        label: `${a.isActive ? '$(check) ' : ''}${a.displayName || a.email}`,
        description: `${a.planTier.toUpperCase()} • ${a.email}`,
        accountId: a.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select Google account to switch to'
      });

      if (selected) {
        await switcherService.switchAccount(selected.accountId);
      }
    })
  );

  // 4. Start Background Quota Poller
  const config = vscode.workspace.getConfiguration('accsnipe');
  const pollingInterval = config.get<number>('pollingIntervalMinutes', 5);

  quotaService.startPolling(
    () => accountStore.getAccounts(),
    (id: string) => accountStore.getTokens(id),
    pollingInterval
  );

  context.subscriptions.push({
    dispose: () => quotaService.stopPolling()
  });
}

export function deactivate() {}
