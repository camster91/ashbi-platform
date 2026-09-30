// @ts-check
/**
 * Tenant-scoped offboarding export of one organization (#412, "a workspace
 * export usable by a leaving customer, including files").
 *
 * Operator runbook: docs/workspace-export.md. CLI: scripts/export-workspace.js.
 *
 * The export is a directory:
 *
 *   README.md              what the customer received and how to read it
 *   manifest.json          format/version, organization, per-entity row counts
 *                          and SHA-256, per-file SHA-256 and size, exclusions,
 *                          exceptions
 *   SHA256SUMS             `sha256sum -c` compatible list of every other file
 *   data/<entity>.jsonl    one JSON object per line, one file per entity
 *   files/attachments/<attachmentId>/<name>
 *   files/expense-receipts/<expenseId>/<name>
 *
 * Every query below is filtered by the organization id, directly or through a
 * parent relation that is itself filtered by it. Rows are read in id order,
 * PAGE_SIZE at a time (keyset pagination), and streamed to disk, so memory
 * does not grow with the size of a table. The export uses a raw Prisma client
 * (never the soft-delete wrapper, which caps findMany at 100 rows) and states
 * its soft-delete filter explicitly.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';

export const EXPORT_FORMAT = 'ashbi-workspace-export-directory';
export const EXPORT_FORMAT_VERSION = 1;
export const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 5000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_UPLOAD_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const ALLOWED_UPLOAD_SUBDIRS = new Set(['brand']);
// `/upload-receipt` names receipts `receipt-<uuid>.<ext>`. Only those are
// copied: `Expense.receiptUrl` is free text, so another value could name a
// file that belongs to a different organization.
const RECEIPT_FILE_NAME = /^receipt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,10}$/i;

// ---------------------------------------------------------------------------
// Scoping helpers. `org` is the organization id being exported.
// ---------------------------------------------------------------------------

/** Active (not soft-deleted) clients of the organization. */
export const activeClient = (org) => ({ organizationId: org, deletedAt: null });
/** Active projects of the organization whose client is also active. */
export const activeProject = (org) => ({ organizationId: org, deletedAt: null, client: activeClient(org) });
const activeTask = (org) => ({ deletedAt: null, project: activeProject(org) });
const invoiceScope = (org) => ({ deletedAt: null, client: activeClient(org) });
const proposalScope = (org) => ({ deletedAt: null, client: activeClient(org) });
// Threads have an optional client and project; one without either (untriaged
// inbound mail) cannot be attributed through a relation and is left out.
const threadScope = (org) => ({ OR: [{ client: activeClient(org) }, { clientId: null, project: activeProject(org) }] });
const reviewScope = (org) => ({ organizationId: org, project: activeProject(org) });
const orgUser = (org) => ({ organizationId: org });

/**
 * @typedef {object} EntitySpec
 * @property {string} name        export name, also the data/<name>.jsonl file
 * @property {string} model       Prisma model name
 * @property {string} category
 * @property {(org: string) => object} where
 * @property {string[]} [omit]    columns never exported (see EXCLUDED_FIELDS)
 * @property {string} description
 */

