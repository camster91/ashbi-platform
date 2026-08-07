# Session expiry, revocation, and password-hash audit

Authenticated user sessions expire after `JWT_EXPIRES_IN` (seven days by
default). Every user token also carries the user's `sessionVersion`; HTTP and
Socket.IO authentication compare it with the current database value. Logout,
password change, password reset, account deactivation, and the legacy-account
reset procedure therefore invalidate older sessions.

Run the sanitized production audit from an environment with production database
access:

```sh
npm run audit:password-hashes
```

The command reports counts only and exits with status 2 when it finds a legacy
hash. It never prints user identifiers, email addresses, or password material.
After confirming the account-recovery path, reset every legacy account and
revoke its sessions:

```sh
npm run audit:password-hashes -- --reset-legacy
npm run audit:password-hashes
```

The final audit must report `legacyAccounts: 0`. Users whose legacy credentials
were reset need the normal password-recovery flow before their next login.
