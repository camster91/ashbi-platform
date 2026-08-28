// Shared Zod validation schemas for Fastify route input validation
// Usage: import { schemas } from '../validators/schemas.js';

import { z } from 'zod';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIMETYPES,
  MAX_UPLOAD_SIZE,
  validateUploadedFile,
} from '../security/file-upload-policy.js';

// ── Reusable field validators ──────────────────────────────────────────────
const email = z.string().email().max(255);
const password = z.string().min(8).max(128);
const userName = z.string().min(1).max(100);
const uuid = z.string().uuid();
const cuidId = z.string().min(1).max(50); // accepts cuid2, uuid, etc.
const url = z.string().url().max(2048);

// Allowlisted file extensions (prevents path traversal / XSS via stored extensions)

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
  contacts: z.array(z.object({
    email: z.string().email().max(255),
    name: z.string().min(1).max(200),
    role: z.string().max(100).optional(),
    isPrimary: z.boolean().default(false),
  })).max(10).optional(),
});

export const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PROSPECT']).optional(),
});

// ── Invoice schemas ───────────────────────────────────────────────────────
const invoiceRouteLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  itemType: z.enum(['LABOR', 'MATERIAL', 'MATERIALS', 'EXPENSE', 'DISCOUNT', 'CUSTOM', 'OTHER']).optional().default('LABOR'),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative().optional(),
  position: z.number().int().optional(),
});

export const createInvoiceSchema = z.object({
  creationRequestId: z.string().uuid(),
  clientId: cuidId,
  projectId: cuidId.optional(),
  title: z.string().min(1).max(200).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  currency: z.enum(['CAD', 'USD']),
  taxRate: z.number().min(0).max(50),
  discountAmount: z.number().min(0).optional().default(0),
  notes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  taxType: z.enum(['HST', 'GST', 'PST', 'NONE']),
  taxReviewed: z.literal(true),
  isRecurring: z.boolean().optional(),
  recurringInterval: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUALLY']).optional(),
  lineItems: z.array(invoiceRouteLineItemSchema).min(1),
}).strict().superRefine((value, context) => {
  if (value.taxType === 'NONE' && value.taxRate !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taxRate'],
      message: 'Tax rate must be 0 when tax type is NONE',
    });
  }
});

export const proposalInvoiceDraftSchema = z.object({
  taxType: z.enum(['HST', 'GST', 'PST', 'NONE']),
  taxRate: z.number().min(0).max(50),
  taxReviewed: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.taxType === 'NONE' && value.taxRate !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taxRate'],
      message: 'Tax rate must be 0 when tax type is NONE',
    });
  }
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
  internalNotes: z.string().max(2000).optional(),
  taxType: z.enum(['HST', 'GST', 'PST', 'NONE']).optional(),
  projectId: cuidId.nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurringInterval: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUALLY']).nullable().optional(),
  lineItems: z.array(invoiceRouteLineItemSchema).min(1).optional(),
}).refine(val => Object.keys(val).length > 0, { message: 'At least one field must be provided' });

// ── Mark invoice paid ──────────────────────────────────────────────────────
export const markInvoicePaidSchema = z.object({
  amount: z.number().positive().optional(),
  method: z.enum(['STRIPE', 'BANK', 'TRANSFER', 'CASH', 'CHEQUE', 'OTHER']).optional(),
  paymentMethod: z.enum(['STRIPE', 'BANK', 'TRANSFER', 'CASH', 'CHEQUE', 'OTHER']).optional(),
  paymentNotes: z.string().max(2000).optional(),
  transactionId: z.string().max(200).optional(),
  paidAt: z.string().datetime().optional(),
});

// ── Send invoice ──────────────────────────────────────────────────────────
export const sendInvoiceSchema = z.object({
  email: email.optional(),
  message: z.string().max(2000).optional(),
  requestId: z.string().uuid().optional(),
}).default({});

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
  signerName: z.string().min(1).max(200),
  signatureType: z.enum(['type', 'draw']),
  signatureImage: z.string().min(1).max(50000).optional(),
  agreement: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.signatureType === 'draw' && !value.signatureImage) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signatureImage'], message: 'Drawn signatures require signatureImage' });
  }
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
export { validateUploadedFile };

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

// ── Slack collaboration schemas ────────────────────────────────────────────
const slackId = z.string().regex(/^[A-Z][A-Z0-9]+$/).max(64);