/** @type {readonly EntitySpec[]} */
export const EXPORT_ENTITIES = Object.freeze([
  // Workspace and people
  { name: 'organization', model: 'Organization', category: 'workspace', where: (org) => ({ id: org }), description: 'The organization (workspace) itself' },
  { name: 'users', model: 'User', category: 'workspace', where: orgUser, omit: ['password', 'resetToken', 'resetTokenExpiresAt', 'mfaSecret', 'mfaRecoveryCodes', 'mfaLastUsedStep', 'mfaFailedAttempts', 'mfaLockedUntil', 'sessionVersion'], description: 'Staff and client-portal members (no credentials)' },
  { name: 'brand_settings', model: 'BrandSettings', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Branding used on documents' },
  { name: 'pipeline_stages', model: 'PipelineStage', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Sales pipeline stages' },
  { name: 'assignment_rules', model: 'AssignmentRule', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Inbox assignment rules' },
  { name: 'templates', model: 'Template', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Reply templates' },
  { name: 'task_templates', model: 'TaskTemplate', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Task templates' },
  { name: 'project_templates', model: 'ProjectTemplate', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Project templates' },
  { name: 'line_item_templates', model: 'LineItemTemplate', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Saved invoice line items' },
  { name: 'outreach_sequences', model: 'OutreachSequence', category: 'workspace', where: (org) => ({ organizationId: org }), description: 'Outreach email sequences' },
  { name: 'snippets', model: 'Snippet', category: 'workspace', where: (org) => ({ createdBy: orgUser(org) }), description: 'Code snippets created by members' },

  // Clients and CRM
  { name: 'clients', model: 'Client', category: 'clients', where: activeClient, description: 'Clients' },
  { name: 'contacts', model: 'Contact', category: 'clients', where: (org) => ({ client: activeClient(org) }), description: 'Client contacts' },
  { name: 'client_email_mappings', model: 'ClientEmailMapping', category: 'clients', where: (org) => ({ client: activeClient(org) }), description: 'Email addresses mapped to clients' },
  { name: 'pipeline_deals', model: 'PipelineDeal', category: 'clients', where: (org) => ({ client: activeClient(org), stage: { organizationId: org } }), description: 'Sales pipeline deals' },
  { name: 'intake_forms', model: 'IntakeForm', category: 'clients', where: (org) => ({ client: activeClient(org) }), omit: ['viewToken'], description: 'Client intake forms' },
  { name: 'intake_form_responses', model: 'IntakeFormResponse', category: 'clients', where: (org) => ({ form: { client: activeClient(org) } }), description: 'Intake form submissions' },
  { name: 'creative_briefs', model: 'CreativeBrief', category: 'clients', where: (org) => ({ client: activeClient(org) }), description: 'Creative briefs' },
  { name: 'reports', model: 'Report', category: 'clients', where: (org) => ({ client: activeClient(org) }), description: 'Client status reports' },
  { name: 'assets', model: 'Asset', category: 'clients', where: (org) => ({ client: activeClient(org) }), description: 'Asset library entries (metadata and URLs)' },
  { name: 'public_inquiries', model: 'PublicInquiry', category: 'clients', where: (org) => ({ organizationId: org }), omit: ['idempotencyKey', 'payloadHash'], description: 'Website inquiries' },

  // Projects and work
  { name: 'projects', model: 'Project', category: 'projects', where: activeProject, omit: ['viewToken', 'draftData'], description: 'Projects' },
  { name: 'project_contexts', model: 'ProjectContext', category: 'projects', where: (org) => ({ project: activeProject(org) }), description: 'Project running context and notes' },
  { name: 'milestones', model: 'Milestone', category: 'projects', where: (org) => ({ deletedAt: null, project: activeProject(org) }), description: 'Project milestones' },
  { name: 'tasks', model: 'Task', category: 'projects', where: activeTask, description: 'Tasks and task pages' },
  { name: 'task_comments', model: 'TaskComment', category: 'projects', where: (org) => ({ task: activeTask(org) }), description: 'Task comments' },
  { name: 'revision_rounds', model: 'RevisionRound', category: 'projects', where: (org) => ({ project: activeProject(org) }), description: 'Revision rounds' },
  { name: 'approvals', model: 'Approval', category: 'projects', where: (org) => ({ project: activeProject(org) }), description: 'Approval queue items of projects' },
  { name: 'activities', model: 'Activity', category: 'projects', where: (org) => ({ OR: [{ project: activeProject(org) }, { projectId: null, user: orgUser(org) }] }), description: 'Activity feed' },
  { name: 'calendar_events', model: 'CalendarEvent', category: 'projects', where: (org) => ({ createdBy: orgUser(org) }), description: 'Calendar events' },
  { name: 'event_attendees', model: 'EventAttendee', category: 'projects', where: (org) => ({ event: { createdBy: orgUser(org) } }), description: 'Calendar event attendees' },

  // Documents and wiki
  { name: 'notes', model: 'Note', category: 'documents', where: (org) => ({ deletedAt: null, project: activeProject(org) }), description: 'Notes, meeting notes, wiki pages and docs' },

  // Finance
  { name: 'invoices', model: 'Invoice', category: 'finance', where: invoiceScope, omit: ['viewToken', 'draftData'], description: 'Invoices' },
  { name: 'invoice_line_items', model: 'InvoiceLineItem', category: 'finance', where: (org) => ({ invoice: invoiceScope(org) }), description: 'Invoice line items' },
  { name: 'invoice_payments', model: 'InvoicePayment', category: 'finance', where: (org) => ({ invoice: invoiceScope(org) }), description: 'Payments recorded against invoices' },
  { name: 'proposals', model: 'Proposal', category: 'finance', where: proposalScope, omit: ['viewToken', 'draftData'], description: 'Proposals' },
  { name: 'proposal_line_items', model: 'ProposalLineItem', category: 'finance', where: (org) => ({ proposal: proposalScope(org) }), description: 'Proposal line items' },
  { name: 'proposal_versions', model: 'ProposalVersion', category: 'finance', where: (org) => ({ proposal: proposalScope(org) }), description: 'Saved proposal versions' },
  { name: 'contracts', model: 'Contract', category: 'finance', where: (org) => ({ deletedAt: null, client: activeClient(org) }), omit: ['signToken', 'draftData'], description: 'Contracts and signature evidence' },
  { name: 'estimates', model: 'Estimate', category: 'finance', where: (org) => ({ deletedAt: null, client: activeClient(org) }), omit: ['viewToken', 'draftData'], description: 'Estimates' },
  { name: 'expenses', model: 'Expense', category: 'finance', where: (org) => ({ deletedAt: null, OR: [{ client: activeClient(org) }, { clientId: null, project: activeProject(org) }] }), description: 'Expenses' },
  { name: 'retainer_plans', model: 'RetainerPlan', category: 'finance', where: (org) => ({ deletedAt: null, client: activeClient(org) }), omit: ['draftData'], description: 'Retainer plans' },
  { name: 'rate_cards', model: 'RateCard', category: 'finance', where: (org) => ({ client: activeClient(org) }), description: 'Client rate cards' },
  { name: 'time_entries', model: 'TimeEntry', category: 'finance', where: (org) => ({ deletedAt: null, project: activeProject(org) }), description: 'Time entries' },
  { name: 'time_sessions', model: 'TimeSession', category: 'finance', where: (org) => ({ project: activeProject(org) }), description: 'Timer sessions' },
  { name: 'support_hour_entries', model: 'SupportHourEntry', category: 'finance', where: (org) => ({ organizationId: org }), description: 'Support hours' },
  { name: 'revenue_snapshots', model: 'RevenueSnapshot', category: 'finance', where: (org) => ({ client: activeClient(org) }), description: 'Monthly revenue snapshots per client' },

  // Communication
  { name: 'threads', model: 'Thread', category: 'communication', where: threadScope, omit: ['inboundDeliveryKey'], description: 'Email conversation threads' },
  { name: 'messages', model: 'Message', category: 'communication', where: (org) => ({ thread: threadScope(org) }), omit: ['rawEmail'], description: 'Email messages (parsed body and headers)' },
  { name: 'internal_notes', model: 'InternalNote', category: 'communication', where: (org) => ({ thread: threadScope(org) }), description: 'Internal notes on threads' },
  { name: 'responses', model: 'Response', category: 'communication', where: (org) => ({ thread: threadScope(org) }), description: 'Drafted and sent replies' },
  { name: 'chat_messages', model: 'ChatMessage', category: 'communication', where: (org) => ({ project: activeProject(org) }), description: 'Project chat, INTERNAL and CLIENT visibility (see the visibility column)' },
  { name: 'chat_reactions', model: 'ChatReaction', category: 'communication', where: (org) => ({ message: { project: activeProject(org) } }), description: 'Chat reactions' },
  { name: 'project_communications', model: 'ProjectCommunication', category: 'communication', where: (org) => ({ project: activeProject(org) }), description: 'Email tracked against projects' },
  { name: 'unmatched_emails', model: 'UnmatchedEmail', category: 'communication', where: (org) => ({ organizationId: org }), omit: ['rawEmail', 'inboundDeliveryKey'], description: 'Inbound email not yet matched to a client' },
  { name: 'email_triage_items', model: 'EmailTriageItem', category: 'communication', where: (org) => ({ organizationId: org }), description: 'Email triage items' },
  { name: 'email_triage_drafts', model: 'EmailTriageDraft', category: 'communication', where: (org) => ({ item: { organizationId: org } }), description: 'Email triage reply drafts' },
  { name: 'assistant_conversations', model: 'AshConversation', category: 'communication', where: (org) => ({ organizationId: org }), description: 'Assistant conversations' },
  { name: 'assistant_messages', model: 'AshChatMessage', category: 'communication', where: (org) => ({ conversation: { organizationId: org } }), description: 'Assistant conversation messages' },
  { name: 'ai_team_messages', model: 'AiTeamMessage', category: 'communication', where: (org) => ({ OR: [{ client: activeClient(org) }, { clientId: null, project: activeProject(org) }] }), description: 'AI team chat messages about clients/projects' },

  // Media review
  { name: 'review_sessions', model: 'ReviewSession', category: 'media_review', where: reviewScope, description: 'Media review sessions' },
  { name: 'review_annotations', model: 'ReviewAnnotation', category: 'media_review', where: (org) => ({ session: reviewScope(org) }), description: 'Review comments and markup' },
  { name: 'review_decisions', model: 'ReviewDecision', category: 'media_review', where: (org) => ({ session: reviewScope(org) }), description: 'Approval decisions (append-only evidence)' },
  { name: 'review_share_links', model: 'ReviewShareLink', category: 'media_review', where: (org) => ({ session: reviewScope(org) }), omit: ['tokenHash'], description: 'Client share links (metadata only)' },

  // Files
  { name: 'attachments', model: 'Attachment', category: 'files', where: (org) => ({ organizationId: org }), description: 'Uploaded file metadata; the files themselves are under files/attachments/' },
]);

/**
 * Whole models that are never exported, with the reason. Together with
 * EXPORT_ENTITIES this must cover every model in prisma/schema.prisma (a unit
 * test enforces it), so a new model is a deliberate export decision.
 * @type {Readonly<Record<string, string>>}
 */
export const EXCLUDED_MODELS = Object.freeze({
  ApiKey: 'secret: API keys are stored as SHA-256 hashes of bearer credentials',
  Credential: 'secret: credential-vault passwords are AES-256-GCM ciphertext under a platform key; export them item by item through the vault UI instead',
  CredentialAccessAudit: 'internal security ledger of vault reads',
  AiProviderConnection: 'secret: bring-your-own-key AI provider key (encrypted)',
  AiUsageRecord: 'internal metering ledger of AI calls',
  Integration: 'secret: accounting integration OAuth access/refresh tokens',
  GoogleCalendarConnection: 'secret: encrypted Google OAuth refresh token',
  SlackInstallation: 'secret: encrypted Slack bot token',
  SlackChannelMapping: 'integration configuration that only works with the Slack installation',
  SlackEventReceipt: 'internal idempotency ledger of Slack events',
  PushSubscription: 'secret: browser push subscription keys of individual devices',
  Notification: 'per-user in-app inbox derived from the exported records',
  ClientInvitation: 'secret: single-use client invitation tokens',
  ImpersonationSession: 'internal security ledger (support impersonation)',
  BreakGlassGrant: 'internal security ledger; stores recovery token hashes',
  AuditEvent: 'internal append-only audit ledger; available separately on request under the retention policy (#310)',
  DomainEvent: 'internal event outbox ledger',
  AiBridgeAction: 'internal AI tool approval and receipt ledger',
  DocumentNumberSequence: 'internal counter; invoice numbers are on the invoices themselves',
  TrashedItem: 'soft-deleted records awaiting purge; the export contains active records only',
  FormDraft: 'unsaved form autosave data',
  OnboardingProgress: 'product onboarding checklist state',
  ImportRun: 'internal migration-import ledger',
  NotionImportRecord: 'internal migration-import reconciliation ledger',
  SlackImportRecord: 'internal migration-import reconciliation ledger',
  LoomImportRecord: 'internal migration-import reconciliation ledger',
  MarkupImportRecord: 'internal migration-import reconciliation ledger',
  ClientEmbedding: 'derived vector index of exported text; regenerable',
  WeeklyDigest: 'derived AI summary of exported records',
  AiContext: 'internal AI configuration',
  PromptVersion: 'internal AI prompt configuration',
  WPSite: 'WordPress bridge removed 2026-09-24; tables retained unread pending the retention decision (#310); rows carry bridge secrets',
  WPBackup: 'WordPress bridge removed; retained unread pending #310',
  WPReport: 'WordPress bridge removed; retained unread pending #310',
  WPAlert: 'WordPress bridge removed; retained unread pending #310',
  WPFleetOp: 'WordPress bridge removed; internal fleet operations ledger',
  WPMagicLoginLog: 'WordPress bridge removed; stores magic-login token hashes',
  WPBridgeNonce: 'WordPress bridge removed; replay-protection hashes',
  PlatformSetting: 'deployment-wide setting shared by every organization',
  MailgunWebhookReceipt: 'global replay guard with no tenant data',
  ClientPortalLinkRedemption: 'global replay guard with no tenant data',
  EmailWebhookReceipt: 'global replay guard with no tenant data',
});

/** Why each omitted column is left out; keyed by column name. */
export const EXCLUDED_FIELD_REASONS = Object.freeze({
  password: 'secret: password hash',
  resetToken: 'secret: password reset token',
  resetTokenExpiresAt: 'belongs to the password reset token',
  mfaSecret: 'secret: encrypted TOTP secret',
  mfaRecoveryCodes: 'secret: MFA recovery code hashes',
  mfaLastUsedStep: 'internal MFA replay state',
  mfaFailedAttempts: 'internal MFA lockout state',
  mfaLockedUntil: 'internal MFA lockout state',
  sessionVersion: 'internal session revocation counter',
  viewToken: 'secret: public link capability',
  signToken: 'secret: public signing link capability',
  tokenHash: 'secret: share link token hash',
  draftData: 'unsaved form autosave data',
  rawEmail: 'verbatim MIME source; the parsed subject, bodies and headers are exported',
  inboundDeliveryKey: 'internal inbound email idempotency key',
  idempotencyKey: 'internal request idempotency key',
  payloadHash: 'internal request idempotency hash',
});

/**
 * Column names that look secret but are integrity evidence the customer
 * needs (content digests, signature evidence), so they are exported.
 */
export const EXPORTED_DIGEST_FIELDS = Object.freeze(new Set([
  'clientSigHash', 'signedContentHash', 'signatureDataHash',
]));

export const SECRET_FIELD_PATTERN = /(password|secret|token|hash|encrypted|apikey|recovery|^key$|^keys$|nonce)/i;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments. Returns `{ error }` for invalid input.
 * Directory mode: --organization-id <id> --output-dir <dir> [--include-files|--no-files] [--uploads-dir <dir>] [--page-size <n>]
 * Legacy mode (v2 single JSON file): --organization-id <id> --output <file.json> --confirm
 * @param {string[]} argv arguments after the script path
 * @param {Record<string, string | undefined>} [env]
 */
export function parseExportArgs(argv, env = {}) {
  const valueFlags = new Set(['--organization-id', '--output-dir', '--output', '--uploads-dir', '--page-size']);
  const boolFlags = new Set(['--include-files', '--no-files', '--confirm']);
  /** @type {Record<string, string>} */
  const values = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueFlags.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (values[arg] !== undefined) return { error: `${arg} given more than once` };
      values[arg] = value;
      i += 1;
    } else if (boolFlags.has(arg)) {
      flags.add(arg);
    } else {
      return { error: `Unknown argument: ${arg}` };
    }
  }
  const organizationId = values['--organization-id'] || env.EXPORT_ORGANIZATION_ID;
  if (!organizationId) return { error: '--organization-id is required' };
  if (flags.has('--include-files') && flags.has('--no-files')) return { error: '--include-files and --no-files are mutually exclusive' };
  if (values['--output-dir'] && values['--output']) return { error: '--output-dir and --output are mutually exclusive' };
  if (values['--output']) {
    if (!flags.has('--confirm')) return { error: 'Legacy --output mode requires --confirm' };
    return { mode: 'legacy', organizationId, output: values['--output'] };
  }
  if (!values['--output-dir']) return { error: '--output-dir is required' };
  let pageSize = DEFAULT_PAGE_SIZE;
  if (values['--page-size'] !== undefined) {
    pageSize = Number(values['--page-size']);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) return { error: `--page-size must be an integer between 1 and ${MAX_PAGE_SIZE}` };
  }
  return {
    mode: 'directory',
    organizationId,
    outputDir: values['--output-dir'],
    includeFiles: !flags.has('--no-files'),
    uploadsDir: values['--uploads-dir'] ?? null,
    pageSize,
  };
}

/**
 * Map a stored upload path (`/uploads/<name>`) to a file under `uploadsDir`.
 * Anything else (remote URLs, quarantined files, traversal) is an exception
 * code rather than a path.
 * @param {unknown} storedPath
 * @param {string} uploadsDir absolute upload root
 * @returns {{ absolutePath: string } | { code: string, detail: string }}
 */
export function resolveStoredUploadPath(storedPath, uploadsDir) {
  if (typeof storedPath !== 'string' || storedPath.length === 0) return { code: 'FILE_PATH_MISSING', detail: 'The record has no stored file path' };
  if (!storedPath.startsWith('/uploads/')) return { code: 'FILE_NOT_LOCAL', detail: 'The file is not stored in local uploads (for example a remote URL); it was not copied' };
  const invalid = { code: 'FILE_PATH_INVALID', detail: 'The stored path is not a file name the application writes; it was not copied' };
  const raw = storedPath.slice('/uploads/'.length);
  if (!raw || raw.includes('\0') || raw.includes('\\')) return invalid;
  // Decide on the normalized path, so `./quarantine/x` is still quarantined.
  const relative = path.posix.normalize(raw);
  if (relative === 'quarantine' || relative.startsWith('quarantine/')) return { code: 'FILE_QUARANTINED', detail: 'The file failed the upload policy and is quarantined; it was not copied' };
  // The application writes flat names (`<uuid>.<ext>`), plus brand logos
  // under `brand/`. Anything nested deeper, hidden or relative is refused, so
  // a symlinked sub-directory can never be traversed.
  const segments = relative.split('/');
  const nameOk = (segment) => SAFE_UPLOAD_SEGMENT.test(segment);
  const allowed = (segments.length === 1 && nameOk(segments[0]))
    || (segments.length === 2 && ALLOWED_UPLOAD_SUBDIRS.has(segments[0]) && nameOk(segments[1]));
  if (!allowed) return invalid;
  const root = path.resolve(uploadsDir);
  const absolutePath = path.resolve(root, relative);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) return invalid;
  return { absolutePath };
}

/**
 * A portable file name for the export: basename only, conservative character
 * set, no leading dots, bounded length.
 * @param {unknown} name
 */
export function safeExportFileName(name) {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'));
  let safe = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[.\s]+/, '').trim();
  if (safe.length > 150) {
    const ext = path.extname(safe).slice(0, 20);
    safe = `${safe.slice(0, 150 - ext.length)}${ext}`;
  }
  return safe || 'file';
}

/** JSON.stringify replacer: BigInt columns become decimal strings. */
export function exportJsonReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** One JSONL line for a row. */
export function serializeRow(row) {
  return `${JSON.stringify(row, exportJsonReplacer)}\n`;
}

/** Prisma `omit` argument for an entity, or undefined. */
export function omitArgs(entity) {
  if (!entity.omit || entity.omit.length === 0) return undefined;
  return Object.fromEntries(entity.omit.map((field) => [field, true]));
}

/**
 * The exclusions list written to the manifest.
 */
export function buildExclusions() {
  const fields = [];
  for (const entity of EXPORT_ENTITIES) {
    for (const field of entity.omit ?? []) {
      fields.push({ scope: 'field', entity: entity.name, field, reason: EXCLUDED_FIELD_REASONS[field] ?? 'excluded' });
    }
  }
  return [
    ...Object.entries(EXCLUDED_MODELS).map(([model, reason]) => ({ scope: 'model', model, reason })),
    ...fields,
    { scope: 'rows', target: 'soft-deleted records', reason: 'records in the trash (deletedAt set), and children of trashed clients/projects, are not exported' },
    { scope: 'rows', target: 'unattributable rows', reason: 'rows with no relation to this organization (for example untriaged threads with neither client nor project, or global rate cards) cannot be proven to belong to it and are not exported' },
    { scope: 'rows', target: 'other organizations', reason: 'every query is filtered by this organization id' },
  ];
}

/**
 * Build a Prisma where clause for the next page after `cursor` (keyset).
 * @param {object} where
 * @param {string | null} cursor
 */
export function pageWhere(where, cursor) {
  return cursor ? { AND: [where, { id: { gt: cursor } }] } : where;
}

/** Relative export path of a copied file. */
export function exportFilePath(kind, recordId, name) {
  return `files/${kind}/${safeExportFileName(recordId)}/${safeExportFileName(name)}`;
}

/**
 * `sha256sum -c` line (two spaces, text mode).
 * @param {string} sha256
 * @param {string} relativePath
 */
export function checksumLine(sha256, relativePath) {
  return `${sha256}  ${relativePath}\n`;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/**
 * Create the output directory, or accept an existing empty one. A non-empty
 * existing directory (or a file at that path) is refused.
 * @param {string} outputDir
 */
export async function prepareOutputDir(outputDir) {
  const target = path.resolve(outputDir);
  let stat = null;
  try { stat = await fsp.lstat(target); } catch (error) { if (/** @type {any} */ (error).code !== 'ENOENT') throw error; }
  if (stat) {
    if (!stat.isDirectory()) throw new Error(`Refusing to write: ${target} exists and is not a directory`);
    const entries = await fsp.readdir(target);
    if (entries.length > 0) throw new Error(`Refusing to write into non-empty directory: ${target}`);
    await fsp.chmod(target, DIR_MODE);
  } else {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      // Not recursive: if anything appeared at this path since the check
      // above, refuse instead of writing into it.
      await fsp.mkdir(target, { mode: DIR_MODE });
    } catch (error) {
      if (/** @type {any} */ (error).code === 'EEXIST') throw new Error(`Refusing to write: ${target} was created by something else during preparation`);
      throw error;
    }
  }
  const created = await fsp.lstat(target);
  if (!created.isDirectory() || (typeof process.getuid === 'function' && created.uid !== process.getuid())) {
    throw new Error(`Refusing to write: ${target} is not a directory owned by this user`);
  }
  return target;
}

class JsonlWriter {
  /** @param {string} filePath */
  constructor(filePath) {
    this.stream = fs.createWriteStream(filePath, { flags: 'wx', mode: FILE_MODE });
    this.hash = crypto.createHash('sha256');
    this.rows = 0;
    this.bytes = 0;
    /** @type {Error | null} */
    this.error = null;
    // A write error (a full disk, for example) must fail the export through
    // the caller, never as an unhandled 'error' event that kills the process.
    this.stream.on('error', (error) => { this.error = error; });
  }

  /** @param {object} row */
  async write(row) {
    if (this.error) throw this.error;
    const line = serializeRow(row);
    const buffer = Buffer.from(line, 'utf8');
    this.hash.update(buffer);
    this.rows += 1;
    this.bytes += buffer.length;
    if (!this.stream.write(buffer)) await once(this.stream, 'drain');
  }

  async close() {
    if (this.error) throw this.error;
    this.stream.end();
    await once(this.stream, 'finish');
    if (this.error) throw this.error;
    return { rows: this.rows, bytes: this.bytes, sha256: this.hash.digest('hex') };
  }
}

/** @param {string} filePath */
export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Copy one stored file into the export and verify the copy by re-hashing it.
 * @param {{ outputDir: string, uploadsDir: string, source: string, recordId: string, storedPath: unknown, name?: string | null, expectedSize?: number, mimeType?: string | null }} options
 * @returns {Promise<{ entry?: object, exception?: object }>}
 */
async function copyStoredFile({ outputDir, uploadsDir, source, recordId, storedPath, name, expectedSize, mimeType }) {
  const resolved = resolveStoredUploadPath(storedPath, uploadsDir);
  const base = { source, recordId, storedPath: typeof storedPath === 'string' ? storedPath : null };
  if ('code' in resolved) return { exception: { ...base, code: resolved.code, detail: resolved.detail } };
  let stat;
  try {
    stat = await fsp.lstat(resolved.absolutePath);
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') return { exception: { ...base, code: 'FILE_MISSING', detail: 'The stored file does not exist in the upload directory' } };
    return { exception: { ...base, code: 'FILE_UNREADABLE', detail: String(/** @type {any} */ (error).code || 'read error') } };
  }
  const notRegular = { exception: { ...base, code: 'FILE_NOT_REGULAR', detail: 'The stored path is not a regular file (for example a symbolic link); it was not copied' } };
  if (!stat.isFile()) return notRegular;
  const unreadable = (error) => ({ exception: { ...base, code: 'FILE_UNREADABLE', detail: String(/** @type {any} */ (error)?.code || 'read error') } });

  // The real path must still be inside the real upload root: no symlinked
  // directory on the way.
  try {
    const [realFile, realRoot] = await Promise.all([fsp.realpath(resolved.absolutePath), fsp.realpath(uploadsDir)]);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return notRegular;
  } catch (error) {
    return unreadable(error);
  }

  const exportPath = exportFilePath(source === 'attachment' ? 'attachments' : source === 'brand_logo' ? 'brand' : 'expense-receipts', recordId, name);
  const destination = path.join(outputDir, exportPath);
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: DIR_MODE });
  const sourceHash = crypto.createHash('sha256');
  let sourceBytes = 0;
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let handle;
  try {
    // O_NOFOLLOW plus fstat on the open descriptor: the file that is copied is
    // the regular file that was checked, even if the path changes meanwhile.
    handle = await fsp.open(resolved.absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    if (!(await handle.stat()).isFile()) { await handle.close(); return notRegular; }
    const reader = handle.createReadStream();
    handle = undefined; // the stream owns and closes the descriptor now
    reader.on('data', (chunk) => { sourceHash.update(chunk); sourceBytes += chunk.length; });
    await pipeline(reader, fs.createWriteStream(destination, { flags: 'wx', mode: FILE_MODE }));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fsp.rm(destination, { force: true });
    if (/** @type {any} */ (error)?.code === 'ELOOP') return notRegular;
    return unreadable(error);
  }
  const sha256 = sourceHash.digest('hex');
  const copied = await sha256File(destination);
  if (copied.sha256 !== sha256 || copied.bytes !== sourceBytes) {
    await fsp.rm(destination, { force: true });
    return { exception: { ...base, code: 'FILE_COPY_MISMATCH', detail: 'The copied file did not match the source SHA-256; it was removed from the export' } };
  }
  const entry = { source, recordId, exportPath, originalName: name ?? null, mimeType: mimeType ?? null, size: sourceBytes, sha256 };
  if (Number.isInteger(expectedSize) && expectedSize !== sourceBytes) {
    return { entry, exception: { ...base, code: 'FILE_SIZE_MISMATCH', detail: `The recorded size is ${expectedSize} bytes but the stored file has ${sourceBytes} bytes; the stored file was copied as is` } };
  }
  return { entry };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function delegateFor(prisma, model) {
  const delegate = prisma[model.charAt(0).toLowerCase() + model.slice(1)];
  if (!delegate || typeof delegate.findMany !== 'function') throw new Error(`No Prisma delegate for model ${model}`);
  return delegate;
}

/**
 * Stream every row of an entity for one organization, in id order.
 * @param {any} prisma
 * @param {EntitySpec} entity
 * @param {string} organizationId
 * @param {number} pageSize
 */
export async function* paginateEntity(prisma, entity, organizationId, pageSize = DEFAULT_PAGE_SIZE) {
  const delegate = delegateFor(prisma, entity.model);
  const where = entity.where(organizationId);
  const omit = omitArgs(entity);
  let cursor = null;
  for (;;) {
    const rows = await delegate.findMany({ where: pageWhere(where, cursor), ...(omit ? { omit } : {}), orderBy: { id: 'asc' }, take: pageSize });
    for (const row of rows) yield row;
    if (rows.length < pageSize) return;
    cursor = rows[rows.length - 1].id;
  }
}

export function renderReadme({ organization, generatedAt, includeFiles }) {
  const entityLines = EXPORT_ENTITIES.map((entity) => `| \`data/${entity.name}.jsonl\` | ${entity.category} | ${entity.description} |`).join('\n');
  return `# Ashbi Hub workspace export

Organization: ${organization.name} (\`${organization.id}\`)
Generated: ${generatedAt}
Format: ${EXPORT_FORMAT} version ${EXPORT_FORMAT_VERSION}

This directory is a complete export of your organization's business data in
Ashbi Hub${includeFiles ? ', including the files you uploaded' : ' (files were not included in this export)'}.

## Layout

- \`manifest.json\`: what is in the export: row counts and SHA-256 of every
  data file, SHA-256 and size of every copied file, what was deliberately
  excluded (\`exclusions\`) and anything that could not be exported
  (\`exceptions\`, for example a file missing from storage).
- \`SHA256SUMS\`: checksums of every other file; verify with
  \`sha256sum -c SHA256SUMS\` (or \`shasum -a 256 -c SHA256SUMS\` on macOS).
- \`data/<entity>.jsonl\`: one JSON object per line, one file per record type.
  Every record keeps its original \`id\`; fields ending in \`Id\` refer to
  records in the other files (for example \`tasks.projectId\` to \`projects.id\`).
  Dates are ISO 8601 UTC; very large integers are strings.
- \`files/attachments/<attachmentId>/<file name>\`: uploaded files, listed in
  \`data/attachments.jsonl\` and in \`manifest.json\` \`files\`.
- \`files/expense-receipts/<expenseId>/<file name>\`: uploaded expense receipts.

## Record types

| File | Area | Contents |
| --- | --- | --- |
${entityLines}

## Not included

Secrets and credentials are never exported: password hashes, MFA secrets,
API keys, OAuth and integration tokens, encrypted credential-vault entries,
AI provider keys, session and share-link tokens. Internal system ledgers
(audit log, event outbox, import ledgers) and records in the trash are also
left out. \`manifest.json\` \`exclusions\` lists every excluded table and column
with the reason.

## Reading the data

JSONL opens in most data tools. For example, with Python:
\`pandas.read_json("data/invoices.jsonl", lines=True)\`, or with jq:
\`jq -s . data/clients.jsonl\` to get a JSON array.
`;
}

/**
 * Export one organization into `outputDir`.
 * @param {{ prisma: any, organizationId: string, outputDir: string, includeFiles?: boolean, uploadsDir?: string, pageSize?: number, now?: () => Date, snapshot?: boolean }} options
 */
export async function exportWorkspace({ prisma, organizationId, outputDir, includeFiles = true, uploadsDir, pageSize = DEFAULT_PAGE_SIZE, now = () => new Date(), snapshot = true }) {
  if (!organizationId) throw new Error('organizationId is required');
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } });
  if (!organization) throw new Error(`Organization not found: ${organizationId}`);
  const target = await prepareOutputDir(outputDir);
  const uploadRoot = path.resolve(uploadsDir ?? path.join(process.cwd(), 'uploads'));
  const generatedAt = now().toISOString();
  await fsp.mkdir(path.join(target, 'data'), { mode: DIR_MODE });

  const run = async (db) => {
    const entities = [];
    const files = [];
    const exceptions = [];
    const record = (result) => {
      if (result.entry) files.push(result.entry);
      if (result.exception) exceptions.push(result.exception);
    };
    for (const entity of EXPORT_ENTITIES) {
      const relative = `data/${entity.name}.jsonl`;
      const writer = new JsonlWriter(path.join(target, relative));
      try {
        for await (const row of paginateEntity(db, entity, organizationId, pageSize)) {
          await writer.write(row);
          if (!includeFiles) continue;
          if (entity.name === 'attachments') {
            record(await copyStoredFile({ outputDir: target, uploadsDir: uploadRoot, source: 'attachment', recordId: row.id, storedPath: row.path, name: row.originalName || row.filename, expectedSize: row.size, mimeType: row.mimeType }));
          } else if (entity.name === 'expenses' && typeof row.receiptUrl === 'string' && row.receiptUrl.startsWith('/uploads/')) {
            if (RECEIPT_FILE_NAME.test(row.receiptUrl.slice('/uploads/'.length))) {
              record(await copyStoredFile({ outputDir: target, uploadsDir: uploadRoot, source: 'expense_receipt', recordId: row.id, storedPath: row.receiptUrl, name: path.posix.basename(row.receiptUrl) }));
            } else {
              record({ exception: { source: 'expense_receipt', recordId: row.id, storedPath: row.receiptUrl, code: 'FILE_NOT_RECEIPT', detail: 'The receipt path is not a receipt name the application writes; it was not copied' } });
            }
          } else if (entity.name === 'brand_settings' && typeof row.logoUrl === 'string' && row.logoUrl.startsWith('/uploads/')) {
            record(await copyStoredFile({ outputDir: target, uploadsDir: uploadRoot, source: 'brand_logo', recordId: row.id, storedPath: row.logoUrl, name: path.posix.basename(row.logoUrl) }));
          }
        }
      } finally {
        const summary = await writer.close();
        entities.push({ name: entity.name, model: entity.model, category: entity.category, file: relative, ...summary });
      }
    }
    return { entities, files, exceptions };
  };

  const { entities, files, exceptions } = snapshot
    ? await prisma.$transaction(async (tx) => run(tx), { isolationLevel: 'RepeatableRead', timeout: 6 * 60 * 60 * 1000, maxWait: 60_000 })
    : await run(prisma);

  const readme = renderReadme({ organization, generatedAt, includeFiles });
  await fsp.writeFile(path.join(target, 'README.md'), readme, { flag: 'wx', mode: FILE_MODE });

  const manifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    organization,
    organizationId: organization.id,
    generatedAt,
    generator: 'scripts/export-workspace.js',
    snapshot: snapshot ? 'repeatable-read transaction' : 'none',
    includeFiles,
    entities,
    files,
    exclusions: buildExclusions(),
    exceptions,
    totals: {
      entities: entities.length,
      rows: entities.reduce((sum, entity) => sum + entity.rows, 0),
      files: files.length,
      fileBytes: files.reduce((sum, file) => sum + file.size, 0),
      exceptions: exceptions.length,
    },
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await fsp.writeFile(path.join(target, 'manifest.json'), manifestText, { flag: 'wx', mode: FILE_MODE });

  const readmeSha = crypto.createHash('sha256').update(readme).digest('hex');
  const manifestSha = crypto.createHash('sha256').update(manifestText).digest('hex');
  const sums = [
    checksumLine(readmeSha, 'README.md'),
    checksumLine(manifestSha, 'manifest.json'),
    ...entities.map((entity) => checksumLine(entity.sha256, entity.file)),
    ...files.map((file) => checksumLine(file.sha256, file.exportPath)),
  ].join('');
  await fsp.writeFile(path.join(target, 'SHA256SUMS'), sums, { flag: 'wx', mode: FILE_MODE });

  return { outputDir: target, manifest, manifestSha256: manifestSha };
}

