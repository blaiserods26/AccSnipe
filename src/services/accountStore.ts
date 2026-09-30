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
}
