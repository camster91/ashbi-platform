# ChatGPT read-only MCP OAuth candidate

This implementation is off by default. The deployed API-key MCP and GPT Actions
paths continue to work. No database migration or new dependency is required.

The candidate uses existing Ashbi sign-in, MFA enforcement and recent password
confirmation. The MCP SDK handles protocol validation; the provider verifies
S256 PKCE at the single-use code exchange boundary. The exact ChatGPT CIMD URL
and stable callback are allowlisted. Issuer identification appears in successful
and denied authorization responses. The MCP endpoint is the required resource
in both authorization and token exchanges.

Consent grants only `workspace:read`. Access tokens last one hour; rotating
refresh tokens expire with their original 30-day grant. Token hashes and expiry
are stored in existing API-key rows and Redis. Revoking the named connection in
Settings, changing account/session access, changing tenants or failing current
MFA requirements prevents further use. OAuth tokens are rejected by the generic
API-key authenticator and accepted only at `/api/mcp`.

## Enablement acceptance

1. Complete security review and all required CI gates on the exact revision.
2. Exercise the protocol against real Redis/PostgreSQL in the QA stack, including
   refresh races, revocation and tenant isolation. Local fake-store tests alone
   do not establish these runtime guarantees.
3. Configure `MCP_OAUTH_ENABLED=true` on an approved QA target with an HTTPS
   `HUB_URL` origin. Redis must support GETDEL (6.2+). Restart using the committed
   deployment controller and verify discovery, sign-in, MFA and consent routing.
4. Connect a disposable QA workspace from ChatGPT using OAuth. Confirm actual
   account/client capability, list projects, deny writes, revoke the connection,
   and confirm subsequent tool use fails. Obtain action-time confirmation before
   granting the external ChatGPT app access through its consent UI.
5. Enable production only after that evidence is retained. Disable the flag and
   revoke OAuth connection rows to withdraw the feature; ordinary API-key access
   remains separately controlled.

Reference: https://developers.openai.com/plugins/build/auth

Current local evidence: 25 targeted backend tests, 11 focused frontend tests,
seven API access-matrix tests, frontend build, lint and type checks. These are
implementation evidence; real ChatGPT linking is pending.
