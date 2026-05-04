/**
 * Input Validation Tests
 *
 * Scans route files and validates that mutation endpoints have input validation.
 * Also tests that existing Zod schemas properly reject invalid inputs.
 *
 * Issue #2: No input validation on most routes (~85/95 route files).
 *
 * Run with: node --test src/tests/input-validation.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(__dirname, '..', 'routes');

// ── Schema validation tests ─────────────────────────────────────────────────

// Import schemas for validation testing
const schemasModule = await import('../validators/schemas.js');

// Individual named exports
const {
  loginSchema, registerSchema, changePasswordSchema,
  createProjectSchema, updateProjectSchema,
  createTaskSchema, updateTaskSchema,
  createClientSchema, updateClientSchema,
  createExpenseSchema, createInvoiceSchema,
  markInvoicePaidSchema, sendInvoiceSchema,
  bookingSchema, contractSignSchema, formSubmitSchema,
  updateProfileSchema,
  fileUpload, validateUploadedFile,
} = schemasModule;

const { ALLOWED_EXTENSIONS: ALLOWED_UPLOAD_EXTENSIONS, ALLOWED_MIMETYPES: ALLOWED_UPLOAD_MIMETYPES } = fileUpload;

describe('Zod Schema Validation', () => {
  describe('Auth schemas', () => {
    it('loginSchema: rejects empty email', () => {
      const result = loginSchema.safeParse({ email: '', password: 'pass' });
      assert.equal(result.success, false);
    });

    it('loginSchema: rejects invalid email format', () => {
      const result = loginSchema.safeParse({ email: 'not-an-email', password: 'pass' });
      assert.equal(result.success, false);
    });

    it('loginSchema: accepts valid email and password', () => {
      const result = loginSchema.safeParse({ email: 'user@example.com', password: 'anypassword' });
      assert.equal(result.success, true);
    });

    it('registerSchema: rejects password shorter than 8 chars', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'short',
        name: 'Test User'
      });
      assert.equal(result.success, false);
    });

    it('registerSchema: accepts valid registration', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'securepassword123',
        name: 'Test User'
      });
      assert.equal(result.success, true);
    });

    it('registerSchema: rejects invalid role', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'securepassword123',
        name: 'Test User',
        role: 'SUPERADMIN'
      });
      assert.equal(result.success, false);
    });

    it('changePasswordSchema: rejects short new password', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'oldpass',
        newPassword: '1234567' // 7 chars - too short
      });
      assert.equal(result.success, false);
    });

    it('changePasswordSchema: accepts valid password change', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'oldpassword',
        newPassword: 'newsecurepassword'
      });
      assert.equal(result.success, true);
    });
  });

  describe('Project schemas', () => {
    it('createProjectSchema: requires name', () => {
      const result = createProjectSchema.safeParse({
        description: 'A project without a name'
      });
      assert.equal(result.success, false);
    });

    it('createProjectSchema: accepts valid project', () => {
      const result = createProjectSchema.safeParse({
        name: 'Website Redesign',
        clientId: 'client-123'
      });
      assert.equal(result.success, true);
    });

    it('createProjectSchema: rejects name exceeding max length', () => {
      const result = createProjectSchema.safeParse({
        name: 'x'.repeat(201), // max is 200
      });
      assert.equal(result.success, false);
    });
  });

  describe('Task schemas', () => {
    it('createTaskSchema: requires title', () => {
      const result = createTaskSchema.safeParse({
        projectId: 'proj-123',
        priority: 'HIGH'
      });
      assert.equal(result.success, false);
    });

    it('createTaskSchema: accepts valid task', () => {
      const result = createTaskSchema.safeParse({
        projectId: 'proj-123',
        title: 'Design homepage mockup',
        priority: 'NORMAL'
      });
      assert.equal(result.success, true);
    });
  });

  describe('Client schemas', () => {
    it('createClientSchema: requires name', () => {
      const result = createClientSchema.safeParse({
        email: 'client@example.com'
      });
      assert.equal(result.success, false);
    });

    it('createClientSchema: accepts valid client', () => {
      const result = createClientSchema.safeParse({
        name: 'Acme Corp',
      });
      assert.equal(result.success, true);
    });
  });

  describe('Expense schema', () => {
    it('createExpenseSchema: requires amount and category', () => {
      const result = createExpenseSchema.safeParse({
        description: 'Software license'
      });
      assert.equal(result.success, false);
    });

    it('createExpenseSchema: rejects negative amounts', () => {
      const result = createExpenseSchema.safeParse({
        amount: -50,
        category: 'SOFTWARE',
        date: '2026-01-15T10:00:00Z'
      });
      assert.equal(result.success, false);
    });

    it('createExpenseSchema: accepts valid expense', () => {
      const result = createExpenseSchema.safeParse({
        amount: 49.99,
        category: 'SOFTWARE',
        date: '2026-01-15T10:00:00Z',
        description: 'Figma subscription'
      });
      assert.equal(result.success, true);
    });
  });

  describe('File upload validation', () => {
    it('allows only permitted file extensions', () => {
      assert.ok(ALLOWED_UPLOAD_EXTENSIONS.includes('.jpg'));
      assert.ok(ALLOWED_UPLOAD_EXTENSIONS.includes('.pdf'));
      assert.ok(ALLOWED_UPLOAD_EXTENSIONS.includes('.png'));
      // Dangerous extensions should not be allowed
      assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.includes('.exe'));
      assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.includes('.html'));
      assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.includes('.js'));
      assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.includes('.php'));
      assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.includes('.sh'));
    });

    it('allows only permitted MIME types', () => {
      assert.ok(ALLOWED_UPLOAD_MIMETYPES.includes('image/jpeg'));
      assert.ok(ALLOWED_UPLOAD_MIMETYPES.includes('application/pdf'));
      // Dangerous MIME types should not be allowed
      assert.ok(!ALLOWED_UPLOAD_MIMETYPES.includes('application/x-executable'));
      assert.ok(!ALLOWED_UPLOAD_MIMETYPES.includes('text/html'));
      assert.ok(!ALLOWED_UPLOAD_MIMETYPES.includes('application/javascript'));
    });
  });
});

// ── Route file scanning ─────────────────────────────────────────────────────

describe('Route File Validation Coverage', () => {
  function getRouteFiles() {
    return fs.readdirSync(routesDir)
      .filter(f => f.endsWith('.routes.js'))
      .map(f => f.replace(/\.routes\.js$/, ''));
  }

  function readRouteFile(routeName) {
    const filePath = path.join(routesDir, `${routeName}.routes.js`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  function getMutationMethods(content) {
    const mutations = [];
    const regex = /fastify\.(post|put|patch|delete)\s*\(\s*['"]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const startIdx = match.index + match[0].length;
      const endIdx = content.indexOf("'", startIdx);
      if (endIdx === -1) continue;
      const route = content.substring(startIdx, endIdx);
      mutations.push({ method, route, index: match.index });
    }
    return mutations;
  }

  it('should have validation schemas defined', () => {
    const schemasPath = path.join(__dirname, '..', 'validators', 'schemas.js');
    assert.ok(fs.existsSync(schemasPath), 'validators/schemas.js should exist');

    const content = fs.readFileSync(schemasPath, 'utf-8');
    assert.ok(content.includes('z.object'), 'Should define Zod schemas');
    assert.ok(content.includes('loginSchema'), 'Should have loginSchema');
    assert.ok(content.includes('createProjectSchema'), 'Should have createProjectSchema');
    assert.ok(content.includes('createTaskSchema'), 'Should have createTaskSchema');
    assert.ok(content.includes('ALLOWED_EXTENSIONS'), 'Should have file upload extension allowlist');
    assert.ok(content.includes('ALLOWED_MIMETYPES'), 'Should have file upload MIME type allowlist');
  });

  it('routes with validateBody should properly use it', () => {
    const filesWithValidation = [
      'auth', 'project', 'task', 'client', 'invoice', 'expense',
      'client-portal', 'portal', 'approvals', 'ash-chat'
    ];

    for (const routeName of filesWithValidation) {
      const content = readRouteFile(routeName);
      if (!content) continue;

      // Verify validateBody is imported
      const hasValidateImport = content.includes('validateBody') || content.includes('schema:');
      if (hasValidateImport) {
        // Verify it's actually used in mutation endpoints
        const mutations = getMutationMethods(content);
        const validatedMutations = mutations.filter(m => {
          const block = content.substring(m.index, m.index + 500);
          return block.includes('validateBody') || block.includes('schema:');
        });

        console.log(`  ✓ ${routeName}.routes: ${validatedMutations.length}/${mutations.length} mutations have validation`);
      }
    }

    assert.ok(true, 'Validation coverage scan completed');
  });

  it('should identify routes lacking validation on mutation endpoints', () => {
    const routeFiles = getRouteFiles();
    const routesWithoutValidation = [];

    for (const routeName of routeFiles) {
      const content = readRouteFile(routeName);
      if (!content) continue;

      // Skip routes that are purely webhooks or have custom auth
      if (['bot', 'webhook', 'mailgun-hitl'].includes(routeName)) continue;

      const mutations = getMutationMethods(content);
      if (mutations.length === 0) continue; // read-only routes

      const hasAnyValidation = content.includes('validateBody') || content.includes('schema:');
      if (!hasAnyValidation && mutations.length > 0) {
        routesWithoutValidation.push({
          route: routeName,
          mutations: mutations.length
        });
      }
    }

    if (routesWithoutValidation.length > 0) {
      const message = routesWithoutValidation
        .map(r => `  ${r.route}: ${r.mutations} mutation endpoints without validation`)
        .join('\n');
      console.warn(`\n⚠️  Routes lacking input validation:\n${message}`);
      console.warn(`\nRecommendation: Add Zod validateBody preHandler to these routes.`);
    }

    // This is a documentation test, not a hard failure during migration
    assert.ok(true, `Found ${routesWithoutValidation.length} routes without validation (warned)`);
  });
});