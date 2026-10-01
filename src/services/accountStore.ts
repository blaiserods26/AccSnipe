import * as vscode from 'vscode';
import { AccountMeta, AccountTokens } from '../models/types';
import * as crypto from 'crypto';

const STORAGE_KEY_ACCOUNTS = 'accsnipe.accounts.index';
const SECRET_PREFIX = 'accsnipe.tokens.';

export class AccountStore {
  private _onDidChangeAccounts = new vscode.EventEmitter<AccountMeta[]>();
  public readonly onDidChangeAccounts = this._onDidChangeAccounts.event;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secretStorage: vscode.SecretStorage
  ) {}

  public getAccounts(): AccountMeta[] {
    return this.globalState.get<AccountMeta[]>(STORAGE_KEY_ACCOUNTS, []);
  }

  public getActiveAccount(): AccountMeta | undefined {
    return this.getAccounts().find(a => a.isActive);
  }

  public async addAccount(
    data: Omit<AccountMeta, 'id' | 'addedAt'>,
    tokens: AccountTokens
  ): Promise<AccountMeta> {
    const id = crypto.randomUUID ? crypto.randomUUID() : `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newAccount: AccountMeta = {
      id,
      email: data.email,
      displayName: data.displayName,
      planTier: data.planTier,
      planDisplayName: data.planDisplayName,
      isActive: data.isActive,
      addedAt: Date.now()
    };

    let accounts = this.getAccounts();

    // If new account is active, mark all others as inactive
    if (newAccount.isActive) {
      accounts = accounts.map(a => ({ ...a, isActive: false }));
    } else if (accounts.length === 0) {
      newAccount.isActive = true;
    }

    accounts.push(newAccount);
    await this.globalState.update(STORAGE_KEY_ACCOUNTS, accounts);
    await this.secretStorage.store(`${SECRET_PREFIX}${id}`, JSON.stringify(tokens));

    this._onDidChangeAccounts.fire(accounts);
    return newAccount;
  }

  public async updateAccount(id: string, updates: Partial<AccountMeta>): Promise<boolean> {
    const accounts = this.getAccounts();
    const index = accounts.findIndex(a => a.id === id);
    if (index === -1) return false;

    accounts[index] = { ...accounts[index], ...updates };
    await this.globalState.update(STORAGE_KEY_ACCOUNTS, accounts);
    this._onDidChangeAccounts.fire(accounts);
    return true;
  }

  public async setActiveAccount(id: string): Promise<boolean> {
    const accounts = this.getAccounts();
    const target = accounts.find(a => a.id === id);
    if (!target) {
      return false;
    }

    const updated = accounts.map(a => ({
      ...a,
      isActive: a.id === id
    }));

    await this.globalState.update(STORAGE_KEY_ACCOUNTS, updated);
    this._onDidChangeAccounts.fire(updated);
    return true;
  }

  public async removeAccount(id: string): Promise<boolean> {
    const accounts = this.getAccounts();
    const filtered = accounts.filter(a => a.id !== id);
    if (filtered.length === accounts.length) {
      return false;
    }

    // If removed account was active and accounts remain, make first one active
    if (accounts.find(a => a.id === id)?.isActive && filtered.length > 0) {
      filtered[0].isActive = true;
    }

    await this.globalState.update(STORAGE_KEY_ACCOUNTS, filtered);
    await this.secretStorage.delete(`${SECRET_PREFIX}${id}`);

    this._onDidChangeAccounts.fire(filtered);
    return true;
  }

  public async getTokens(id: string): Promise<AccountTokens | undefined> {
    const raw = await this.secretStorage.get(`${SECRET_PREFIX}${id}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as AccountTokens;
    } catch {
      return undefined;
    }
  }

  public async updateTokens(id: string, tokens: AccountTokens): Promise<void> {
    await this.secretStorage.store(`${SECRET_PREFIX}${id}`, JSON.stringify(tokens));
  }

  /**
   * Auto-detects the currently active Antigravity IDE account.
   * If already registered, marks it as active and syncs metadata/tokens.
   * If not registered, auto-imports it with active status.
   */
  public async syncActiveAccountFromIde(
    email: string,
    details?: {
      displayName?: string;
      planTier?: 'free' | 'pro' | 'plus' | 'ultra';
      planDisplayName?: string;
    },
    tokens?: AccountTokens
  ): Promise<AccountMeta> {
    const accounts = this.getAccounts();
    const existing = accounts.find(a => a.email.toLowerCase() === email.toLowerCase());

    if (existing) {
      const updates: Partial<AccountMeta> = {};
      if (details?.planTier && details.planTier !== existing.planTier) {
        updates.planTier = details.planTier;
      }
      if (details?.planDisplayName && details.planDisplayName !== existing.planDisplayName) {
        updates.planDisplayName = details.planDisplayName;
      }
      if (details?.displayName && details.displayName !== existing.displayName) {
        updates.displayName = details.displayName;
      }

      if (Object.keys(updates).length > 0) {
        await this.updateAccount(existing.id, updates);
      }

      if (!existing.isActive) {
        await this.setActiveAccount(existing.id);
      }

      if (tokens && tokens.accessToken && tokens.accessToken !== 'manual_token' && tokens.accessToken !== 'local_active_session') {
        await this.updateTokens(existing.id, tokens);
      }

      return this.getAccounts().find(a => a.id === existing.id)!;
    }

    // Auto-import detected active account
    return this.addAccount({
      email,
      displayName: details?.displayName || email.split('@')[0],
      planTier: details?.planTier || 'free',
      planDisplayName: details?.planDisplayName || 'Free Tier',
      isActive: true
    }, tokens || {
      accessToken: 'local_active_session',
      refreshToken: '',
      expiresAt: Date.now() + 30 * 86400000
    });
  }
}
