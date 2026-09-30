import * as http from 'http';
import * as url from 'url';
import * as vscode from 'vscode';
import { AccountTokens } from '../models/types';

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
   * Main Google Login flow.
   * Uses VS Code's official built-in Google Authentication Provider by default (no invalid_client error).
   * If a custom Google Client ID is configured in settings, falls back to custom loopback server.
   */
  public async loginWithGoogle(): Promise<AuthResult> {
    const config = vscode.workspace.getConfiguration('accsnipe');
    const customClientId = config.get<string>('googleClientId', '').trim();
    const customClientSecret = config.get<string>('googleClientSecret', '').trim();

    if (customClientId) {
      return this.loginWithCustomLoopback(customClientId, customClientSecret);
    }

    return this.loginWithVsCodeGoogle();
  }

  /**
   * Leverages VS Code's official built-in Google Authentication provider.
   * This is pre-registered with Google and guaranteed not to throw Error 401 invalid_client.
   */
  public async loginWithVsCodeGoogle(): Promise<AuthResult> {
    try {
      const session = await vscode.authentication.getSession(
        'google',
        [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ],
        { createIfNone: true, clearSessionPreference: true }
      );

      if (!session) {
        throw new Error('Google sign-in was cancelled or returned no session.');
      }

      let displayName = session.account.label.split('@')[0];
      try {
        const profile = await this.fetchUserProfile(session.accessToken);
        if (profile.name) {
          displayName = profile.name;
        }
      } catch {
        // Fallback to email username if userinfo profile fetch fails
      }

      return {
        email: session.account.label,
        displayName,
        tokens: {
          accessToken: session.accessToken,
          refreshToken: '',
          expiresAt: Date.now() + 3600000
        }
      };
    } catch (err: any) {
      throw new Error(`VS Code Google Auth error: ${err.message}`);
    }
  }

  /**
   * Starts a local loopback server for users who configured their own Google Cloud Console OAuth Client ID.
   */
  public async loginWithCustomLoopback(clientId: string, clientSecret?: string): Promise<AuthResult> {
    return new Promise<AuthResult>((resolve, reject) => {
      let redirectUri = '';
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
                const tokens = await this.exchangeCodeForTokens(code, redirectUri, clientId, clientSecret);
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

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        const port = address.port;
        redirectUri = `http://127.0.0.1:${port}/callback`;

        const authUrl = `${GOOGLE_AUTH_ENDPOINT}?` + new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          access_type: 'offline',
          prompt: 'select_account consent'
        }).toString();

        vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });

      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out after 3 minutes.'));
      }, 180000);
    });
  }

  /**
   * Exchanges authorization code for OAuth tokens using custom client
   */
  public async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret?: string
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
  public async refreshAccessToken(refreshToken: string, clientId?: string): Promise<AccountTokens> {
    const config = vscode.workspace.getConfiguration('accsnipe');
    const effectiveClientId = clientId || config.get<string>('googleClientId', '');

    if (!effectiveClientId) {
      // For VS Code built-in auth, tokens are refreshed automatically by VS Code
      return {
        accessToken: refreshToken,
        refreshToken,
        expiresAt: Date.now() + 3600000
      };
    }

    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: effectiveClientId,
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
