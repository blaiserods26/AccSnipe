import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { AccountMeta, AccountQuota, AccountTokens, ModelQuotaGroup, PlanTier, QuotaBreakdown } from '../models/types';

const CLOUD_CODE_QUOTA_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

interface LanguageServerInfo {
  port: number;
  csrfToken: string;
  sourceFile: string;
}

export interface DetectedUserStatus {
  email: string;
  name: string;
  planTier: PlanTier;
  planDisplayName: string;
}

export class QuotaService {
  private quotaCache = new Map<string, AccountQuota>();
  private pollingTimer: NodeJS.Timeout | null = null;
  private _onDidChangeQuotas = new vscode.EventEmitter<Map<string, AccountQuota>>();
  public readonly onDidChangeQuotas = this._onDidChangeQuotas.event;
  private cachedLsInfo: LanguageServerInfo | null = null;

  public getCachedQuota(accountId: string): AccountQuota | undefined {
    return this.quotaCache.get(accountId);
  }

  public setCachedQuota(accountId: string, quota: AccountQuota): void {
    this.quotaCache.set(accountId, quota);
    this._onDidChangeQuotas.fire(this.quotaCache);
  }

  public getAllCachedQuotas(): Map<string, AccountQuota> {
    return new Map(this.quotaCache);
  }

  /**
   * Finds the active Antigravity Language Server port and CSRF token from ls-main.log
   */
  public findLanguageServerInfo(): LanguageServerInfo | null {
    if (this.cachedLsInfo) {
      return this.cachedLsInfo;
    }

    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const logsDir = path.join(appData, 'Antigravity IDE', 'logs');

    if (!fs.existsSync(logsDir)) {
      return null;
    }

    let newestFile: string | null = null;
    let newestMtime = 0;

    try {
      const dirs = fs.readdirSync(logsDir);
      for (const d of dirs) {
        const candidate = path.join(logsDir, d, 'ls-main.log');
        if (fs.existsSync(candidate)) {
          const stat = fs.statSync(candidate);
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestFile = candidate;
          }
        }
      }
    } catch {
      return null;
    }

    if (!newestFile) {
      return null;
    }

