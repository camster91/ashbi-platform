# Production Deployment Checklist

> **Superseded deployment document.** GitHub-secret rendering and Coolify promotion below are historical and must not be used. The only current production path is [docs/deployment-and-rollback.md](docs/deployment-and-rollback.md), with [docs/backup-and-restore.md](docs/backup-and-restore.md) for recoverability. Retained for audit history.

## Environment Variable Strategy (audit 2026-07-10)

All **sensitive** values live in GH secrets, not in `.env` on the VPS:

| GH secret | Replaces in .env |
|---|---|
| `PRODUCTION_DATABASE_URL` | `DATABASE_URL` |
| `PRODUCTION_REDIS_URL` | `REDIS_URL` |
| `PRODUCTION_JWT_SECRET` | `JWT_SECRET` |
| `PRODUCTION_WEBHOOK_SECRET` | `WEBHOOK_SECRET` |
| `PRODUCTION_CREDENTIALS_KEY` | `CREDENTIALS_KEY` |
| `PRODUCTION_BOT_SECRET` | `BOT_SECRET` |
| `PRODUCTION_MAILGUN_API_KEY` | `MAILGUN_API_KEY` |
| `PRODUCTION_MAILGUN_SIGNING_KEY` | `MAILGUN_SIGNING_KEY` |
| `PRODUCTION_STRIPE_SECRET_KEY` | `STRIPE_SECRET_KEY` |
| `PRODUCTION_STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET` |
| `PRODUCTION_KILO_API_KEY` | `KILO_API_KEY` |
| `PRODUCTION_OLLAMA_API_KEY` | `OLLAMA_API_KEY` |
| `PRODUCTION_R2_ACCESS_KEY_ID` | `R2_ACCESS_KEY_ID` |
| `PRODUCTION_R2_SECRET_ACCESS_KEY` | `R2_SECRET_ACCESS_KEY` |
| `PRODUCTION_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| `PRODUCTION_GEMINI_API_KEY` | `GEMINI_API_KEY` |

`deploy-coolify.yml` ships a "Render .env on VPS from GH secrets" step that
runs before the Coolify deploy trigger. It backs up the existing .env, writes
only the non-secret keys it preserved, then appends the new PRODUCTION_*
values, sets `chmod 600`, and restarts the local `ashbi-platform` container.
The CI gate `.github/workflows/check-secrets.yml` blocks PRs that hardcode
any of these patterns: `postgresql://user:password@host` (>= 20 char non-placeholder
password), `redis://...:password@host`, `sk_live_*` / `sk_test_*`, `AKIA*`.

## Pre-Deployment Security Checklist

### ✅ Environment Variables Setup

**Required Environment Variables:**
```bash
# Generate strong secrets (run these commands):
export JWT_SECRET=$(openssl rand -base64 32)
export CREDENTIALS_KEY=$(openssl rand -base64 32) 
export WEBHOOK_SECRET=$(openssl rand -base64 32)

# API Keys
export ANTHROPIC_API_KEY=your-anthropic-api-key
export GEMINI_API_KEY=your-gemini-api-key

# Database
export DATABASE_URL=postgresql://username:password@host:port/database

# Production settings
export NODE_ENV=production
export CORS_ORIGIN=https://hub.ashbi.ca
```

### Rotating a secret in production

1. Generate the new value (e.g. `openssl rand -base64 32`).
2. Update the underlying system if the secret authenticates to a live
   service — e.g. for `DATABASE_URL`:
   ```bash
   NEW_PW=$(openssl rand -base64 36 | tr -d '=+/' | cut -c1-48)
   docker exec ashbi-hub-postgres psql -U ashbihub -d ashbihub \
     -c "ALTER USER ashbihub PASSWORD '${NEW_PW}';"
   NEW_URL="postgresql://ashbihub:${NEW_PW}@ashbi-hub-postgres:5432/ashbihub"
   echo "$NEW_URL" | gh secret set PRODUCTION_DATABASE_URL --repo camster91/ashbi-platform
   ```
3. Trigger a deploy — `deploy-coolify.yml` will write the new value to
   `/opt/ashbi-platform/.env` (chmod 600) and restart the container.
4. Verify the new value is in use: `curl https://hub.ashbi.ca/api/health`
   and check `docker logs ashbi-platform` for `AuthenticationFailed` (which
   would mean a downstream container is still using the old password).
5. If rotating a service-token secret (Stripe, Mailgun, etc.), also update
   the upstream dashboard at the same time as the GH secret — order matters
   because the deploy window is when clients are briefly 401'd.

### ✅ Database Migration

**For existing installations with SHA256 passwords:**
```sql
-- Run this migration to update existing user passwords
-- Note: Users will need to reset their passwords after this migration
UPDATE users SET password = '' WHERE password LIKE '%' AND LENGTH(password) = 64;
```

