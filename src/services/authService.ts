import * as http from 'http';
import * as url from 'url';
import * as vscode from 'vscode';
import { AccountTokens } from '../models/types';

// Standard Google Cloud Client configuration for Desktop/VSCode apps
// Note: Users can override these via settings or environment
const DEFAULT_CLIENT_ID = '930873678072-k6b4f7vd90v3i0hbb33l9r5vsq12o08a.apps.googleusercontent.com'; // Antigravity/CloudCode public client ID or custom
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
   * Starts a local loopback server, prompts the user in browser, and exchanges auth code for tokens.
   */
  public async loginWithGoogle(): Promise<AuthResult> {
    return new Promise<AuthResult>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url || '', true);
          if (reqUrl.pathname === '/callback') {
            const code = reqUrl.query.code as string;
            const error = reqUrl.query.error as string;

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<h3>Authentication Failed: ${error}</h3><p>You can close this tab.</p>`);
              server.close();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #121214; color: #eee;">
                    <h2 style="color: #4ade80;">✓ Authentication Successful!</h2>
                    <p>AccSnipe received your Google authorization. You may close this tab and return to VS Code.</p>
                  </body>
                </html>
              `);

              server.close();

              try {
                // Exchange code for tokens
                const tokens = await this.exchangeCodeForTokens(code, redirectUri);
                // Fetch user info
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

      // Listen on random available port
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        const port = address.port;
        redirectUri = `http://127.0.0.1:${port}/callback`;

        const authUrl = `${GOOGLE_AUTH_ENDPOINT}?` + new URLSearchParams({
          client_id: DEFAULT_CLIENT_ID,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile https://www.googleapis.com/auth/cloud-platform',
          access_type: 'offline',
          prompt: 'select_account consent'
        }).toString();

        vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });

      let redirectUri = '';

      // Timeout after 3 minutes if user didn't complete browser login
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out after 3 minutes.'));
      }, 180000);
    });
  }

  /**
   * Exchanges authorization code for OAuth tokens
   */
  public async exchangeCodeForTokens(code: string, redirectUri: string): Promise<AccountTokens> {
    const params = new URLSearchParams({
      code,
      client_id: DEFAULT_CLIENT_ID,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

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
  public async refreshAccessToken(refreshToken: string): Promise<AccountTokens> {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: DEFAULT_CLIENT_ID,
      grant_type: 'refresh_token'
    });

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
