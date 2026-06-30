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

// ── Upwork Contract schemas ────────────────────────────────────────────────
export const createUpworkContractSchema = z.object({
  clientName: z.string().min(1).max(200),
  projectName: z.string().min(1).max(200),
  platform: z.enum(['UPWORK', 'DIRECT']).optional().default('UPWORK'),
  contractType: z.enum(['FIXED', 'HOURLY']).optional().default('FIXED'),
  totalBudget: z.number().nonnegative().optional().default(0),
  hourlyRate: z.number().positive().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional().default('ACTIVE'),
  currentMilestone: z.string().max(200).optional(),
  milestoneAmount: z.number().nonnegative().optional(),
  milestoneStatus: z.enum(['PENDING', 'SUBMITTED', 'APPROVED', 'OVERDUE']).optional(),
  milestoneDueDate: z.string().datetime().optional(),
  lastMessageAt: z.string().datetime().optional(),
  notes: z.string().max(5000).optional(),
  upworkUrl: z.string().url().max(2048).optional(),
});

export const updateUpworkContractSchema = z.object({
  clientName: z.string().min(1).max(200).optional(),
  projectName: z.string().min(1).max(200).optional(),
  platform: z.enum(['UPWORK', 'DIRECT']).optional(),
  contractType: z.enum(['FIXED', 'HOURLY']).optional(),
  totalBudget: z.number().nonnegative().optional(),
  hourlyRate: z.number().positive().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
  currentMilestone: z.string().max(200).optional(),
  milestoneAmount: z.number().nonnegative().optional(),
  milestoneStatus: z.enum(['PENDING', 'SUBMITTED', 'APPROVED', 'OVERDUE']).optional(),
  milestoneDueDate: z.string().datetime().nullable().optional(),
  lastMessageAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(5000).optional(),
  upworkUrl: z.string().url().max(2048).optional(),
}).refine(val => Object.keys(val).length > 0, { message: 'At least one field must be provided' });

// ── Client Health schemas ──────────────────────────────────────────────────
export const recalculateHealthSchema = z.object({
  clientId: cuidId.optional(),
});
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


// ── Contract schemas ───────────────────────────────────────────────────────
export const createContractSchema = z.object({
  clientId: cuidId,
  title: z.string().min(1).max(200),
  templateType: z.enum(['RETAINER', 'PROJECT', 'HOURLY', 'FIXED']).optional(),
  content: z.string().max(50000).optional(),
  proposalId: cuidId.optional(),
});

export const updateContractDraftSchema = z.object({
  draftData: z.string().min(1).max(50000),
});

// ── Estimate schemas ───────────────────────────────────────────────────────
const estimateLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
});

export const createEstimateSchema = z.object({
  clientId: cuidId,
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  lineItems: z.array(estimateLineItemSchema).optional().default([]),
  tax: z.number().nonnegative().optional().default(0),
  validUntil: z.string().datetime().optional(),
});

export const updateEstimateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  lineItems: z.array(estimateLineItemSchema).optional(),
  tax: z.number().nonnegative().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'DECLINED', 'EXPIRED']).optional(),
}).refine(val => Object.keys(val).length > 0, { message: 'At least one field must be provided' });

// ── Retainer schemas ───────────────────────────────────────────────────────
export const createRetainerSchema = z.object({
  clientId: cuidId,
  tier: z.enum(['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']),
  hoursPerMonth: z.number().positive(),
  monthlyAmountUsd: z.number().nonnegative().optional(),
  monthlyAmountCad: z.number().nonnegative().optional(),
});

export const updateRetainerSchema = z.object({
  tier: z.enum(['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']).optional(),
  hoursPerMonth: z.number().positive().optional(),
  monthlyAmountUsd: z.number().nonnegative().optional(),
  monthlyAmountCad: z.number().nonnegative().optional(),
  resetHours: z.boolean().optional(),
}).refine(val => Object.keys(val).length > 0, { message: 'At least one field must be provided' });

export const logRetainerHoursSchema = z.object({
  hours: z.number().positive(),
  description: z.string().max(500).optional(),
  projectId: cuidId.optional(),
});

export const generateRetainerInvoiceSchema = z.object({
  currency: z.enum(['USD', 'CAD']).optional().default('USD'),
  daysUntilDue: z.number().int().positive().optional().default(30),
  resetHours: z.boolean().optional().default(false),
});

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