export const slackInstallationSchema = z.object({
  teamId: slackId,
  teamName: z.string().trim().min(1).max(200).optional(),
  botUserId: slackId.optional(),
  botToken: z.string().trim().min(1).max(4096),
  scopes: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
}).strict();

export const slackChannelMappingSchema = z.object({
  projectId: cuidId,
  channelId: slackId,
  channelName: z.string().trim().min(1).max(200).optional(),
  inboundEnabled: z.boolean().optional().default(true),
  outboundEnabled: z.boolean().optional().default(false),
}).strict();

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
  MAX_SIZE: MAX_UPLOAD_SIZE,
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

export const aiBridgeChatSchema = z.object({
  model: z.string().min(1).max(100).optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().trim().min(1).max(12000),
  })).min(1).max(20),
}).strict();

const aiBridgeTaskActionInputSchema = z.object({
  projectId: cuidId,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']).optional(),
  dueDate: z.string().max(64).optional(),
}).strict();

const aiBridgeSlackActionInputSchema = z.object({
  projectId: cuidId,
  text: z.string().trim().min(1).max(4_000),
  threadMessageId: cuidId.optional(),
}).strict();

const aiBridgeCalendarEventActionInputSchema = z.object({
  projectId: cuidId,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  type: z.enum(['MEETING', 'DEADLINE', 'REMINDER', 'MILESTONE']).optional(),
  location: z.string().trim().max(500).optional(),
}).strict();

export const aiBridgeActionPrepareSchema = z.object({
  action: z.enum(['create_task', 'create_calendar_event', 'send_slack_message']),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  input: z.union([aiBridgeTaskActionInputSchema, aiBridgeCalendarEventActionInputSchema, aiBridgeSlackActionInputSchema]),
}).strict();

export const aiBridgeActionConfirmSchema = z.object({
  confirm: z.literal(true),
}).strict();

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
  currency: z.enum(['CAD', 'USD']),
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
  currency: z.enum(['CAD', 'USD']).optional(),
  lineItems: z.array(proposalLineItemInput).min(1).max(100).optional(),
  discount: z.number().nonnegative().max(10_000_000).optional(),
});

export const dealProposalDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  lineItems: z.array(proposalLineItemInput).min(1).max(100),
  notes: z.string().max(10_000).optional(),
  validUntil: z.string().datetime().optional(),
}).strict();

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
  status: z.enum(['PENDING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']).default('PENDING'),
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
  name: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).max(1000).default(0),
  color: z.string().max(20).optional(),
  probability: z.number().int().min(0).max(100).default(50),
}).strict();

export const pipelineStageUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  order: z.number().int().min(0).max(1000).optional(),
  color: z.string().max(20).optional(),
  probability: z.number().int().min(0).max(100).optional(),
}).strict();

export const pipelineDealCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  clientId: cuidId,
  stageId: cuidId,
  value: z.number().nonnegative().max(10_000_000).optional(),
  currency: z.enum(['CAD', 'USD']),
  expectedCloseDate: z.string().datetime().optional(),
  notes: z.string().max(10_000).optional(),
}).strict();

export const pipelineDealUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  stageId: cuidId.optional(),
  value: z.number().nonnegative().max(10_000_000).optional(),
  currency: z.enum(['CAD', 'USD']).optional(),
  expectedCloseDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(10_000).optional(),
}).strict();

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

// ── Comments (task comments) ───────────────────────────────────────────────
export const commentCreateSchema = z.object({
  content: z.string().min(1).max(10_000),
  mentions: z.array(cuidId).max(50).optional(),
});

// ── Contracts (DocuSign replacement) ──────────────────────────────────────
export const contractCreateSchema = z.object({
  clientId: cuidId,
  title: z.string().min(1).max(200),
  templateType: z.enum(['RETAINER', 'PROJECT', 'NDA', 'CUSTOM']),
  content: z.string().min(1).max(100_000),
  proposalId: cuidId.optional(),
  validUntil: z.string().datetime().optional(),
});

export const contractUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(100_000).optional(),
  draftData: z.string().max(50_000).optional(),
});

export const contractSignNewSchema = z.object({
  signerName: z.string().min(1).max(200),
  agreement: z.boolean(), // explicit acceptance
  signatureData: z.string().max(50_000).optional(), // drawn / typed signature
});

