import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaService } from '../src/services/quotaService';
import { AccountMeta, AccountQuota } from '../src/models/types';

describe('QuotaService', () => {
  let quotaService: QuotaService;

  const mockProAccount: AccountMeta = {
    id: 'acc-pro',
    email: 'pro@test.com',
    displayName: 'Pro User',
    planTier: 'pro',
    isActive: true,
    addedAt: Date.now()
  };

  const mockFreeAccount: AccountMeta = {
    id: 'acc-free',
    email: 'free@test.com',
    displayName: 'Free User',
    planTier: 'free',
    isActive: false,
    addedAt: Date.now()
  };

  beforeEach(() => {
    quotaService = new QuotaService();
  });

  it('formats quota accurately for Pro accounts with separate Gemini and Claude limits', async () => {
    const quota = await quotaService.fetchQuotaForAccount(mockProAccount);
    expect(quota.accountId).toBe(mockProAccount.id);
    expect(quota.fiveHourQuota).not.toBeNull();
    expect(quota.fiveHourQuota?.remainingPercent).toBeGreaterThanOrEqual(0);
    expect(quota.weeklyQuota.remainingPercent).toBeGreaterThanOrEqual(0);
    expect(quota.geminiQuota).toBeDefined();
    expect(quota.geminiQuota?.weeklyQuota.remainingPercent).toBeGreaterThanOrEqual(0);
    expect(quota.claudeQuota).toBeDefined();
    expect(quota.claudeQuota?.weeklyQuota.remainingPercent).toBeGreaterThanOrEqual(0);
    expect(quota.isStale).toBe(false);
  });

  it('formats Free account quota with null fiveHourQuota and active weeklyQuota', async () => {
    const quota = await quotaService.fetchQuotaForAccount(mockFreeAccount);
    expect(quota.accountId).toBe(mockFreeAccount.id);
    expect(quota.fiveHourQuota).toBeNull();
    expect(quota.weeklyQuota).toBeDefined();
    expect(quota.weeklyQuota.remainingPercent).toBeGreaterThanOrEqual(0);
  });

  it('correctly marks isRefreshed when 5-hour quota is above 80%', () => {
    const quota: AccountQuota = {
      accountId: 'test',
      fiveHourQuota: { remainingPercent: 85, resetAtEpochMs: Date.now() + 10000 },
      weeklyQuota: { remainingPercent: 50, resetAtEpochMs: Date.now() + 86400000 },
      lastUpdated: Date.now(),
      isStale: false,
      isRefreshed: false
    };

    expect(quotaService.checkIsRefreshed(quota)).toBe(true);
  });

  it('correctly caches and retrieves quota by account ID', () => {
    const fakeQuota: AccountQuota = {
      accountId: 'acc-1',
      fiveHourQuota: { remainingPercent: 90, resetAtEpochMs: Date.now() },
      weeklyQuota: { remainingPercent: 70, resetAtEpochMs: Date.now() },
      lastUpdated: Date.now(),
      isStale: false,
      isRefreshed: true
    };

    quotaService.setCachedQuota('acc-1', fakeQuota);
    expect(quotaService.getCachedQuota('acc-1')).toEqual(fakeQuota);
  });

  it('auto-detects Antigravity active user and plan tier when IDE language server is active', async () => {
    const detected = await quotaService.detectActiveUserStatus();
    if (detected) {
      expect(detected.email).toBeDefined();
      expect(['pro', 'plus', 'ultra', 'free']).toContain(detected.planTier);
      expect(detected.planDisplayName).toBeDefined();
    }
  });
});