// ── AI context (admin key/value store feeding AI system prompts) ───────────
export const aiContextUpsertSchema = z.object({
  // Capped at 100 chars to prevent pathologically long "context" keys
  // that break the prompt builder's [KEY] formatter in web-push.js style.
  key: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_\-.]+$/, 'key: only letters, numbers, underscore, hyphen, dot'),
  // AI prompt content is itself a string (stored as Value column), not a
  // structured object — accept any JSON-serialisable value.
  value: z.unknown(),
});

// ── AI prompt-injection mitigation (Phase 5 followup) ──────────────────────
// AI endpoints accept free-form user text that gets passed to the LLM. We
// can't fully prevent prompt injection at the validation layer (that needs
// content filtering + provider-side system prompts), but we CAN cap input
// size to prevent trivial DoS / cost-overrun attacks and ensure IDs are well
// formed so attackers can't smuggle JSON through the ID field.
const aiFreeText = z.string().min(1).max(8000); // ~2k tokens of prompt room

export const aiDraftResponseSchema = z.object({
  threadId: cuidId,
});

export const aiRefineResponseSchema = z.object({
  responseId: cuidId,
  instruction: aiFreeText,
});

export const aiAskSchema = z.object({
  threadId: cuidId.optional(),
  projectId: cuidId.optional(),
  question: aiFreeText.max(2000),
}).refine(
  (d) => !!d.threadId || !!d.projectId,
  { message: 'Provide threadId or projectId', path: ['question'] }
);

export const aiDraftUpdateSchema = z.object({
  projectId: cuidId,
  // Custom user-supplied bullet points; cap at 8k chars total
  notes: aiFreeText.optional(),
  tone: z.enum(['professional', 'friendly', 'concise']).optional(),
});

export const aiChatSchema = z.object({
  message: aiFreeText,
  threadId: cuidId.optional(),
  projectId: cuidId.optional(),
});

export const aiGenerateProposalSchema = z.object({
  clientId: cuidId,
  projectId: cuidId.optional(),
  brief: aiFreeText.optional(),
  budget: z.number().positive().max(10_000_000).optional(),
  deadline: z.string().datetime().optional(),
});

export const aiClientHealthSchema = z.object({
  clientId: cuidId,
});

export const aiTriageInboxSchema = z.object({
  // Pass 'since' cursor instead of "all" to control batch size
  sinceIso: z.string().datetime().optional(),
  maxThreads: z.number().int().min(1).max(100).default(20),
});

export const aiSummarizeProjectSchema = z.object({
  projectId: cuidId,
  audience: z.enum(['client', 'internal', 'executive']).default('internal'),
});

export const aiQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  projectId: cuidId.optional(),
  clientId: cuidId.optional(),
});

// ── Settings: assignment rules + templates + AI provider ───────────────────
export const assignmentRuleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  // Type drives condition shape — whitelist to prevent injection via
  // condition schema mismatch
  type: z.enum(['LEAD_SOURCE', 'PROJECT_TYPE', 'CLIENT_TAG', 'DEAL_SIZE']),
  // Conditions JSON shape is intentionally flexible but bounded
  conditions: z.array(z.object({
    field: z.string().min(1).max(50),
    op: z.enum(['equals', 'not_equals', 'contains', 'gt', 'lt', 'in']),
    value: z.unknown(),
  })).min(1).max(20),
  assignToId: cuidId,
  priority: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const assignmentRuleUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['LEAD_SOURCE', 'PROJECT_TYPE', 'CLIENT_TAG', 'DEAL_SIZE']).optional(),
  conditions: z.array(z.object({
    field: z.string().min(1).max(50),
    op: z.enum(['equals', 'not_equals', 'contains', 'gt', 'lt', 'in']),
    value: z.unknown(),
  })).min(1).max(20).optional(),
  assignToId: cuidId.optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const templateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(50_000), // 50k chars = ~10k tokens
  variables: z.array(z.string().min(1).max(100)).max(100).optional(),
  isActive: z.boolean().default(true),
});

export const templateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(50_000).optional(),
  variables: z.array(z.string().min(1).max(100)).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const templateRenderSchema = z.object({
  // Map of {{var}} name -> substitution value (template variables)
  variables: z.record(z.string(), z.string().max(10_000)).default({}),
});

export const aiProviderSwitchSchema = z.object({
  provider: z.enum(['claude', 'gemini', 'ollama']),
  // Ollama model name — provider-side validated, but cap to prevent abuse
  model: z.string().min(1).max(100).optional(),
});

// ── Proposals (Bonsai replacement) ──────────────────────────────────────────
const proposalLineItemInput = z.object({
  // Description of what the line item is for (e.g. "Design — 5 hours")
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(10_000).default(1),
  unitPrice: z.number().nonnegative().max(10_000_000),
  unit: z.string().min(1).max(20).optional(), // e.g. 'hr', 'ea'
  category: z.string().min(1).max(50).optional(),
});

