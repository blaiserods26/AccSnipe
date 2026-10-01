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

  it('updates Antigravity UnifiedStateSync OAuth credentials without clearing user status on switch', async () => {
    const setOAuthSpy = vi.fn().mockResolvedValue(undefined);
    const clearStatusSpy = vi.fn().mockResolvedValue(undefined);
    const execCommandSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as any);

    (vscode as any).antigravityUnifiedStateSync = {
      OAuthPreferences: {
        setOAuthTokenInfo: setOAuthSpy
      },
      UserStatus: {
        clearUserStatus: clearStatusSpy
      }
    };

    const accounts = accountStore.getAccounts();
    const target = accounts.find(a => a.email === 'target@test.com')!;

    const result = await switcherService.switchAccount(target.id, false);
    expect(result.success).toBe(true);
    expect(setOAuthSpy).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-2',
      refreshToken: 'ref-2'
    }));
    // CRITICAL: clearUserStatus MUST NOT be called because it causes 'Error: No auth token found'
    expect(clearStatusSpy).not.toHaveBeenCalled();
  });

  it('triggers loginWithGoogle when switching to an account with manual or invalid tokens', async () => {
    const setOAuthSpy = vi.fn().mockResolvedValue(undefined);
    (vscode as any).antigravityUnifiedStateSync = {
      OAuthPreferences: { setOAuthTokenInfo: setOAuthSpy },
      UserStatus: { clearUserStatus: vi.fn() }
    };

    const mockAuthService = {
      loginWithGoogle: vi.fn().mockResolvedValue({
        email: 'manual@test.com',
        displayName: 'Manual User',
        tokens: {
          accessToken: 'fresh-oauth-token',
          refreshToken: 'fresh-refresh-token',
          expiresAt: Date.now() + 3600000
        }
      }),
      refreshAccessToken: vi.fn()
    };

    const switcher = new SwitcherService(accountStore, mockAuthService as any);

    const manualAcc = await accountStore.addAccount({
      email: 'manual@test.com',
      displayName: 'Manual User',
      planTier: 'free',
      isActive: false
    }, {
      accessToken: 'manual_token',
      refreshToken: 'manual_refresh',
      expiresAt: Date.now() + 86400000
    });

    const result = await switcher.switchAccount(manualAcc.id, false);
    expect(result.success).toBe(true);
    expect(mockAuthService.loginWithGoogle).toHaveBeenCalled();
    expect(setOAuthSpy).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-oauth-token'
    }));

    const storedTokens = await accountStore.getTokens(manualAcc.id);
    expect(storedTokens?.accessToken).toBe('fresh-oauth-token');
  });

  it('refreshes expired tokens before updating Antigravity USS on switch', async () => {
    const setOAuthSpy = vi.fn().mockResolvedValue(undefined);
    (vscode as any).antigravityUnifiedStateSync = {
      OAuthPreferences: { setOAuthTokenInfo: setOAuthSpy },
      UserStatus: { clearUserStatus: vi.fn() }
    };

    const mockAuthService = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        accessToken: 'fresh-refreshed-token',
        refreshToken: 'ref-expired',
        expiresAt: Date.now() + 3600000
      })
    };

    const switcherWithAuth = new SwitcherService(accountStore, mockAuthService as any);

    await accountStore.addAccount({
      email: 'expired@test.com',
      displayName: 'Expired Account',
      planTier: 'pro',
      isActive: false
    }, {
      accessToken: 'stale-token',
      refreshToken: 'ref-expired',
      expiresAt: Date.now() - 5000 // expired
    });

    const accounts = accountStore.getAccounts();
    const expiredAcc = accounts.find(a => a.email === 'expired@test.com')!;

    const result = await switcherWithAuth.switchAccount(expiredAcc.id, false);
    expect(result.success).toBe(true);
    expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('ref-expired');
    expect(setOAuthSpy).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-refreshed-token'
    }));

    const updatedTokens = await accountStore.getTokens(expiredAcc.id);
    expect(updatedTokens?.accessToken).toBe('fresh-refreshed-token');
  });

  it('returns failure when attempting to switch to non-existent account ID', async () => {
    const result = await switcherService.switchAccount('non-existent-id', false);
    expect(result.success).toBe(false);
  });
});
