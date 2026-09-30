import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SwitcherService } from '../src/services/switcherService';
import { AccountStore } from '../src/services/accountStore';
import * as vscode from 'vscode';

class MockMemento {
  private storage = new Map<string, any>();
  get<T>(key: string, defaultValue?: T): T {
    return this.storage.has(key) ? this.storage.get(key) : defaultValue!;
  }
  async update(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }
}

class MockSecretStorage {
  private secrets = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

describe('SwitcherService', () => {
  let accountStore: AccountStore;
  let switcherService: SwitcherService;

  beforeEach(async () => {
    const mem = new MockMemento();
    const secrets = new MockSecretStorage();
    accountStore = new AccountStore(mem as any, secrets as any);

    await accountStore.addAccount({
      email: 'active@test.com',
      displayName: 'Active',
      planTier: 'pro',
      isActive: true
    }, { accessToken: 'token-1', refreshToken: 'ref-1', expiresAt: Date.now() + 10000 });

    await accountStore.addAccount({
      email: 'target@test.com',
      displayName: 'Target',
      planTier: 'plus',
      isActive: false
    }, { accessToken: 'token-2', refreshToken: 'ref-2', expiresAt: Date.now() + 10000 });

    switcherService = new SwitcherService(accountStore);
  });

  it('successfully switches active account in store and prepares credentials', async () => {
    const accounts = accountStore.getAccounts();
    const target = accounts.find(a => a.email === 'target@test.com')!;

    const result = await switcherService.switchAccount(target.id, false);
    expect(result.success).toBe(true);
    expect(accountStore.getActiveAccount()?.id).toBe(target.id);
  });

  it('returns failure when attempting to switch to non-existent account ID', async () => {
    const result = await switcherService.switchAccount('non-existent-id', false);
    expect(result.success).toBe(false);
  });
});
