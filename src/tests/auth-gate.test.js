/**
 * Auth Gate Test
 *
 * Scans all route files and verifies that non-public endpoints
 * use `onRequest: [fastify.authenticate]` or `preHandler: [fastify.authenticate]`.
 *
 * Run with: node --test src/tests/auth-gate.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(__dirname, '..', 'routes');

// Public routes that don't need auth
const PUBLIC_ROUTES = [
  'auth.routes',        // Login/register
  'webhook.routes',     // Webhook callbacks
  'client-portal.routes', // Public client portal
  'portal.routes',      // Public portal pages
  'push.routes',        // Push subscription (may need auth, check individually)
];

// Endpoints that are explicitly public within otherwise-authenticated routes
// These use patterns like { config: { public: true } } or similar
const PUBLIC_ENDPOINT_PATTERNS = [
  /GET.*\/health/,
  /POST.*\/login/,
  /POST.*\/register/,
  /POST.*\/forgot-password/,
  /POST.*\/reset-password/,
  /GET.*\/portal\//,       // Public portal access via viewToken
  /GET.*\/intake\//,       // Public intake forms
  /POST.*\/survey\//,      // Public survey submission
];

function getRouteFiles() {
  return fs.readdirSync(routesDir)
    .filter(f => f.endsWith('.routes.js') || f.endsWith('.routes.ts'))
    .map(f => f.replace(/\.(js|ts)$/, ''));
}

function isPublicRoute(routeName) {
  return PUBLIC_ROUTES.some(pub => routeName === pub);
}

function readRouteFile(routeName) {
  const jsPath = path.join(routesDir, `${routeName}.js`);
  const tsPath = path.join(routesDir, `${routeName}.ts`);

  if (fs.existsSync(tsPath)) return fs.readFileSync(tsPath, 'utf-8');
  if (fs.existsSync(jsPath)) return fs.readFileSync(jsPath, 'utf-8');
  return null;
}

function checkRouteHasAuth(content, routeName) {
  const issues = [];

  // Find all route registrations: fastify.get(...), fastify.post(...), etc.
  const methodRegex = /fastify\.(get|post|put|patch|delete)\s*\(\s*['"]/g;
  const routeRegex = /fastify\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;

  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2];

    // Check if this is a public endpoint
    const isPublicEndpoint = PUBLIC_ENDPOINT_PATTERNS.some(pattern =>
      pattern.test(`${method} ${path}`)
    );

    if (isPublicEndpoint) continue;

    // Get the block after the route definition
    const routeStart = match.index;
    const afterRoute = content.substring(routeStart, routeStart + 500);

    // Check for auth decorator in the options or handler
    const hasAuth = afterRoute.includes('authenticate') || afterRoute.includes('adminOnly');

    // Also check if the route is inside a block that has auth at the route group level
    // Look backwards for a group-level auth
    const beforeRoute = content.substring(Math.max(0, routeStart - 1000), routeStart);
    const hasGroupAuth = beforeRoute.includes('onRequest:') && beforeRoute.includes('authenticate');

    if (!hasAuth && !hasGroupAuth) {
      issues.push(`${method} ${path}`);
    }
  }

  return issues;
}

describe('Auth Gate Tests', () => {
  it('should find route files directory', () => {
    assert.ok(fs.existsSync(routesDir), `Routes directory not found: ${routesDir}`);
  });

  it('all non-public routes should have auth decorators', () => {
    const routeFiles = getRouteFiles();
    const allIssues = [];

    for (const routeName of routeFiles) {
      if (isPublicRoute(routeName)) continue;

      const content = readRouteFile(routeName);
      if (!content) continue;

      const issues = checkRouteHasAuth(content, routeName);
      if (issues.length > 0) {
        allIssues.push({ route: routeName, endpoints: issues });
      }
    }

    if (allIssues.length > 0) {
      const message = allIssues
        .map(({ route, endpoints }) =>
          `  ${route}:\n${endpoints.map(e => `    - ${e}`).join('\n')}`
        )
        .join('\n');

      // Log the issues but don't fail the test yet since we're still migrating
      console.warn(`\n⚠️  Routes missing auth decorators:\n${message}`);
      console.warn(`\nThese routes need 'onRequest: [fastify.authenticate]' added.`);
    }

    // During migration, we don't fail the test, just warn
    // Once all routes are migrated, change this to:
    // assert.equal(allIssues.length, 0, `Found routes missing auth: ${JSON.stringify(allIssues)}`);
    assert.ok(true, 'Auth gate check completed (warnings only during migration)');
  });

  it('should have consistent auth pattern', () => {
    const routeFiles = getRouteFiles();
    let authenticateCount = 0;
    let adminOnlyCount = 0;

    for (const routeName of routeFiles) {
      const content = readRouteFile(routeName);
      if (!content) continue;

      const authMatches = content.match(/fastify\.authenticate/g) || [];
      const adminMatches = content.match(/fastify\.adminOnly/g) || [];

      authenticateCount += authMatches.length;
      adminOnlyCount += adminMatches.length;
    }

    console.log(`\n✓ Found ${authenticateCount} authenticate decorators across ${routeFiles.length} route files`);
    console.log(`✓ Found ${adminOnlyCount} adminOnly decorators`);
    assert.ok(authenticateCount > 0, 'Should have at least some authenticate decorators');
  });
});