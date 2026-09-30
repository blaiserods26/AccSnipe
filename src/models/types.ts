export type PlanTier = 'free' | 'plus' | 'pro' | 'ultra';

export interface AccountMeta {
  id: string;
  email: string;
  displayName: string;
  planTier: PlanTier;
  isActive: boolean;
  addedAt: number;
}

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface QuotaBreakdown {
  remainingPercent: number; // 0 - 100
  totalLimit?: number;
  resetAtEpochMs: number;   // epoch ms
}

export interface AccountQuota {
  accountId: string;
  fiveHourQuota: QuotaBreakdown | null; // null for free tier
  weeklyQuota: QuotaBreakdown;
  lastUpdated: number;                  // epoch ms
  isStale: boolean;
  isRefreshed: boolean;                 // true if 5h quota has refreshed (e.g. >= 80% or reset time 0)
}

export type SortCriteria = 'quota_desc' | 'refresh_asc' | 'plan_tier' | 'alpha';

export interface AccountViewModel {
  meta: AccountMeta;
  quota?: AccountQuota;
}
