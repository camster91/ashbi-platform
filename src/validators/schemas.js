// Shared Zod validation schemas for Fastify route input validation
// Usage: import { schemas } from '../validators/schemas.js';

import { z } from 'zod';

// ── Reusable field validators ──────────────────────────────────────────────
const email = z.string().email().max(255);
const password = z.string().min(8).max(128);
const userName = z.string().min(1).max(100);
const uuid = z.string().uuid();
const cuidId = z.string().min(1).max(50); // accepts cuid2, uuid, etc.
const url = z.string().url().max(2048);

// Allowlisted file extensions (prevents path traversal / XSS via stored extensions)
const ALLOWED_UPLOAD_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx', '.txt', '.csv',
  '.zip', '.mp4', '.mp3', '.wav'
];

const ALLOWED_UPLOAD_MIMETYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip',
  'video/mp4',
  'audio/mpeg', 'audio/wav',
];

// ── Auth schemas ───────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: email,
  password: z.string().min(1), // don't reveal minLength on login
});

export const registerSchema = z.object({
  email: email,
  password: password,
  name: userName,
  role: z.enum(['ADMIN', 'TEAM', 'CLIENT']).optional().default('TEAM'),
  adminInviteToken: z.string().optional(), // required when DB has users
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const forgotPasswordSchema = z.object({
  email: email,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: password,
});

export const clientSignupSchema = z.object({
  token: z.string().min(1),
  email: email,
  password: password,
});

export const clientLoginSchema = z.object({
  email: email,
  password: z.string().min(1),
});

export const inviteClientSchema = z.object({
  email: email,
});

// ── Project schemas ────────────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  clientId: cuidId,
  defaultOwnerId: cuidId.optional(),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'DRAFT']).optional(),
  health: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'CRITICAL']).optional(),
  hourlyBudget: z.number().positive().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'DRAFT']).optional(),
  health: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'CRITICAL']).optional(),
  clientId: cuidId.optional(),
  hourlyBudget: z.number().positive().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
}).refine(val => Object.keys(val).length > 0, { message: 'At least one field must be provided' });

// ── Task schemas ───────────────────────────────────────────────────────────
export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']).optional().default('NORMAL'),
  status: z.enum(['PENDING', 'UPCOMING', 'IMMEDIATE', 'IN_PROGRESS', 'BLOCKED', 'WAITING_US', 'WAITING_CLIENT', 'COMPLETED']).optional().default('PENDING'),
  category: z.string().max(50).optional(),
  projectId: cuidId,
  assigneeId: cuidId.optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: cuidId.optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  milestoneId: cuidId.optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']).optional(),
  status: z.enum(['PENDING', 'UPCOMING', 'IMMEDIATE', 'IN_PROGRESS', 'BLOCKED', 'WAITING_US', 'WAITING_CLIENT', 'COMPLETED']).optional(),
  category: z.string().max(50).optional(),
  assigneeId: cuidId.nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: cuidId.nullable().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  milestoneId: cuidId.nullable().optional(),
});

// ── Client schemas ─────────────────────────────────────────────────────────
export const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PROSPECT']).optional().default('ACTIVE'),
});

export const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PROSPECT']).optional(),
});

// ── Invoice schemas ───────────────────────────────────────────────────────
export const createInvoiceSchema = z.object({
  clientId: cuidId,
  projectId: cuidId.optional(),
  title: z.string().min(1).max(200),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime(),
  currency: z.enum(['CAD', 'USD']).optional().default('CAD'),
  taxRate: z.number().min(0).max(50).optional().default(13),
  discountAmount: z.number().min(0).optional().default(0),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1).max(500),
    itemType: z.enum(['LABOR', 'MATERIAL', 'EXPENSE', 'DISCOUNT', 'OTHER']).optional().default('LABOR'),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    total: z.number().nonnegative(),
    position: z.number().int().optional(),
  })).min(1),
});

// ── Expense schemas ────────────────────────────────────────────────────────
export const createExpenseSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  date: z.string().datetime(),
  category: z.string().min(1).max(50),
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
  notes: z.string().max(2000).optional(),
});

// ── Invoice update schema ─────────────────────────────────────────────────
export const updateInvoiceSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'PAID', 'VOID']).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  currency: z.enum(['CAD', 'USD']).optional(),
  taxRate: z.number().min(0).max(50).optional(),
  discountAmount: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
}).refine(val => Object.keys(val).length > 0, { message: 'At least one field must be provided' });

// ── Mark invoice paid ──────────────────────────────────────────────────────
export const markInvoicePaidSchema = z.object({
  amount: z.number().positive().optional(),
  method: z.enum(['STRIPE', 'TRANSFER', 'CASH', 'CHEQUE', 'OTHER']).optional(),
  paidAt: z.string().datetime().optional(),
});