// ── Creative Brief (feeds proposal builder) ──────────────────────────────
export const creativeBriefCreateSchema = z.object({
  clientId: cuidId,
  projectType: z.string().min(1).max(100),
  notes: z.string().max(20_000).optional(),
  targetAudience: z.string().max(5_000).optional(),
  brandGuidelines: z.string().max(20_000).optional(),
  deliverables: z.array(z.string().max(500)).max(50).optional(),
});

export const creativeBriefUpdateSchema = z.object({
  projectType: z.string().min(1).max(100).optional(),
  notes: z.string().max(20_000).optional(),
  targetAudience: z.string().max(5_000).optional(),
  brandGuidelines: z.string().max(20_000).optional(),
  deliverables: z.array(z.string().max(500)).max(50).optional(),
});

// ── Credentials (encrypted vault) ─────────────────────────────────────────
const credentialFields = z.object({
  label: z.string().min(1).max(200),
  username: z.string().min(1).max(200).optional(),
  password: z.string().min(1).max(1000), // pre-encryption; service encrypts
  url: z.string().url().max(2048).optional(),
  notes: z.string().max(5_000).optional(),
  category: z.string().min(1).max(50).optional(),
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
});

export const clientPortalRevisionResponseSchema = z.object({
  action: z.enum(['APPROVE', 'REQUEST_CHANGES']),
  feedback: z.string().trim().max(5_000).optional(),
}).superRefine((value, context) => {
  if (value.action === 'REQUEST_CHANGES' && !value.feedback) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['feedback'], message: 'Feedback is required when requesting changes' });
  }
});

export const clientPortalFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(5_000),
});
export const credentialCreateSchema = credentialFields.refine(
  (value) => Boolean(value.clientId || value.projectId),
  { message: 'A client or project owner is required' },
);
export const credentialUpdateSchema = credentialFields.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one credential field is required' },
);
export const credentialSchema = credentialCreateSchema;

// ── Draft responses (Notion-style inline drafts) ──────────────────────────
export const draftSchema = z.object({
  data: z.string().min(1).max(100_000), // JSON or markdown content
});

// ── Email triage ──────────────────────────────────────────────────────────
export const emailTriageScanSchema = z.object({
  // Currently the route accepts no body, but pre-strip-down extended it
  // to optionally take a date range. Keep room for it.
  sinceIso: z.string().datetime().optional(),
  maxThreads: z.number().int().min(1).max(100).default(50),
});

export const emailTriageUpdateSchema = z.object({
  subject: z.string().max(500).optional(),
  body: z.string().max(50_000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  status: z.enum(['NEEDS_REPLY', 'INFO_ONLY', 'URGENT', 'DONE']).optional(),
});

// ── Estimates (pre-sale quotes) ──────────────────────────────────────────
export const estimateCreateSchema = z.object({
  clientId: cuidId,
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  lineItems: z.array(invoiceLineItemInputSchema).min(1).max(100),
  tax: z.number().nonnegative().max(100).default(0),
  validUntil: z.string().datetime().optional(),
});

export const estimateUpdateSchema = estimateCreateSchema.partial();

export const estimateActionSchema = z.object({
  action: z.enum(['approve', 'decline']),
  notes: z.string().max(1_000).optional(),
});

// ── Expense (already has createExpenseSchema, add update + bulk) ─────────
export const expenseUpdateSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  amount: z.number().positive().max(10_000_000).optional(),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']).optional(),
  category: z.string().min(1).max(50).optional(),
  date: z.string().datetime().optional(),
  billable: z.boolean().optional(),
  notes: z.string().max(5_000).optional(),
});

// ── Gmail drafts / replies ────────────────────────────────────────────────
export const gmailSendSchema = z.object({
  to: z.string().email().max(255),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  threadId: cuidId.optional(),
  in_reply_to: z.string().max(500).optional(),
  references: z.string().max(500).optional(),
  hubThreadId: cuidId.optional(),
});

export const gmailReplySchema = z.object({
  hubThreadId: cuidId,
  body: z.string().min(1).max(50_000).optional(),
});

// ── Inbox ────────────────────────────────────────────────────────────────
export const inboxAssignSchema = z.object({
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
  createNewClient: z.boolean().optional(),
});

// ── Integration ──────────────────────────────────────────────────────────
export const integrationUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