**Then run the seed script:**
```bash
npm run db:seed
```

### ✅ Dependencies Installation

```bash
# Install new security dependencies
npm install bcrypt @fastify/helmet @fastify/csrf-protection

# Build the application
npm run build
```

### ✅ Security Verification

1. **Run security check (optional, manual):**
   ```bash
   # NOTE (audit 2026-07-09): these scripts are not part of the CI
   # gate. Use them for one-off checks; don't rely on them to fail
   # a deploy — the env placeholder check in src/config/env.js IS
   # the deploy-blocking gate.
   node scripts/_legacy/security-check.js
   ```

2. **Verify no demo credentials in production:**
   - Login page should not show demo credentials
   - Default passwords should be changed

3. **Test authentication:**
   - Test login with cameron@ashbi.ca
   - Test login with bianca@ashbi.ca  
   - Verify both have ADMIN role

### ✅ First Time Setup

1. **Initial deployment:**
   ```bash
   # Build and start
   npm run build
   npm start
   ```

2. **Change default passwords immediately:**
   - Do not use a shared or documented default password.
   - Provision each approved user through the current account-recovery or invitation flow.
   - Treat any historical default password as compromised and rotate affected credentials before access is enabled.

3. **Verify security headers:**
   ```bash
   curl -I https://hub.ashbi.ca
   # Must include CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff,
   # Referrer-Policy, Strict-Transport-Security, Cross-Origin-Opener-Policy,
   # Cross-Origin-Resource-Policy, and Permissions-Policy.
   ```
   See `docs/security-headers.md` for the approved policy and staged checks.

### ✅ Post-Deployment Verification

1. **Test authentication flows:**
   - [ ] Login works with new passwords
   - [ ] Logout clears session properly  
   - [ ] Invalid credentials are rejected
   - [ ] Session expires correctly

2. **Test CSRF protection:**
   - [ ] API calls require CSRF token
   - [ ] Cross-site requests are blocked

3. **Verify user roles:**
   - [ ] cameron@ashbi.ca has ADMIN role
   - [ ] bianca@ashbi.ca has ADMIN role
   - [ ] No other ADMIN users exist

## Security Features Implemented

### ✅ Password Security
- **bcrypt hashing** with 12 salt rounds
- **Password strength validation** (minimum 6 characters)
- **Secure password change flow**

### ✅ Session Security
- **HttpOnly cookies** (prevents XSS access)
- **Secure flag** (HTTPS only in production)
- **SameSite=strict** (prevents CSRF)
- **7-day expiration** with proper cleanup

### ✅ CSRF Protection
- **Anti-CSRF tokens** on all state-changing requests
- **Double-submit cookie pattern**
- **Origin validation**

### ✅ Security Headers
- **Helmet.js** for common security headers
- **Content Security Policy** (CSP)
- **X-Frame-Options** (prevent clickjacking)
- **X-Content-Type-Options** (prevent MIME sniffing)

### ✅ Input Validation
- **Zod schemas** for request validation
- **Email format validation**
- **SQL injection protection** via Prisma

### ✅ Environment Security
- **Production secret validation**
- **Default secret detection**
- **Required environment variable checks**

## Monitoring & Maintenance

### Daily Checks
- [ ] Monitor authentication logs for unusual activity
- [ ] Check for failed login attempts
- [ ] Verify backup systems are working

### Weekly Checks  
- [ ] Review user access and roles
- [ ] Check for security updates
- [ ] Monitor error logs

### Monthly Checks
- [ ] Security dependency updates
- [ ] Password policy review
- [ ] Access audit

## Emergency Procedures

### Suspected Security Breach
1. **Immediate actions:**
   ```bash
   # Revoke all sessions (restart the server)
   pm2 restart agency-hub
   
   # Check logs for suspicious activity
   tail -f logs/access.log | grep -E "(401|403|429)"
   ```

2. **Change secrets:**
   ```bash
   # Generate new secrets
   export JWT_SECRET=$(openssl rand -base64 32)
   # Restart application
   ```

3. **Force password resets** for all users if needed

### Contact Information
- **Tech Lead:** Cameron (cameron@ashbi.ca)
- **Deployment:** GitHub Actions + VPS
- **Infrastructure:** Coolify on VPS

---

## ✅ Ready for Production

All security measures have been implemented and tested. The application is ready for production deployment with:

- ✅ Strong password hashing (bcrypt)
- ✅ Secure session management  
- ✅ CSRF protection
- ✅ Security headers
- ✅ Input validation
- ✅ Environment security
- ✅ Demo credentials removed
- ✅ User roles verified

**Last Updated:** March 20, 2026
**Security Audit:** PASSED ✅
