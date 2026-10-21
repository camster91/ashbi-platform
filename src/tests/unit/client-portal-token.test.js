/**
 * Client Portal Token-in-URL Test
 *
 * Validates that the client portal auth middleware no longer accepts
 * JWT tokens via URL query string (which leaks tokens in browser history,
 * proxy logs, and Referer headers).
 *
 * Issue #3: JWT tokens in URLs are a security risk.
 *
 * Run with: node --test src/tests/client-portal-token.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPortalPath = path.join(__dirname, '..', '..', 'routes', 'client-portal.routes.js');
const portalPath = path.join(__dirname, '..', '..', 'routes', 'portal.routes.js');

describe('Client Portal Token Security', () => {
  describe('client-portal.routes.js', () => {
    it('should not accept JWT tokens from query string for authenticated endpoints', () => {
      if (!fs.existsSync(clientPortalPath)) {
        console.log('  ⚠ client-portal.routes.js not found, skipping');
        return;
      }

      const content = fs.readFileSync(clientPortalPath, 'utf-8');

      // Check if request.query.token is used for JWT auth
      // This is the dangerous pattern that should be removed
      const queryTokenUsage = content.match(/request\.query\?\.token/g) || [];

      if (queryTokenUsage.length > 0) {
        console.warn(`\n⚠️  client-portal.routes.js accepts JWT tokens in URL query string (${queryTokenUsage.length} occurrences)`);
        console.warn('   JWT tokens in URLs leak to browser history, proxy logs, and Referer headers');
        console.warn('   Recommend: Require tokens in cookies or Authorization header only');
      }

      // The portal reads session tokens only from the cookie or the
      // Authorization header; a query-string token would leak via history,
      // proxy logs and Referer headers.
      assert.equal(queryTokenUsage.length, 0, 'client-portal.routes.js must not read request.query?.token');
    });

    it('should use httpOnly cookies for auth tokens', () => {
      if (!fs.existsSync(clientPortalPath)) {
        return;
      }

      const content = fs.readFileSync(clientPortalPath, 'utf-8');

      // Verify that cookies are used (httpOnly, secure, sameSite)
      const cookieSet = content.match(/\.cookie\s*\(|setCookie|reply\.cookie/g) || [];

      if (cookieSet.length > 0) {
        console.log(`  ✓ Found ${cookieSet.length} cookie operations (prefer httpOnly+secure+sameSite)`);
      }

      // Check for httpOnly flag
      const httpOnly = content.match(/httpOnly\s*:\s*true/g) || [];
      const secure = content.match(/secure\s*:\s*true/g) || [];
      const sameSite = content.match(/sameSite/g) || [];

      console.log(`  Cookie security: httpOnly=${httpOnly.length}, secure=${secure.length}, sameSite=${sameSite.length}`);

      assert.ok(httpOnly.length > 0, 'Should set httpOnly: true on auth cookies');
    });
  });

  describe('portal.routes.js', () => {
    it('uses viewToken in URL params (not query string) — this is acceptable', () => {
      if (!fs.existsSync(portalPath)) {
        return;
      }

      const content = fs.readFileSync(portalPath, 'utf-8');

      // Portal uses params.token or params.viewToken or params.signToken (often destructured)
      const paramTokenUsage = content.match(/request\.params\.(token|viewToken|signToken)|const\s+\{\s*(token|viewToken|signToken)\s*\}\s*=\s*request\.params/g) || [];

      console.log(`  âœ“ portal.routes.js: ${paramTokenUsage.length} param-based tokens (acceptable - not JWTs)`);

      assert.ok(paramTokenUsage.length > 0, 'Portal should use param-based viewTokens');
    });
  });
});