// ── Milestone ────────────────────────────────────────────────────────────
export const milestoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']).optional(),
  color: z.string().max(20).optional(),
});

// ── Note (sticky note widget) ─────────────────────────────────────────────
export const noteCreateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50_000),
  type: z.enum(['NOTE', 'REMINDER', 'TASK', 'IDEA']).default('NOTE'),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().default(false),
  // Optional association
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
});

export const noteUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50_000).optional(),
  type: z.enum(['NOTE', 'REMINDER', 'TASK', 'IDEA']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().optional(),
});

// ── Organization (multi-tenant admin) ────────────────────────────────────
export const organizationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers, hyphens'),
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).default('FREE'),
});

// ── Retainer (subscription plan / client retainer) ───────────────────────
export const retainerPlanCreateSchema = z.object({
  clientId: cuidId,
  monthlyHours: z.number().positive().max(1000).optional(),
  monthlyAmountUsd: z.number().positive().max(1_000_000),
  tier: z.enum(['BASIC', 'GROWTH', 'SCALE']).default('BASIC'),
  startDate: z.string().datetime().optional(),
});

// ── Revision (revision rounds) ────────────────────────────────────────────
export const revisionCreateSchema = z.object({
  notes: z.string().min(1).max(5_000),
});

export const revisionUpdateSchema = z.object({
  status: z.enum(['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED']),
  notes: z.string().max(5_000).optional(),
});

// ── Search / Semantic Search ─────────────────────────────────────────────
export const searchAskSchema = z.object({
  question: z.string().min(1).max(2_000),
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
});

export const semanticSearchCreateSchema = z.object({
  clientId: cuidId.optional(),
  content: z.string().min(1).max(50_000),
  source: z.string().min(1).max(100),
  sourceId: cuidId.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── Team (user management) ───────────────────────────────────────────────
export const teamInviteSchema = z.object({
  email: z.string().email().max(255),
  password: password,
  name: z.string().min(1).max(100),
  role: z.enum(['ADMIN', 'STAFF', 'CLIENT']).default('STAFF'),
  skills: z.array(z.string().max(50)).max(50).optional(),
  capacity: z.number().int().min(0).max(200).default(100),
});

export const teamUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['ADMIN', 'STAFF', 'CLIENT']).optional(),
  skills: z.array(z.string().max(50)).max(50).optional(),
  capacity: z.number().int().min(0).max(200).optional(),
  isActive: z.boolean().optional(),
});

export const teamPasswordResetSchema = z.object({
  newPassword: password,
});

// ── TaskTemplate (saved task templates per project) ──────────────────────
export const taskTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  phase: z.string().min(1).max(100).optional(),
  tasks: z.array(z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5_000).optional(),
    estimatedTime: z.number().int().positive().max(1000).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  })).min(1).max(100),
});

// ── Time tracking ────────────────────────────────────────────────────────
export const timeEntryCreateSchema = z.object({
  projectId: cuidId,
  taskId: cuidId.optional(),
  duration: z.number().positive().max(86_400), // max 24h
  description: z.string().max(2_000).optional(),
  date: z.string().datetime().optional(),
  billable: z.boolean().default(true),
});

export const timeEntryUpdateSchema = z.object({
  duration: z.number().positive().max(86_400).optional(),
  description: z.string().max(2_000).optional(),
  date: z.string().datetime().optional(),
  billable: z.boolean().optional(),
  taskId: cuidId.nullable().optional(),
});

export const timeSessionStartSchema = z.object({
  taskId: cuidId.optional(),
  projectId: cuidId,
  description: z.string().max(2_000).optional(),
  billable: z.boolean().default(true),
});

export const timeSessionUpdateSchema = z.object({
  projectId: cuidId.optional(),
  taskId: cuidId.optional(),
  description: z.string().max(2_000).optional(),
});

// ── Attachment ───────────────────────────────────────────────────────────
export const attachmentCreateSchema = z.object({
  // File metadata + S3 key — the binary upload is via multipart route
  // which has separate validation (see ALLOWED_EXTENSIONS in schemas.js)
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().max(50 * 1024 * 1024), // 50MB
  entityType: z.enum(['CLIENT', 'PROJECT', 'TASK', 'INVOICE', 'CONTRACT', 'PROPOSAL', 'THREAD', 'MESSAGE', 'NOTE']),
  entityId: cuidId,
});