export const proposalCreateSchema = z.object({
  clientId: cuidId,
  title: z.string().min(1).max(200),
  // Must have at least one line item — proposal with no items would be
  // a $0 quote and likely a misuse. The handler also checks this manually
  // but we surface it at validation time too.
  lineItems: z.array(proposalLineItemInput).min(1).max(100),
  notes: z.string().max(10_000).optional(),
  validUntil: z.string().datetime().optional(),
  projectId: cuidId.optional(),
});

export const proposalUpdateSchema = z.object({
  // Partial — every field optional so PUT can be a no-op
  clientId: cuidId.optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(10_000).optional(),
  validUntil: z.string().datetime().optional(),
  projectId: cuidId.optional(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'DECLINED']).optional(),
});

// Bulk operations take a list of IDs
export const proposalBulkIdsSchema = z.object({
  ids: z.array(cuidId).min(1).max(100),
});

// ── Threads (inbox + communication) ────────────────────────────────────────
export const threadCreateSchema = z.object({
  subject: z.string().min(1).max(500),
  clientId: cuidId,
  projectId: cuidId.optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  assignedToId: cuidId.optional(),
});

export const threadUpdateSchema = z.object({
  status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
  projectId: cuidId.nullable().optional(),
  clientId: cuidId.optional(),
});

export const threadAssignSchema = z.object({
  userId: cuidId.optional(),
  // Auto-assign using the assignment rule engine instead of an explicit user
  autoAssign: z.boolean().optional(),
}).refine(
  (d) => !!d.userId || d.autoAssign === true,
  { message: 'Provide userId or set autoAssign=true', path: ['userId'] }
);

export const threadSnoozeSchema = z.object({
  until: z.string().datetime(),
});

export const threadMessageCreateSchema = z.object({
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  senderEmail: z.string().email().max(255),
  senderName: z.string().min(1).max(200),
  subject: z.string().max(500).optional(),
  bodyText: z.string().max(100_000).optional(), // ~25k tokens; emails can be long
  bodyHtml: z.string().max(500_000).optional(), // 500k chars = ~125k tokens HTML
});

export const threadNoteCreateSchema = z.object({
  content: z.string().min(1).max(10_000),
});

// ── Invoices (Stripe + line items) ────────────────────────────────────────
export const invoiceLineItemInputSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(10_000).default(1),
  unitPrice: z.number().nonnegative().max(10_000_000),
  unit: z.string().min(1).max(20).optional(),
  type: z.enum(['LABOR', 'EXPENSE', 'PRODUCT', 'DISCOUNT']).default('LABOR'),
});

export const invoiceCreateSchema = z.object({
  clientId: cuidId,
  projectId: cuidId.optional(),
  // Line items are required for a meaningful invoice (an empty $0 invoice
  // is almost always a client-side bug)
  lineItems: z.array(invoiceLineItemInputSchema).min(1).max(200),
  notes: z.string().max(10_000).optional(),
  dueDate: z.string().datetime().optional(),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']).default('USD'),
});

export const invoiceUpdateSchema = z.object({
  lineItems: z.array(invoiceLineItemInputSchema).min(1).max(200).optional(),
  notes: z.string().max(10_000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
});

export const invoiceRecordPaymentSchema = z.object({
  method: z.enum(['STRIPE', 'BANK_TRANSFER', 'CHECK', 'CASH', 'OTHER']),
  amount: z.number().positive().max(10_000_000),
  paidAt: z.string().datetime().optional(),
  reference: z.string().max(200).optional(),
});

export const lineItemTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  itemType: z.string().min(1).max(50),
  unitPrice: z.number().nonnegative().max(10_000_000),
  unit: z.string().min(1).max(20).default('hr'),
});

// Bulk operations shared between invoice + proposal
export const invoiceBulkIdsSchema = z.object({
  ids: z.array(cuidId).min(1).max(100),
});

export const bulkMarkPaidSchema = invoiceBulkIdsSchema.extend({
  // Optional payment date for all — defaults to now if omitted
  paidAt: z.string().datetime().optional(),
});

// ── Tasks + Projects ─────────────────────────────────────────────────────
export const taskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  projectId: cuidId,
  description: z.string().max(50_000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: cuidId.optional(),
});

export const taskUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
  assigneeId: cuidId.nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export const taskBulkUpdateSchema = z.object({
  updates: z.array(z.object({
    id: cuidId,
    status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
    assigneeId: cuidId.nullable().optional(),
  })).min(1).max(100),
});