// ── Send invoice ──────────────────────────────────────────────────────────
export const sendInvoiceSchema = z.object({
  email: email.optional(),
  message: z.string().max(2000).optional(),
});

// ── Portal schemas ─────────────────────────────────────────────────────────
export const bookingSchema = z.object({
  name: z.string().min(1).max(100),
  email: email,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  phone: z.string().max(30).optional(),
  notes: z.string().max(1000).optional(),
});

export const contractSignSchema = z.object({
  name: z.string().min(1).max(200),
  signature: z.string().min(1).max(50000), // base64 signature data
});

export const formSubmitSchema = z.object({
  respondentName: z.string().min(1).max(200),
  respondentEmail: email,
  answers: z.record(z.string(), z.any()),
});

export const proposalDeclineSchema = z.object({
  reason: z.string().max(2000).optional(),
});

// ── Client Portal schemas ─────────────────────────────────────────────────
export const clientPortalMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  type: z.enum(['TEXT', 'IMAGE', 'FILE']).optional().default('TEXT'),
});

export const requestAccessSchema = z.object({
  email: email,
});

// ── User update schemas ───────────────────────────────────────────────────
export const updateProfileSchema = z.object({
  name: userName.optional(),
  skills: z.array(z.string().max(50)).max(20).optional(),
  capacity: z.number().int().min(1).max(168).optional(), // hours per week
});

// ── Approval schemas ──────────────────────────────────────────────────────
export const patchApprovalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(2000).optional(),
});

// ── File upload validation helper ──────────────────────────────────────────
export function validateUploadedFile(filename, mimetype) {
  const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '';

  // Reject double extensions (e.g., file.html.png)
  const parts = filename.split('.');
  if (parts.length > 2) {
    return { valid: false, error: 'Double extensions are not allowed' };
  }

  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File extension "${ext}" is not allowed. Allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}` };
  }

  if (!ALLOWED_UPLOAD_MIMETYPES.includes(mimetype)) {
    return { valid: false, error: `MIME type "${mimetype}" is not allowed.` };
  }

  // SVG is dangerous when served inline — require special handling
  if (ext === '.svg' && mimetype === 'image/svg+xml') {
    return { valid: true, warning: 'SVG files must be served with Content-Disposition: attachment', ext, mimetype };
  }

  return { valid: true, ext, mimetype };
}

// ── Helper: convert Zod schema to Fastify JSON Schema ──────────────────────
// This allows using Zod schemas with Fastify's built-in validation
export function zodToJsonSchema(zodSchema) {
  return zodSchema._def;
  // For full conversion, use `zod-to-json-schema` package.
  // We'll use Zod programmatically instead for Fastify routes.
}

// ── Helper: validate with Zod and return { data, error } ──────────────────
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) {
    return { data: result.data, error: null };
  }
  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
  return { data: null, error: errors.join('; ') };
}

// ── Helper: Fastify preValidation hook from Zod schema ─────────────────────
// Usage: { preHandler: [fastify.authenticate, validateBody(createProjectSchema)] }
export function validateBody(schema) {
  return async (request, reply) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return reply.status(400).send({ error: errors.join('; ') });
    }
    // Replace request.body with parsed/trimmed data
    request.body = result.data;
  };
}

export function validateParams(schema) {
  return async (request, reply) => {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return reply.status(400).send({ error: errors.join('; ') });
    }
    request.params = result.data;
  };
}

export function validateQuery(schema) {
  return async (request, reply) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return reply.status(400).send({ error: errors.join('; ') });
    }
    request.query = result.data;
  };
}

export const schemas = {
  login: loginSchema,
  register: registerSchema,
  changePassword: changePasswordSchema,
  forgotPassword: forgotPasswordSchema,
  resetPassword: resetPasswordSchema,
  clientSignup: clientSignupSchema,
  clientLogin: clientLoginSchema,
  inviteClient: inviteClientSchema,
  createProject: createProjectSchema,
  updateProject: updateProjectSchema,
  createTask: createTaskSchema,
  updateTask: updateTaskSchema,
  createClient: createClientSchema,
  updateClient: updateClientSchema,
  createInvoice: createInvoiceSchema,
  updateInvoice: updateInvoiceSchema,
  markInvoicePaid: markInvoicePaidSchema,
  sendInvoice: sendInvoiceSchema,
  createExpense: createExpenseSchema,
  booking: bookingSchema,
  contractSign: contractSignSchema,
  formSubmit: formSubmitSchema,
  proposalDecline: proposalDeclineSchema,
  clientPortalMessage: clientPortalMessageSchema,
  requestAccess: requestAccessSchema,
  updateProfile: updateProfileSchema,
  patchApproval: patchApprovalSchema,
};

export const fileUpload = {
  validate: validateUploadedFile,
  ALLOWED_EXTENSIONS: ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_MIMETYPES: ALLOWED_UPLOAD_MIMETYPES,
  MAX_SIZE: 50 * 1024 * 1024, // 50MB
};