// ---------------------------------------------------------------------------
// Offline verification of a directory export
// ---------------------------------------------------------------------------

async function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of await fsp.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(root, relative));
    else out.push(relative);
  }
  return out;
}

async function countLines(filePath) {
  let lines = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    for (let i = 0; i < chunk.length; i += 1) if (chunk[i] === 0x0a) lines += 1;
  }
  return lines;
}

/**
 * Verify a directory export without a database. `SHA256SUMS` must list every
 * file present (and nothing else) with a matching hash, which covers
 * `manifest.json` and `README.md`; every data file and copied file must also
 * match the manifest (row count, size, SHA-256), the manifest totals must
 * match its lists, and no manifest path may leave the export. Pass the
 * manifest SHA-256 printed by the export to also detect a rewritten
 * manifest together with its checksum list.
 * @param {string} inputDir
 * @param {{ expectedManifestSha256?: string | null }} [options]
 */
export async function verifyWorkspaceExportDirectory(inputDir, { expectedManifestSha256 = null } = {}) {
  const root = path.resolve(inputDir);
  const findings = [];
  const inside = (relative) => {
    if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) return false;
    const resolved = path.resolve(root, relative);
    return resolved.startsWith(`${root}${path.sep}`);
  };

  let manifestText;
  let manifest;
  try {
    manifestText = await fsp.readFile(path.join(root, 'manifest.json'), 'utf8');
    manifest = JSON.parse(manifestText);
  } catch {
    return { valid: false, findings: [{ code: 'MANIFEST_MISSING' }] };
  }
  if (manifest?.format !== EXPORT_FORMAT || manifest?.formatVersion !== EXPORT_FORMAT_VERSION || !Array.isArray(manifest.entities) || !Array.isArray(manifest.files)) {
    return { valid: false, findings: [{ code: 'EXPORT_FORMAT_INVALID' }] };
  }
  const manifestSha256 = crypto.createHash('sha256').update(manifestText).digest('hex');
  if (expectedManifestSha256 && expectedManifestSha256.toLowerCase() !== manifestSha256) {
    findings.push({ code: 'MANIFEST_CHECKSUM_MISMATCH', expected: expectedManifestSha256, actual: manifestSha256 });
  }

  // SHA256SUMS: the complete list of files, each with its hash.
  /** @type {Map<string, string>} */
  const sums = new Map();
  try {
    for (const line of (await fsp.readFile(path.join(root, 'SHA256SUMS'), 'utf8')).split('\n')) {
      if (!line) continue;
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      if (!match || !inside(match[2]) || sums.has(match[2])) { findings.push({ code: 'CHECKSUM_LIST_INVALID', line }); continue; }
      sums.set(match[2], match[1]);
    }
  } catch {
    findings.push({ code: 'CHECKSUM_LIST_MISSING', file: 'SHA256SUMS' });
  }

  const expected = new Set(['manifest.json', 'README.md', 'SHA256SUMS']);
  for (const entity of manifest.entities) {
    if (!inside(entity?.file)) { findings.push({ code: 'MANIFEST_PATH_INVALID', file: entity?.file ?? null }); continue; }
    expected.add(entity.file);
    const filePath = path.join(root, entity.file);
    try {
      const { sha256, bytes } = await sha256File(filePath);
      const rows = await countLines(filePath);
      if (sha256 !== entity.sha256) findings.push({ code: 'DATA_CHECKSUM_MISMATCH', file: entity.file });
      if (bytes !== entity.bytes) findings.push({ code: 'DATA_SIZE_MISMATCH', file: entity.file });
      if (rows !== entity.rows) findings.push({ code: 'DATA_ROW_COUNT_MISMATCH', file: entity.file, expected: entity.rows, actual: rows });
    } catch {
      findings.push({ code: 'DATA_FILE_MISSING', file: entity.file });
    }
  }
  for (const file of manifest.files) {
    if (!inside(file?.exportPath)) { findings.push({ code: 'MANIFEST_PATH_INVALID', file: file?.exportPath ?? null }); continue; }
    expected.add(file.exportPath);
    try {
      const { sha256, bytes } = await sha256File(path.join(root, file.exportPath));
      if (sha256 !== file.sha256) findings.push({ code: 'FILE_CHECKSUM_MISMATCH', file: file.exportPath });
      if (bytes !== file.size) findings.push({ code: 'FILE_SIZE_MISMATCH', file: file.exportPath });
    } catch {
      findings.push({ code: 'FILE_MISSING', file: file.exportPath });
    }
  }

  const totals = manifest.totals ?? {};
  const actualTotals = {
    entities: manifest.entities.length,
    rows: manifest.entities.reduce((sum, entity) => sum + (Number(entity?.rows) || 0), 0),
    files: manifest.files.length,
    fileBytes: manifest.files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0),
    exceptions: Array.isArray(manifest.exceptions) ? manifest.exceptions.length : 0,
  };
  for (const [key, value] of Object.entries(actualTotals)) {
    if (totals[key] !== value) findings.push({ code: 'MANIFEST_TOTALS_MISMATCH', field: key, expected: totals[key] ?? null, actual: value });
  }

  const present = new Set(await listFiles(root));
  for (const file of present) {
    if (!expected.has(file)) findings.push({ code: 'UNEXPECTED_FILE', file });
  }
  for (const file of ['README.md', 'SHA256SUMS']) {
    if (!present.has(file)) findings.push({ code: 'FILE_MISSING', file });
  }
  // Every file except SHA256SUMS itself must be listed, with a matching hash.
  for (const file of present) {
    if (file === 'SHA256SUMS') continue;
    const listed = sums.get(file);
    if (!listed) { findings.push({ code: 'CHECKSUM_NOT_LISTED', file }); continue; }
    const { sha256 } = await sha256File(path.join(root, file));
    if (sha256 !== listed) findings.push({ code: 'CHECKSUM_LIST_MISMATCH', file });
  }
  for (const file of sums.keys()) {
    if (!present.has(file)) findings.push({ code: 'CHECKSUM_LISTED_FILE_MISSING', file });
  }
  return { valid: findings.length === 0, findings, manifestSha256, totals: manifest.totals, exceptions: actualTotals.exceptions };
}
