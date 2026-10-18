# Security Audit Checklist - Agency Hub

> **Historical checklist, not a current certification.** Checked boxes record earlier implementation work and do not prove present production clearance. Current security/release evidence is linked from [docs/product-status.md](docs/product-status.md), [docs/release-gates.md](docs/release-gates.md), and the open security/external-gate issues.

## ✅ COMPLETED FIXES

### 🔐 Authentication & Password Security
- [x] **CRITICAL:** Replaced SHA-256 with bcrypt for password hashing (12 rounds)
- [x] **HIGH:** Implemented rate limiting on login endpoint (5 attempts per 15 minutes)
- [x] **HIGH:** Added constant-time password comparison to prevent timing attacks
- [x] **MEDIUM:** Normalized email addresses (lowercase, trim)
- [x] **MEDIUM:** Added password complexity requirements (minimum 8 characters)
- [x] **HIGH:** Generic error messages to prevent user enumeration
- [x] **MEDIUM:** Added random delay on failed login attempts

### 🛡️ Session Security
- [x] **CRITICAL:** Enhanced cookie security settings
  - httpOnly: true
  - secure: true (production only)
  - sameSite: 'strict'
  - domain: '.ashbi.ca' (production only)
- [x] **HIGH:** Removed JWT token from response body (cookie-only)
- [x] **MEDIUM:** Added proper logout cookie clearing

### 🚫 CSRF Protection
- [x] **CRITICAL:** CSRF protection enabled with @fastify/csrf-protection
- [x] **HIGH:** CSRF tokens in cookies with proper settings

### 🔒 Security Headers
- [x] **CRITICAL:** CSP is registered through `@fastify/helmet`
  - Scripts: self only; inline script attributes and `unsafe-eval` denied
  - Styles: self + Google Fonts; `unsafe-inline` is temporarily required by existing React inline style attributes
  - Frames and objects denied; mixed content upgraded in production
- [x] **HIGH:** Helmet response headers are enabled and covered by effective-response tests
- [x] **MEDIUM:** Frame, MIME, referrer, transport, cross-origin, and permissions policies are configured
- [ ] **VERIFY IN STAGING:** review CSP reports and portal/auth/upload browser smoke before closing #140

### 👑 Admin Access Control
- [x] **CRITICAL:** Admin-only endpoints protected with adminOnly middleware
- [x] **HIGH:** User management endpoints (deactivate, role changes) admin-only
- [x] **HIGH:** Prevent admins from demoting/deactivating themselves
- [x] **MEDIUM:** Admin user audit endpoints created

### 🧹 Code Cleanup
- [x] **HIGH:** Removed demo credentials from frontend
- [x] **MEDIUM:** Production-ready login page messaging
- [x] **LOW:** Removed test account hints and placeholders

### 📦 Dependencies
- [x] **HIGH:** Added bcrypt for secure password hashing
- [x] **MEDIUM:** Added @fastify/helmet for security headers
- [x] **MEDIUM:** Added @fastify/csrf-protection for CSRF protection
- [x] **MEDIUM:** Added @fastify/rate-limit for brute force protection

## 🔍 VERIFICATION REQUIRED

### Database Audit
> **NOTE (audit 2026-07-09):** the script referenced below is in
> `scripts/_legacy/` and is not part of the CI gate. It was moved
> there when the audit confirmed it's invoked from no workflow and no
> package.json script. Use it for manual one-off checks only. The
> **env placeholder check** in `src/config/env.js` and the
> **enterprise-compliance.yml** workflow are the actual gates.

Run the security audit script to verify:
```bash
node scripts/_legacy/security-audit.js
```

Expected results:
- ✅ Only cameron@ashbi.ca and bianca@ashbi.ca should have ADMIN role
- ✅ No test/demo accounts should exist
- ✅ All accounts should be legitimate

If issues found, run with --fix:
```bash
node scripts/_legacy/security-audit.js --fix
```

## 🚀 DEPLOYMENT CHECKLIST

### Environment Variables
Ensure these are set in production:
- [x] `JWT_SECRET` - Strong random secret (not dev-secret-change-in-production)
- [x] `NODE_ENV=production`
- [x] `DATABASE_URL` - Production database
- [x] `ANTHROPIC_API_KEY` - Production API key
- [x] `WEBHOOK_SECRET` - Strong webhook secret

### SSL/TLS
- [ ] **CRITICAL:** HTTPS enforced in production
- [ ] **HIGH:** Valid SSL certificate
- [ ] **MEDIUM:** HTTP redirects to HTTPS

### Database Security
- [ ] **CRITICAL:** Database accessible only from application server
- [ ] **HIGH:** Database credentials rotated from defaults
- [ ] **MEDIUM:** Database backup encryption enabled

### Infrastructure
- [ ] **HIGH:** Server firewall configured (only necessary ports open)
- [ ] **MEDIUM:** Fail2ban or similar intrusion prevention
- [ ] **MEDIUM:** Log monitoring and alerting

## 📊 SECURITY METRICS

### Pre-Audit Issues Found:
- ❌ SHA-256 password hashing (weak)
- ❌ No rate limiting on login
- ❌ Demo credentials in frontend
- ❌ Insufficient cookie security
- ❌ Missing CSRF protection
- ❌ No security headers
- ❌ Information disclosure in auth errors
- ❌ No admin access audit

### Post-Audit Status:
- ✅ All critical and high-priority issues resolved
- ✅ Production-ready authentication system
- ✅ Proper session management
- ✅ CSRF and XSS protection
- ✅ Admin access controls
- ✅ Security monitoring tools

## 🎯 PRODUCTION READINESS: ✅ READY

The Agency Hub authentication system is now production-ready with enterprise-grade security:

1. **Strong Authentication:** bcrypt hashing, rate limiting, proper error handling
2. **Session Security:** Secure cookies, CSRF protection, proper logout
3. **Access Control:** Admin-only endpoints, user management, audit tools
4. **Attack Prevention:** XSS, CSRF, timing attack, and brute force protection
5. **Monitoring:** Security audit scripts, user access tracking

## 📋 ONGOING MAINTENANCE

### Monthly Tasks:
- [ ] Run security audit script
- [ ] Review admin user list
- [ ] Check for inactive accounts
- [ ] Update dependencies

### Quarterly Tasks:
- [ ] Password policy review
- [ ] Security header review
- [ ] Access log analysis
- [ ] Penetration testing

## 🚨 INCIDENT RESPONSE

If security breach suspected:
1. Run: `node scripts/_legacy/security-audit.js`
2. Check logs for suspicious activity
3. Review admin user list
4. Rotate JWT_SECRET if needed
5. Force password resets if required

---

**Security Contact:** cameron@ashbi.ca  
**Last Audit:** March 20, 2026  
**Next Review:** April 20, 2026