// ── Brand settings ───────────────────────────────────────────────────────
export const brandSettingsSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex color like #1a2b3c').optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().max(2048).optional(),
  companyName: z.string().min(1).max(200).optional(),
  tagline: z.string().max(500).optional(),
  fontFamily: z.string().max(100).optional(),
});

// ── Calendar (event RSVP) ────────────────────────────────────────────────
export const calendarRsvpSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']),
});

// ── Chat (Ash chat + simple chat) ─────────────────────────────────────────
export const chatMessageCreateSchema = z.object({
  content: z.string().min(1).max(50_000),
  type: z.enum(['TEXT', 'IMAGE', 'FILE', 'SYSTEM']).default('TEXT'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  parentId: cuidId.optional(),
});

export const chatMessageUpdateSchema = z.object({
  content: z.string().min(1).max(50_000),
});

export const chatReactionSchema = z.object({
  emoji: z.string().min(1).max(20),
});

// ── Client + ClientPortal ────────────────────────────────────────────────
export const clientCreateSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).optional(),
  status: z.enum(['PROSPECT', 'ACTIVE', 'ARCHIVED']).default('PROSPECT'),
});

export const clientContactSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(200),
  role: z.string().max(100).optional(),
  isPrimary: z.boolean().default(false),
});

export const clientNoteCreateSchema = z.object({
  content: z.string().min(1).max(10_000),
});

export const clientPortalEmailSchema = z.object({
  email: z.string().email().max(255),
});

export const clientPortalTokenRedeemSchema = z.object({
  token: z.string().min(1).max(500),
});

export const clientPortalMessageNewSchema = z.object({
  content: z.string().min(1).max(10_000),
  type: z.enum(['TEXT', 'FILE', 'INVOICE_REPLY', 'CONTRACT_REPLY']).default('TEXT'),
});

// ── Landing (public lead form) ───────────────────────────────────────────
export const PUBLIC_SERVICE_LINES = [
  'brand_packaging',
  'web_commerce',
  'custom_platform',
  'ai_automation',
  'managed_support',
  'unknown',
];

export const publicInquirySchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  company: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  serviceLine: z.enum(PUBLIC_SERVICE_LINES),
  businessContext: z.string().trim().min(10).max(5_000),
  requestedOutcome: z.string().trim().min(10).max(2_000),
  timing: z.enum(['urgent_30_days', 'one_to_three_months', 'three_to_six_months', 'exploring']).optional(),
  budgetBand: z.enum(['under_5k', '5k_10k', '10k_25k', '25k_plus', 'not_sure', 'prefer_not_to_say']).optional(),
  budgetCurrency: z.enum(['CAD', 'USD']).optional(),
  consent: z.literal(true),
  privacyVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:\.[A-Za-z0-9_-]+)?$/),
  attribution: z.object({
    landingPage: z.string().trim().regex(/^\/(?!\/)[^?#]{0,499}$/),
    referrer: z.string().trim().url().max(2_048).optional(),
    source: z.string().trim().max(100).optional(),
    medium: z.string().trim().max(100).optional(),
    campaign: z.string().trim().max(100).optional(),
    clickId: z.string().trim().max(200).optional(),
  }).strict(),
  website: z.string().max(200).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.budgetBand) !== Boolean(value.budgetCurrency)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.budgetBand ? ['budgetCurrency'] : ['budgetBand'],
      message: 'Budget band and currency must be supplied together',
    });
  }
});

export const QUALIFIED_LEAD_STATUSES = [
  'NEW',
  'REVIEWING',
  'QUALIFIED',
  'NURTURE',
  'DISQUALIFIED',
];

export const LEAD_DISQUALIFICATION_REASONS = [
  'BUDGET_MISMATCH',
  'TIMING_MISMATCH',
  'SERVICE_MISMATCH',
  'NO_CONTACT_PATH',
  'NOT_PURSUING',
  'OTHER',
];

