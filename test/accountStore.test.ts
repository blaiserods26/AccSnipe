import { describe, it, expect, beforeEach } from 'vitest';
import { AccountStore } from '../src/services/accountStore';
import { AccountTokens, AccountMeta } from '../src/models/types';

// Mock VS Code Memento (globalState)
class MockMemento {
  private storage = new Map<string, any>();
  get<T>(key: string, defaultValue?: T): T {
    return this.storage.has(key) ? this.storage.get(key) : defaultValue!;
  }
  async update(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }
}

// Mock VS Code SecretStorage
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
  onDidChange = () => ({ dispose: () => {} });
}

describe('AccountStore', () => {
  let globalState: MockMemento;
  let secretStorage: MockSecretStorage;
  let store: AccountStore;

  beforeEach(() => {
    globalState = new MockMemento();
    secretStorage = new MockSecretStorage();
    store = new AccountStore(globalState as any, secretStorage as any);
  });

  it('starts with an empty account list', () => {
    expect(store.getAccounts()).toEqual([]);
    expect(store.getActiveAccount()).toBeUndefined();
  });

  it('adds an account and saves tokens in SecretStorage', async () => {
    const tokens: AccountTokens = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: Date.now() + 3600000
    };

    const added = await store.addAccount({
      email: 'dev@gmail.com',
      displayName: 'Dev User',
      planTier: 'pro',
      isActive: true
    }, tokens);

    expect(added.email).toBe('dev@gmail.com');
    expect(added.planTier).toBe('pro');
    expect(added.isActive).toBe(true);

    const accounts = store.getAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts[0].id).toBe(added.id);

    // Tokens must be in secret storage
    const storedTokens = await store.getTokens(added.id);
    expect(storedTokens).toEqual(tokens);
  });

  it('sets only one account active at a time', async () => {
    const tokens: AccountTokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 1000 };
    const acc1 = await store.addAccount({ email: 'one@gmail.com', displayName: 'One', planTier: 'plus', isActive: true }, tokens);
    const acc2 = await store.addAccount({ email: 'two@gmail.com', displayName: 'Two', planTier: 'pro', isActive: false }, tokens);

    expect(store.getActiveAccount()?.id).toBe(acc1.id);

    await store.setActiveAccount(acc2.id);
    expect(store.getActiveAccount()?.id).toBe(acc2.id);

    const accounts = store.getAccounts();
    expect(accounts.find(a => a.id === acc1.id)?.isActive).toBe(false);
    expect(accounts.find(a => a.id === acc2.id)?.isActive).toBe(true);
  });

  it('removes an account and its tokens', async () => {
    const tokens: AccountTokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 1000 };
    const acc = await store.addAccount({ email: 'remove@gmail.com', displayName: 'R', planTier: 'free', isActive: true }, tokens);

    expect(store.getAccounts().length).toBe(1);
    await store.removeAccount(acc.id);

    expect(store.getAccounts().length).toBe(0);
    const storedTokens = await store.getTokens(acc.id);
    expect(storedTokens).toBeUndefined();
  });

  it('auto-detects and activates an existing account when active email is detected', async () => {
    const tokens: AccountTokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 1000 };
    const acc1 = await store.addAccount({ email: 'user1@gmail.com', displayName: 'User 1', planTier: 'pro', isActive: true }, tokens);
    const acc2 = await store.addAccount({ email: 'user2@gmail.com', displayName: 'User 2', planTier: 'plus', isActive: false }, tokens);

    const synced = await (store as any).syncActiveAccountFromIde('user2@gmail.com');
    expect(synced?.id).toBe(acc2.id);
    expect(store.getActiveAccount()?.id).toBe(acc2.id);
    expect(store.getAccounts().find(a => a.id === acc1.id)?.isActive).toBe(false);
  });

  it('auto-imports a new account if detected IDE account does not exist in store', async () => {
    const synced = await (store as any).syncActiveAccountFromIde('newbie@gmail.com', {
      displayName: 'Newbie User',
      planTier: 'pro',
      planDisplayName: 'Google AI Pro'
    }, {
      accessToken: 'token-new',
      refreshToken: '',
      expiresAt: Date.now() + 3600000
    });

    expect(synced.email).toBe('newbie@gmail.com');
    expect(synced.isActive).toBe(true);
    expect(store.getActiveAccount()?.email).toBe('newbie@gmail.com');
    expect(store.getAccounts().length).toBe(1);
  });
});