    try {
      const content = fs.readFileSync(newestFile, 'utf8');
      const csrfMatch = content.match(/--csrf_token\s+([a-f0-9-]+)/i);
      const portMatch = content.match(/LS started on port\s+(\d+)/i) ||
                        content.match(/listening on random port at\s+(\d+)\s+for HTTPS/i);

      if (csrfMatch && portMatch) {
        this.cachedLsInfo = {
          csrfToken: csrfMatch[1],
          port: parseInt(portMatch[1], 10),
          sourceFile: newestFile
        };
        return this.cachedLsInfo;
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Calls a Connect RPC method on the Antigravity Language Server
   */
  public async callLanguageServerRpc<T = any>(method: string, body: any = {}): Promise<T> {
    const info = this.findLanguageServerInfo();
    if (!info) {
      throw new Error('Antigravity Language Server not detected');
    }

    const payload = JSON.stringify(body);
    const options: https.RequestOptions = {
      hostname: '127.0.0.1',
      port: info.port,
      path: '/exa.language_server_pb.LanguageServerService/' + method,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': info.csrfToken,
        'Content-Length': Buffer.byteLength(payload)
      },
      rejectUnauthorized: false,
      timeout: 6000
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e: any) {
              reject(new Error('Failed to parse RPC response: ' + (e?.message || e)));
            }
          } else {
            this.cachedLsInfo = null;
            reject(new Error('Language server RPC failed (' + res.statusCode + '): ' + data));
          }
        });
      });

      req.on('error', (err) => {
        this.cachedLsInfo = null;
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Language server RPC request timed out'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Auto-detects the active account user info and subscription plan tier from Antigravity IDE
   */
  public async detectActiveUserStatus(): Promise<DetectedUserStatus | null> {
    try {
      const data = await this.callLanguageServerRpc('GetUserStatus', {});
      const userStatus = data?.userStatus;
      if (!userStatus) return null;

      const email = userStatus.email || '';
      const name = userStatus.name || email.split('@')[0] || 'User';

      let planTier: PlanTier = 'pro';
      let planDisplayName = 'Google AI Pro';

      const userTier = userStatus.userTier;
      const planInfo = userStatus.planStatus?.planInfo;

      const rawTierName = ((userTier?.name || '') + ' ' + (userTier?.id || '') + ' ' + (planInfo?.planName || '') + ' ' + (planInfo?.teamsTier || '')).toLowerCase();

      if (rawTierName.includes('ultra')) {
        planTier = 'ultra';
        planDisplayName = userTier?.name || 'Google AI Ultra';
      } else if (rawTierName.includes('pro')) {
        planTier = 'pro';
        planDisplayName = userTier?.name || 'Google AI Pro';
      } else if (rawTierName.includes('plus')) {
        planTier = 'plus';
        planDisplayName = userTier?.name || 'Google AI Plus';
      } else if (rawTierName.includes('free')) {
        planTier = 'free';
        planDisplayName = userTier?.name || 'Free Tier';
      }

      return {
        email,
        name,
        planTier,
        planDisplayName
      };
    } catch {
      return null;
    }
  }

  /**
   * Probes Google Cloud Code API to detect the subscription plan tier of an account using its OAuth access token
   */
  public async detectPlanTierFromToken(accessToken: string): Promise<{ planTier: PlanTier; planDisplayName: string } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(CLOUD_CODE_QUOTA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metadata: { ide: 'antigravity', ideVersion: '1.0' } }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data: any = await res.json();
        if (data.paidTier) {
          const raw = ((data.paidTier.name || '') + ' ' + (data.paidTier.id || '')).toLowerCase();
          if (raw.includes('ultra')) return { planTier: 'ultra', planDisplayName: data.paidTier.name || 'Google AI Ultra' };
          if (raw.includes('plus')) return { planTier: 'plus', planDisplayName: data.paidTier.name || 'Google AI Plus' };
          return { planTier: 'pro', planDisplayName: data.paidTier.name || 'Google AI Pro' };
        }
        // If no paidTier returned by Google Cloud Code, this is a Free tier account
        return { planTier: 'free', planDisplayName: 'Free Tier' };
      }
    } catch {
      // Fallback
    }
    return null;
  }

  /**
   * Fetches real live model quotas from Antigravity Language Server
   */
  public async fetchLiveLanguageServerQuota(forceRefresh = false): Promise<{
    gemini?: ModelQuotaGroup;
    claude?: ModelQuotaGroup;
  } | null> {
    try {
      const summary = await this.callLanguageServerRpc('RetrieveUserQuotaSummary', { forceRefresh });
      const groups = summary?.response?.groups || [];

      let gemini: ModelQuotaGroup | undefined;
      let claude: ModelQuotaGroup | undefined;

      for (const group of groups) {
        const displayName = (group.displayName || '').toLowerCase();
        const buckets = group.buckets || [];

        const weeklyBucket = buckets.find((b: any) =>
          b.window === 'weekly' ||
          (b.bucketId && b.bucketId.includes('weekly')) ||
          (b.displayName && b.displayName.toLowerCase().includes('weekly'))
        );

        const fiveHourBucket = buckets.find((b: any) =>
          b.window === '5h' ||
          (b.bucketId && (b.bucketId.includes('5h') || b.bucketId.includes('5-hour'))) ||
          (b.displayName && (b.displayName.toLowerCase().includes('five hour') || b.displayName.toLowerCase().includes('5-hour')))
        );

        if (!weeklyBucket) continue;

        const weeklyQuota: QuotaBreakdown = {
          remainingPercent: Math.round((weeklyBucket.remainingFraction ?? 0) * 100),
          resetAtEpochMs: weeklyBucket.resetTime ? new Date(weeklyBucket.resetTime).getTime() : Date.now() + 7 * 86400000,
          description: weeklyBucket.description
        };

        const fiveHourQuota: QuotaBreakdown | null = fiveHourBucket ? {
          remainingPercent: Math.round((fiveHourBucket.remainingFraction ?? 0) * 100),
          resetAtEpochMs: fiveHourBucket.resetTime ? new Date(fiveHourBucket.resetTime).getTime() : Date.now() + 5 * 3600000,
          description: fiveHourBucket.description
        } : null;

        if (displayName.includes('gemini')) {
          gemini = {
            name: 'Gemini Models',
            weeklyQuota,
            fiveHourQuota
          };
        } else if (displayName.includes('claude') || displayName.includes('gpt') || displayName.includes('3p')) {
          claude = {
            name: 'Claude and GPT models',
            weeklyQuota,
            fiveHourQuota
          };
        }
      }

      if (gemini || claude) {
        return { gemini, claude };
      }
    } catch {
      // Loopback not active or call failed
    }

    return null;
  }

  /**
   * Evaluates whether an account is currently 'refreshed' and ready to be sniped
   */
  public checkIsRefreshed(quota: AccountQuota): boolean {
    const fiveHour = quota.fiveHourQuota;
    if (!fiveHour) {
      return quota.weeklyQuota.remainingPercent >= 80;
    }

    const isResetTimeReached = fiveHour.resetAtEpochMs <= Date.now();
    const isHighQuota = fiveHour.remainingPercent >= 80;

    return isResetTimeReached || isHighQuota;
  }

  /**
   * Fetches the latest quota for a single account.
   * Real data is fetched for the active account via Antigravity Language Server.
   * Secondary accounts are polled via Cloud Code API; if unreached, we do NOT fake percentages.
   */
  public async fetchQuotaForAccount(
    account: AccountMeta,
    tokens?: AccountTokens
  ): Promise<AccountQuota> {
    try {
      // 1. If this is the active account in Antigravity IDE, fetch real live quotas from Language Server
      if (account.isActive) {
        const liveQuotas = await this.fetchLiveLanguageServerQuota();
        if (liveQuotas && (liveQuotas.gemini || liveQuotas.claude)) {
          const primaryGroup = liveQuotas.gemini || liveQuotas.claude!;
          const quota: AccountQuota = {
            accountId: account.id,
            geminiQuota: liveQuotas.gemini,
            claudeQuota: liveQuotas.claude,
            fiveHourQuota: primaryGroup.fiveHourQuota ?? null,
            weeklyQuota: primaryGroup.weeklyQuota,
            lastUpdated: Date.now(),
            isStale: false,
            isRefreshed: false,
            hasVerifiedData: true
          };
          quota.isRefreshed = this.checkIsRefreshed(quota);
          this.setCachedQuota(account.id, quota);
          return quota;
        }
      }

      // 2. Try Google Cloud Code / Gemini API with account token if available
      if (tokens?.accessToken) {
        const cloudResult = await this.tryFetchFromCloudCodeApi(tokens.accessToken, account.planTier);
        if (cloudResult) {
          const quota: AccountQuota = {
            accountId: account.id,
            geminiQuota: {
              name: 'Gemini Models',
              weeklyQuota: cloudResult.weekly,
              fiveHourQuota: cloudResult.fiveHour
            },
            claudeQuota: account.planTier !== 'free' ? {
              name: 'Claude and GPT models',
              weeklyQuota: cloudResult.weekly,
              fiveHourQuota: cloudResult.fiveHour
            } : undefined,
            fiveHourQuota: cloudResult.fiveHour,
            weeklyQuota: cloudResult.weekly,
            lastUpdated: Date.now(),
            isStale: false,
            isRefreshed: false,
            hasVerifiedData: true
          };
          quota.isRefreshed = this.checkIsRefreshed(quota);
          this.setCachedQuota(account.id, quota);
          return quota;
        }
      }
    } catch {
      // Ignore network failure
    }

    // 3. Fallback: If existing cached quota has verified data, keep it marked as stale
    const existing = this.quotaCache.get(account.id);
    if (existing && existing.hasVerifiedData) {
      const staleQuota: AccountQuota = {
        ...existing,
        isStale: true
      };
      this.quotaCache.set(account.id, staleQuota);
      return staleQuota;
    }

    // 4. No verified data available yet: DO NOT INVENT FAKE PERCENTAGES!
    // Return an unverified quota placeholder prompting the user to switch to sync live values.
    const unverified: AccountQuota = {
      accountId: account.id,
      geminiQuota: undefined,
      claudeQuota: undefined,
      fiveHourQuota: null,
      weeklyQuota: { remainingPercent: 0, resetAtEpochMs: 0 },
      lastUpdated: Date.now(),
      isStale: true,
      isRefreshed: false,
      hasVerifiedData: false
    };
    this.setCachedQuota(account.id, unverified);
    return unverified;
  }

  /**
   * Attempts connection to Cloud Code PA endpoint
   */
  private async tryFetchFromCloudCodeApi(
    accessToken: string,
    planTier: string
  ): Promise<{ fiveHour: QuotaBreakdown | null; weekly: QuotaBreakdown } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(CLOUD_CODE_QUOTA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metadata: { ide: 'antigravity', ideVersion: '1.0' } }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data: any = await res.json();
        const now = Date.now();
        const fiveHourPercent = data.userTierQuota?.fiveHourRemainingRatio != null
          ? Math.round(data.userTierQuota.fiveHourRemainingRatio * 100)
          : (planTier === 'free' ? null : null);

        return {
          fiveHour: fiveHourPercent != null ? {
            remainingPercent: fiveHourPercent,
            resetAtEpochMs: data.userTierQuota?.fiveHourResetTimeMs || (now + 3600000)
          } : null,
          weekly: {
            remainingPercent: data.userTierQuota?.weeklyRemainingRatio != null
              ? Math.round(data.userTierQuota.weeklyRemainingRatio * 100)
              : 0,
            resetAtEpochMs: data.userTierQuota?.weeklyResetTimeMs || (now + 259200000)
          }
        };
      }
    } catch {
      // Cloud Code endpoint unreached
    }
    return null;
  }

  /**
   * Starts recurring background polling of quotas across all accounts
   */
  public startPolling(
    accountsProvider: () => AccountMeta[],
    tokensProvider: (id: string) => Promise<AccountTokens | undefined>,
    intervalMinutes: number = 5
  ): void {
    this.stopPolling();
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

    const poll = async () => {
      const accounts = accountsProvider();
      for (const acc of accounts) {
        const tokens = await tokensProvider(acc.id);
        await this.fetchQuotaForAccount(acc, tokens);
      }
    };

    poll();
    this.pollingTimer = setInterval(poll, intervalMs);
  }

  public stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}