export const leadListQuerySchema = z.object({
  status: z.enum([...QUALIFIED_LEAD_STATUSES, 'CONVERTED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const leadAcquisitionSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).optional(),
}).strict();

export const growthReviewTaskSchema = z.object({
  projectId: cuidId,
  assigneeId: cuidId,
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.string().trim().min(10).max(500),
  dueDate: z.string().datetime(),
  sourceCoverageReviewed: z.literal(true),
  currenciesSeparated: z.literal(true),
  missingAttributionDisclosed: z.literal(true),
  externalActionState: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'DECLINED']),
}).strict().superRefine((value, context) => {
  const weekStart = new Date(`${value.weekOf}T00:00:00.000Z`);
  const [year, month, day] = value.weekOf.split('-').map(Number);
  const isCalendarDate = !Number.isNaN(weekStart.getTime())
    && weekStart.getUTCFullYear() === year
    && weekStart.getUTCMonth() + 1 === month
    && weekStart.getUTCDate() === day;
  if (!isCalendarDate || weekStart.getUTCDay() !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['weekOf'], message: 'Week must start on Monday' });
    return;
  }
  const dueDate = new Date(value.dueDate);
  const nextWeek = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (dueDate < weekStart || dueDate >= nextWeek) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date must fall inside the review week' });
  }
});

export const leadIdParamsSchema = z.object({ id: cuidId }).strict();

export const leadQualificationSchema = z.object({
  status: z.enum(QUALIFIED_LEAD_STATUSES),
  qualificationNotes: z.string().trim().max(5_000).optional(),
  qualificationReasonCode: z.enum(LEAD_DISQUALIFICATION_REASONS).nullable().optional(),
  nextAction: z.string().trim().min(1).max(500).nullable().optional(),
  nextActionDueAt: z.string().datetime().nullable().optional(),
}).strict().superRefine((value, context) => {
  const needsFollowUp = ['REVIEWING', 'QUALIFIED', 'NURTURE'].includes(value.status);
  if (needsFollowUp && !value.nextAction) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['nextAction'], message: 'A next action is required for active leads' });
  }
  if (needsFollowUp && !value.nextActionDueAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['nextActionDueAt'], message: 'A next-action due date is required for active leads' });
  }
  if (value.status === 'DISQUALIFIED' && !value.qualificationReasonCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['qualificationReasonCode'], message: 'A bounded reason is required for disqualified leads' });
  }
  if (value.status === 'DISQUALIFIED' && (value.nextAction || value.nextActionDueAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['nextAction'], message: 'Disqualified leads cannot keep an active follow-up' });
  }
  if (['QUALIFIED', 'NURTURE', 'DISQUALIFIED'].includes(value.status) && (!value.qualificationNotes || value.qualificationNotes.length < 10)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['qualificationNotes'], message: 'Record concise evidence for this decision' });
  }
});

export const leadPromotionSchema = z.object({
  stageId: cuidId,
  name: z.string().trim().min(1).max(200),
  value: z.number().nonnegative().max(10_000_000).optional(),
  currency: z.enum(['CAD', 'USD']),
}).strict();

export const landingLeadSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(255),
  company: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  budget: z.number().positive().max(10_000_000).optional(),
  message: z.string().max(10_000).optional(),
});

// ── Invoice Chaser ───────────────────────────────────────────────────────
export const invoiceChaserSchema = z.object({
  invoiceId: cuidId,
  message: z.string().max(5_000).optional(),
});

// ── API key (programmatic access tokens) ─────────────────────────────────
export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

// ── Ash Chat ─────────────────────────────────────────────────────────────
export const ashChatMessageSchema = z.object({
  content: z.string().min(1).max(50_000),
  // Optional context — thread, project, client references
  threadId: cuidId.optional(),
  projectId: cuidId.optional(),
  clientId: cuidId.optional(),
});

// ── AI Team ──────────────────────────────────────────────────────────────
export const aiTeamMessageSchema = z.object({
  agentRole: z.enum(['PLANNER', 'RESEARCHER', 'WRITER', 'CRITIC', 'CLIENT_VOICE', 'OPS']),
  message: z.string().min(1).max(20_000),
  clientId: cuidId.optional(),
  projectId: cuidId.optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(20_000),
  })).max(20).optional(),
});

// ── Settings (assignment rules + remaining) ──────────────────────────────
export const assignmentRuleBulkSchema = z.object({
  rules: z.array(z.object({
    id: cuidId.optional(),
    name: z.string().min(1).max(200),
    type: z.enum(['LEAD_SOURCE', 'PROJECT_TYPE', 'CLIENT_TAG', 'DEAL_SIZE']),
    conditions: z.array(z.object({
      field: z.string().min(1).max(50),
      op: z.enum(['equals', 'not_equals', 'contains', 'gt', 'lt', 'in']),
      value: z.unknown(),
    })).min(1).max(20),
    assignToId: cuidId,
    priority: z.number().int().min(0).max(1000).default(0),
    isActive: z.boolean().default(true),
  })).min(1).max(50),
});

