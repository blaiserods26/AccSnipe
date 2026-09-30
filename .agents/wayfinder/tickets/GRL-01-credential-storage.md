# GRL-01 — Account Storage & Credential Security Design

**Labels:** `wayfinder:grilling`
**Status:** Open (unclaimed)
**Blocked by:** RES-01, RES-02

---

## Question

How should the extension store and manage multiple Google account credentials (tokens, session data) on the user's machine?

This is a HITL grilling session. Questions to resolve:

1. **How many accounts?** Is there a practical max (e.g. 3 free + 1 pro) or should it be unlimited?
2. **Privacy / Security level**: Should credentials be stored in VS Code's encrypted `SecretStorage`, a plain config JSON, or the OS keychain?
3. **First-run flow**: When a user adds a new account, should they:
   - Go through a full OAuth browser flow inside VS Code?
   - Paste an existing session token/cookie from their browser?
   - Some other mechanism?
4. **Token refresh**: If OAuth tokens expire, should the extension auto-refresh in the background or prompt the user?
5. **Account removal**: Should removing an account also revoke the token or just delete the local reference?

Decisions here determine the credential data model and the security architecture of the extension.
