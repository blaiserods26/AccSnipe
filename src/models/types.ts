export type PlanTier = 'free' | 'plus' | 'pro' | 'ultra';

export interface AccountMeta {
  id: string;
  email: string;
  displayName: string;
  planTier: PlanTier;
  planDisplayName?: string;
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
  description?: string;
}

export interface ModelQuotaGroup {
  name: string; // 'Gemini' | 'Claude & GPT'
  weeklyQuota: QuotaBreakdown;
  fiveHourQuota?: QuotaBreakdown | null;
}

export interface AccountQuota {
  accountId: string;
  geminiQuota?: ModelQuotaGroup;
  claudeQuota?: ModelQuotaGroup;
  fiveHourQuota: QuotaBreakdown | null; // Primary / fallback 5h quota
  weeklyQuota: QuotaBreakdown;           // Primary / fallback weekly quota
  lastUpdated: number;                  // epoch ms
  isStale: boolean;
  isRefreshed: boolean;                 // true if 5h quota has refreshed (e.g. >= 80% or reset time passed)
  hasVerifiedData?: boolean;            // true if fetched from live Language Server or API, false if unverified
}

export type SortCriteria = 'quota_desc' | 'refresh_asc' | 'plan_tier' | 'alpha';

export interface AccountViewModel {
  meta: AccountMeta;
  quota?: AccountQuota;
}