// ── Final batch (43 endpoints) ────────────────────────────────────────────
export const assetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(2048),
  type: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'FONT', 'COLOR', 'OTHER']).default('IMAGE'),
  tags: z.array(z.string().max(50)).max(50).optional(),
  // Loose metadata — client-specific fields like dimensions, color tokens
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const assetUpdateSchema = assetCreateSchema.partial();

export const assetGuidelineCreateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  category: z.string().max(100).optional(),
});

export const chatReactionCreateSchema = z.object({
  emoji: z.string().min(1).max(20),
});

export const contractDraftUpdateSchema = z.object({
  draftData: z.string().max(50_000),
  status: z.enum(['DRAFT', 'PENDING_SIGNATURE']).optional(),
});

export const creativeBriefGenerateSchema = z.object({
  clientId: cuidId.optional(),
  brief: z.string().min(1).max(20_000),
  // Output style
  tone: z.enum(['professional', 'friendly', 'concise']).default('professional'),
});

export const draftUpsertSchema = z.object({
  data: z.unknown().refine(
    (value) => value !== undefined && JSON.stringify(value).length <= 100_000,
    'Draft data must be valid JSON no larger than 100KB',
  ),
  expectedRevision: z.number().int().positive().optional(),
  baseUpdatedAt: z.string().datetime().optional(),
});

export const emailTriageDraftUpdateSchema = z.object({
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(50_000),
});

export const gmailDraftReplySchema = z.object({
  // Body text for the reply draft — bodyText takes a single string
  body: z.string().min(1).max(50_000),
  threadId: cuidId.optional(),
});

export const inboxUnmatchedAssignSchema = z.object({
  clientId: cuidId.optional(),
  // If creating a brand-new client for the unmatched email
  createNewClient: z.boolean().optional(),
});

export const invoiceBulkArchiveSchema = z.object({
  ids: z.array(cuidId).min(1).max(100),
});

export const landingLeadUpdateSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'ARCHIVED']).optional(),
  notes: z.string().max(10_000).optional(),
});

export const mailgunSendSchema = z.object({
  to: z.string().email().max(255),
  subject: z.string().min(1).max(500),
  text: z.string().min(1).max(100_000),
  html: z.string().max(500_000).optional(),
  // Optional Mailgun domain override
  domain: z.string().max(255).optional(),
});

export const messagePasteSchema = z.object({
  bodyText: z.string().min(1).max(100_000),
  bodyHtml: z.string().max(500_000).optional(),
  subject: z.string().max(500).optional(),
  senderEmail: z.string().email().max(255),
  senderName: z.string().min(1).max(200),
});

export const milestoneCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  dueDate: z.string().datetime().optional(),
  color: z.string().max(20).optional(),
});

export const milestoneUpdateSchema = milestoneCreateSchema.extend({
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']).optional(),
});

export const noteProjectCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(50_000).default(''),
  type: z.enum(['NOTE', 'MEETING_NOTES', 'WIKI', 'DOC']).default('NOTE'),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
  parentId: cuidId.nullable().optional(),
  mentionUserIds: z.array(cuidId).max(50).default([]),
});

export const noteUpdateV2Schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(50_000).optional(),
  type: z.enum(['NOTE', 'MEETING_NOTES', 'WIKI', 'DOC']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  parentId: cuidId.nullable().optional(),
  mentionUserIds: z.array(cuidId).max(50).optional(),
});

export const noteFromTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  parentId: cuidId.nullable().optional(),
  mentionUserIds: z.array(cuidId).max(50).default([]),
});

export const onboardingTaskActionSchema = z.object({
  taskId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
});

export const onboardingClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(255),
  contactName: z.string().min(1).max(200),
  retainerTier: z.enum(['999', '1999', '3999']),
  notes: z.string().max(10_000).optional(),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(100),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export const pushSendSchema = z.object({
  // Send to specific user(s), or broadcast
  userId: cuidId.optional(),
  // If omitted, broadcast to all subscribers
  broadcast: z.boolean().optional(),
  payload: z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5_000),
    icon: z.string().url().max(2048).optional(),
    url: z.string().url().max(2048).optional(),
  }),
});

