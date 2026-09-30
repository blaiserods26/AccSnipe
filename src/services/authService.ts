import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AccountTokens } from '../models/types';

// Google Cloud SDK official public Desktop Client ID and Secret
// Pre-registered with Google and supports 127.0.0.1 loopback redirects
const GCLOUD_DESKTOP_CLIENT_ID = '32555940559.apps.googleusercontent.com';
const GCLOUD_DESKTOP_CLIENT_SECRET = 'ZmssLNjJy2998hD4CTg2ejr2';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

export interface AuthResult {
  email: string;
  displayName: string;
  tokens: AccountTokens;
}

export class AuthService {
  /**
   * Main Google Login flow for Antigravity & VS Code.
   * Runs a local HTTP loopback on 127.0.0.1 with Google Cloud Desktop Client.
   * Eliminates both 'invalid_client' and 'provider not found' errors.
   */
  public async loginWithGoogle(): Promise<AuthResult> {
    const config = vscode.workspace.getConfiguration('accsnipe');
    const customClientId = config.get<string>('googleClientId', '').trim();
    const customClientSecret = config.get<string>('googleClientSecret', '').trim();

    const clientId = customClientId || GCLOUD_DESKTOP_CLIENT_ID;
    const clientSecret = customClientId ? (customClientSecret || undefined) : GCLOUD_DESKTOP_CLIENT_SECRET;

    return this.loginWithLoopback(clientId, clientSecret);
  }

  /**
   * Starts a local loopback server, opens the browser consent screen, and exchanges auth code.
   */
  public async loginWithLoopback(clientId: string, clientSecret?: string): Promise<AuthResult> {
    return new Promise<AuthResult>((resolve, reject) => {
      // Generate PKCE code verifier and challenge
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      let redirectUri = '';
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url || '', true);
          if (reqUrl.pathname === '/callback') {
            const code = reqUrl.query.code as string;
            const error = reqUrl.query.error as string;

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #121214; color: #eee;">
                    <h3 style="color: #ef4444;">Authentication Failed</h3>
                    <p>${error}</p>
                  </body>
                </html>
              `);
              server.close();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <head><title>AccSnipe Authorized</title></head>
                  <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #121214; color: #eee;">
                    <h2 style="color: #4ade80;">✓ Authentication Successful!</h2>
                    <p style="color: #94a3b8;">AccSnipe has received your Google authorization.</p>
                    <p style="font-size: 13px; color: #64748b; margin-top: 16px;">You can safely close this browser window and return to Antigravity IDE.</p>
                  </body>
                </html>
              `);

              server.close();

              try {
                const tokens = await this.exchangeCodeForTokens(code, redirectUri, clientId, clientSecret, codeVerifier);
                const userProfile = await this.fetchUserProfile(tokens.accessToken);
                resolve({
                  email: userProfile.email,
                  displayName: userProfile.name || userProfile.email.split('@')[0],
                  tokens
                });
              } catch (ex: any) {
                reject(ex);
              }
            }
          }
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      // Bind to 127.0.0.1 on a random available port
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        const port = address.port;
        redirectUri = `http://127.0.0.1:${port}/callback`;

        const authParams: Record<string, string> = {
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile https://www.googleapis.com/auth/cloud-platform',
          access_type: 'offline',
          prompt: 'consent select_account',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256'
        };

        const authUrl = `${GOOGLE_AUTH_ENDPOINT}?` + new URLSearchParams(authParams).toString();
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });

      // Timeout after 3 minutes if user didn't complete browser login
      setTimeout(() => {
        try { server.close(); } catch {}
        reject(new Error('Authentication timed out after 3 minutes.'));
      }, 180000);
    });
  }

  /**
   * Exchanges authorization code for OAuth tokens
   */
  public async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret?: string,
    codeVerifier?: string
  ): Promise<AccountTokens> {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }
    if (codeVerifier) {
      params.append('code_verifier', codeVerifier);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt: Date.now() + ((data.expires_in || 3600) * 1000)
    };
  }

  /**
   * Silently refreshes an access token using a refresh token
   */
  public async refreshAccessToken(refreshToken: string, clientId?: string, clientSecret?: string): Promise<AccountTokens> {
    const config = vscode.workspace.getConfiguration('accsnipe');
    const customClientId = config.get<string>('googleClientId', '').trim();
    const customClientSecret = config.get<string>('googleClientSecret', '').trim();

    const effClientId = clientId || customClientId || GCLOUD_DESKTOP_CLIENT_ID;
    const effClientSecret = clientSecret || (customClientId ? customClientSecret : GCLOUD_DESKTOP_CLIENT_SECRET);

    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: effClientId,
      grant_type: 'refresh_token'
    });

    if (effClientSecret) {
      params.append('client_secret', effClientSecret);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data: any = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + ((data.expires_in || 3600) * 1000)
    };
  }

  /**
   * Revokes the token with Google servers on account deletion
   */
  public async revokeToken(token: string): Promise<boolean> {
    try {
      const response = await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetches the user profile (email and display name) using an access token
   */
  public async fetchUserProfile(accessToken: string): Promise<{ email: string; name: string }> {
    const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.statusText}`);
    }

    const json: any = await response.json();
    return {
      email: json.email,
      name: json.name || json.email
    };
  }
}