export const taskNoteCreateSchema = z.object({
  content: z.string().min(1).max(10_000),
  title: z.string().max(200).optional(),
  icon: z.string().max(20).optional(),
  coverImage: z.string().url().max(2048).optional(),
  // Notion-style properties block (objects keyed by name)
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const taskNoteUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(20).optional(),
  content: z.string().min(1).max(50_000).optional(),
});

export const taskDependencyCreateSchema = z.object({
  dependsOnId: cuidId,
});

export const taskCreateQuickSchema = z.object({
  title: z.string().min(1).max(500),
  assigneeId: cuidId.optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
});

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  clientId: cuidId,
  description: z.string().max(10_000).optional(),
  hourlyBudget: z.number().positive().max(1_000_000).optional(),
  billingType: z.enum(['FIXED', 'HOURLY', 'RETAINER']).default('HOURLY'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const projectUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ON_HOLD', 'LAUNCHED', 'CANCELLED']).optional(),
  health: z.enum(['ON_TRACK', 'NEEDS_ATTENTION', 'AT_RISK']).optional(),
  hourlyBudget: z.number().positive().max(1_000_000).nullable().optional(),
  billingType: z.enum(['FIXED', 'HOURLY', 'RETAINER']).optional(),
  endDate: z.string().datetime().nullable().optional(),
});

// ── Pipeline (sales Kanban) ───────────────────────────────────────────────
export const pipelineStageCreateSchema = z.object({
  name: z.string().min(1).max(100),
  order: z.number().int().min(0).max(1000).default(0),
  color: z.string().max(20).optional(),
  probability: z.number().int().min(0).max(100).default(50),
});

export const pipelineStageUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  order: z.number().int().min(0).max(1000).optional(),
  color: z.string().max(20).optional(),
  probability: z.number().int().min(0).max(100).optional(),
});

export const pipelineDealCreateSchema = z.object({
  name: z.string().min(1).max(200),
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
  stageId: cuidId,
  amount: z.number().nonnegative().max(10_000_000).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  notes: z.string().max(10_000).optional(),
});

export const pipelineDealUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  stageId: cuidId.optional(),
  amount: z.number().nonnegative().max(10_000_000).nullable().optional(),
  expectedCloseDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(10_000).optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
});

// ── Response (AI-drafted reply) ───────────────────────────────────────────
export const responseCreateSchema = z.object({
  threadId: cuidId,
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  tone: z.string().min(1).max(50).optional(),
  aiGenerated: z.boolean().default(false),
  // AI options JSON — capped to prevent AI prompt field smuggling
  aiOptions: z.string().max(100_000).optional(),
});

export const responseUpdateSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(50_000).optional(),
  tone: z.string().min(1).max(50).optional(),
});

export const responseRejectSchema = z.object({
  reason: z.string().max(1_000).optional(),
});

// ── Proposal Builder (AI-assisted proposal generation) ────────────────────
export const proposalBuilderGenerateSchema = z.object({
  // name + email are required for AI generation (the route used to inline-check these)
  name: z.string().min(1).max(200),
  email: z.string().email().max(255),
  company: z.string().min(1).max(200).optional(),
  projectType: z.string().min(1).max(100).optional(),
  budget: z.number().positive().max(10_000_000).optional(),
  timeline: z.string().min(1).max(200).optional(),
  notes: z.string().max(10_000).optional(),
  clientId: cuidId.optional(),
});

export const proposalBuilderEmailSchema = z.object({
  email: z.string().email().max(255),
});

export const proposalBuilderUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(10_000).optional(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'DECLINED']).optional(),
  subtotal: z.number().nonnegative().max(10_000_000).optional(),
  total: z.number().nonnegative().max(10_000_000).optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

// ── Project context + AI planner + templates ───────────────────────────────
export const projectContextUpdateSchema = z.object({
  humanNotes: z.string().max(20_000).optional(),
  // Allow additional context fields to be set in a single call
  clientGoals: z.string().max(10_000).optional(),
  targetAudience: z.string().max(5_000).optional(),
  constraints: z.string().max(10_000).optional(),
});

export const projectAiPlanSchema = z.object({
  brief: z.string().min(1).max(20_000), // required by route handler
  projectType: z.string().min(1).max(100).optional(),
});

export const projectTemplateSaveSchema = z.object({
  projectId: cuidId.optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  projectType: z.string().min(1).max(100).optional(),
});

export const projectFromTemplateSchema = z.object({
  templateId: cuidId,
  clientId: cuidId,
  name: z.string().min(1).max(200),
});