export const rateCardSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  // Hourly rate
  hourlyRate: z.number().nonnegative().max(10_000).optional(),
  // Project-flat rate
  flatRate: z.number().nonnegative().max(10_000_000).optional(),
  // Categories this rate card applies to
  categories: z.array(z.string().max(100)).max(50).optional(),
  isActive: z.boolean().default(true),
  // Actual RateCard model fields (clientId, rates, isDefault)
  clientId: cuidId.optional(),
  // rates is a JSON array of {serviceName, unit, rate, description}
  rates: z.array(z.object({
    serviceName: z.string().min(1).max(200),
    unit: z.string().min(1).max(20).default('hr'),
    rate: z.number().nonnegative().max(10_000_000),
    description: z.string().max(500).optional(),
  })).max(100).default([]),
  isDefault: z.boolean().default(false),
});

export const revisionCreateNewSchema = z.object({
  notes: z.string().min(1).max(5_000),
});

export const revisionUpdateStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED']),
  notes: z.string().max(5_000).optional(),
});

export const semanticSearchEmbedSchema = z.object({
  clientId: cuidId,
  content: z.string().min(1).max(50_000),
  source: z.string().min(1).max(100),
  sourceId: cuidId.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const semanticSearchDeleteParamsSchema = z.object({
  source: z.string().min(1).max(100),
  sourceId: cuidId,
});

export const semanticSearchClientParamsSchema = z.object({
  clientId: cuidId,
});

export const semanticSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(2_000),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  clientId: cuidId.optional(),
});

export const teamCreateSchema = teamInviteSchema; // alias

export const teamResetPasswordSchema = z.object({
  newPassword: password,
});

export const taskTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  phase: z.string().min(1).max(100).optional(),
  // JSON array of task definitions
  tasks: z.array(z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5_000).optional(),
    estimatedTime: z.number().int().positive().max(1000).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  })).min(1).max(100),
});

export const timeSessionStartNewSchema = z.object({
  projectId: cuidId,
  taskId: cuidId.optional(),
  description: z.string().max(2_000).optional(),
  billable: z.boolean().default(true),
});

export const timeEntryCreateNewSchema = timeEntryCreateSchema; // alias

export const timeEntryUpdateNewSchema = timeEntryUpdateSchema; // alias

export const timesheetRejectSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});

export const webhookEmailTestSchema = z.object({
  to: z.string().email().max(255),
  subject: z.string().min(1).max(500).default('Test email from Hub'),
  body: z.string().min(1).max(50_000).default('This is a test email sent from the Hub webhook test endpoint.'),
});

// ── Final 8 endpoints (mixed shapes) ───────────────────────────────────────
export const calendarEventCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  type: z.enum(['MEETING', 'TASK', 'REMINDER', 'BLOCKED_TIME', 'OTHER']).default('MEETING'),
  location: z.string().max(500).optional(),
  isAllDay: z.boolean().default(false),
  color: z.string().max(20).optional(),
  // Optional linking
  projectId: cuidId.optional(),
  clientId: cuidId.optional(),
});

export const calendarEventUpdateSchema = calendarEventCreateSchema.partial();

export const credentialUpsertSchema = credentialCreateSchema;

export const retainerGenerateInvoiceSchema = z.object({
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']).default('USD'),
  daysUntilDue: z.number().int().positive().max(180).default(30),
  resetHours: z.boolean().default(false),
});

export const reportGenerationSchema = z.object({
  requestId: uuid,
}).strict();

const evidenceObject = z.record(z.string(), z.unknown());

export const migrationReviewImportSchema = z.object({
  format: z.literal('ashbi-hub-migration-review-import').optional(),
  version: z.literal(1).optional(),
  requestId: uuid,
  review: evidenceObject,
  reviewSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  mappingDecision: evidenceObject,
  mappingDecisionSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  supplementalEvidence: evidenceObject.nullable().optional(),
  supplementalEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  reviewBrief: evidenceObject,
}).strict().superRefine((value, context) => {
  if (Boolean(value.supplementalEvidence) !== Boolean(value.supplementalEvidenceSha256)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['supplementalEvidenceSha256'], message: 'Supplemental evidence and checksum must be supplied together' });
  }
});

export const migrationReviewDecisionSchema = z.object({
  requestId: uuid,
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().trim().max(2_000).nullable().optional(),
}).strict();
