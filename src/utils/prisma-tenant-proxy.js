import logger from './logger.js';
import { withSoftDelete } from '../services/soft-delete.service.js';
import { relationsFor } from './tenant-relations.js';

/**
 * Enterprise Scoped Prisma Proxy with Soft Delete + Tenant Isolation
 *
 * Wraps every Prisma query with two layers:
 *  1. Tenant isolation — auto-injects an `organizationId` filter (direct
 *     for `client`/`project`/`user`, or via a relation-chain for every
 *     other multi-tenant model in the schema).
 *  2. Soft-delete — wraps `delete`/`deleteMany` so they become
 *     `update { deletedAt: now() }` and adds `deletedAt: null` filters
 *     to reads.
 *
 * Tenant isolation routes by walking the relation chain to Client. The
 * `TENANT_PATHS` map below says "to scope model X, filter on its
 * `via` relation, which itself must satisfy the deeper organizationId
 * filter". This is equivalent to `where: { [via]: { ...traversal } }`.
 *
 * IMPORTANT: this is the *primary* defence for cross-tenant isolation.
 * Routes that bypass `request.prisma` (e.g. importing the raw `prisma`
 * from `config/db.js` in a service) bypass scoping — `tenancy.js` is
 * the only call site that calls `createScopedPrisma`, so anything
 * outside route handlers stays unscoped by design (auth flows need raw
 * access).
 */

// Models that have a direct `organizationId` column. These get the
// `where.organizationId = <jwt.orgId>` auto-inject (same as before).
const DIRECT_SCOPED_MODELS = new Set([
  'client', 'project', 'user', 'integration', 'trasheditem', 'attachment', 'formdraft',
  'wpsite', 'wpbackup', 'wpreport', 'wpalert', 'wpfleetop',
  'wpmagicloginlog', 'wpbridgenonce', 'supporthourentry',
  'assignmentrule', 'template', 'unmatchedemail', 'lineitemtemplate',
  'weeklydigest', 'tasktemplate', 'outreachsequence', 'emailtriageitem',
  'aicontext', 'ashconversation', 'projecttemplate', 'brandsettings',
  'pipelinestage', 'promptversion', 'credential', 'credentialaccessaudit',
  'onboardingprogress', 'slackinstallation', 'slackchannelmapping', 'slackeventreceipt', 'googlecalendarconnection', 'notionimportrecord', 'importrun', 'slackimportrecord', 'aibridgeaction',
  'publicinquiry', 'auditevent', 'aiproviderconnection', 'aiusagerecord',
  'reviewsession'
]);

// Evidence tables that may only ever be appended to. Request-scoped code gets
// no update/upsert/delete path for them; the database enforces the same rule
// with triggers (see prisma/migrations/*_audit_events).
const APPEND_ONLY_MODELS = new Set(['auditevent', 'reviewdecision']);
const APPEND_ONLY_BLOCKED_METHODS = new Set([
  'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany',
]);

// Models that are intentionally shared across organizations. Every Prisma
// model must be present here, DIRECT_SCOPED_MODELS, or TENANT_PATHS; an
// unclassified delegate is rejected instead of silently bypassing tenancy.
// mailgunwebhookreceipt only stores Mailgun's random webhook tokens for replay
// protection and is written from the unauthenticated, signed webhook route.
// platformsetting is the single deployment-wide settings row (AI kill switch);
// only platform operators write it (settings.routes.js).
// clientportallinkredemption only stores the random jti of redeemed portal
// magic links (single-use guard), written from the unauthenticated redeem route.
const GLOBAL_MODELS = new Set(['organization', 'mailgunwebhookreceipt', 'platformsetting', 'clientportallinkredemption']);

// Direct-owned records can also reference another tenant-owned root. The
// redundant organizationId is not enough: the referenced parent must belong
// to the same organization or the graph would span tenants.
const DIRECT_PARENT_RELATIONS = {
  project: [{ relation: 'client', field: 'clientId', model: 'client', delegate: 'client', required: true }],
  user: [{ relation: 'client', field: 'clientId', model: 'client', delegate: 'client' }],
  supporthourentry: [
    { relation: 'client', field: 'clientId', model: 'client', delegate: 'client' },
    { relation: 'project', field: 'projectId', model: 'project', delegate: 'project' },
  ],
  wpsite: [
    { relation: 'client', field: 'clientId', model: 'client', delegate: 'client' },
    { relation: 'project', field: 'projectId', model: 'project', delegate: 'project' },
  ],
  wpbackup: [{ relation: 'site', field: 'siteId', model: 'wpsite', delegate: 'wPSite', required: true }],
  wpreport: [{ relation: 'site', field: 'siteId', model: 'wpsite', delegate: 'wPSite', required: true }],
  wpalert: [{ relation: 'site', field: 'siteId', model: 'wpsite', delegate: 'wPSite' }],
  wpbridgenonce: [{ relation: 'site', field: 'siteId', model: 'wpsite', delegate: 'wPSite', required: true }],
  credential: [
    { relation: 'client', field: 'clientId', model: 'client', delegate: 'client' },
    { relation: 'project', field: 'projectId', model: 'project', delegate: 'project' },
  ],
  slackchannelmapping: [
    { relation: 'installation', field: 'installationId', model: 'slackinstallation', delegate: 'slackInstallation', required: true },
    { relation: 'project', field: 'projectId', model: 'project', delegate: 'project', required: true },
  ],
  slackeventreceipt: [
    { relation: 'installation', field: 'installationId', model: 'slackinstallation', delegate: 'slackInstallation', required: true },
  ],
  googlecalendarconnection: [{ relation: 'user', field: 'userId', model: 'user', delegate: 'user', required: true }],
  notionimportrecord: [{ relation: 'project', field: 'projectId', model: 'project', delegate: 'project', required: true }],
  slackimportrecord: [
    { relation: 'project', field: 'projectId', model: 'project', delegate: 'project', required: true },
    { relation: 'run', field: 'runId', model: 'importrun', delegate: 'importRun', required: true },
  ],
  aibridgeaction: [{ relation: 'user', field: 'userId', model: 'user', delegate: 'user', required: true }],
  onboardingprogress: [{ relation: 'user', field: 'userId', model: 'user', delegate: 'user', required: true }],
  publicinquiry: [{ relation: 'owner', field: 'ownerId', model: 'user', delegate: 'user' }],
  aiusagerecord: [{ relation: 'connection', field: 'connectionId', model: 'aiproviderconnection', delegate: 'aiProviderConnection', required: true }],
  // Media review (#417): the reviewed file and its project must be this
  // organization's, and so must the session a new version replaces.
  reviewsession: [
    { relation: 'project', field: 'projectId', model: 'project', delegate: 'project', required: true },
    { relation: 'attachment', field: 'attachmentId', model: 'attachment', delegate: 'attachment', required: true },
    { relation: 'previousSession', field: 'previousSessionId', model: 'reviewsession', delegate: 'reviewSession' },
  ],
};

const RESTRICTED_MODELS = new Set([]);

// Models without a direct `organizationId` column. Each entry maps the
// model to the chain of relations we need to walk to reach an owner
// (Client) that DOES have `organizationId`.
//
// Convention: each path is `[via, via-1, ..., client]`. The buildTenantWhere
// helper reads it back-to-front so the deepest relation ends up nesting
// `organizationId`.
//
// To add a new model: pick its FK that points (directly or transitively)
// toward Client, list the relations from this model to Client, add to
// this map. If a model has NO such FK path, it either belongs in the
// `DIRECT_SCOPED_MODELS` list (give it an organizationId column) or it
// is genuinely org-agnostic (a global config table — see PipelineStage,
// HermesEvent, etc., not in this map).
const TENANT_PATHS = {
  // 1-hop to Client (via clientId FK)
  contact:          ['client'],
  thread:           ['client'],
  invoice:          ['client'],
  proposal:         ['client'],
  contract:         ['client'],
  retainerplan:     ['client'],
  pipelinedeal:     ['client'],
  expense:          ['client'],
  clientembedding:  ['client'],
  report:           ['client'],
  aiteammessage:    ['client'],
  revenuesnapshot:  ['client'],
  clientemailmapping: ['client'],
  intakeform:       ['client'],
  creativebrief:    ['client'],
  asset:            ['client'],
  clientinvitation: ['client'],
  estimate:         ['client'],
  ratecard:         ['client'],

  // 1-hop to Project (via projectId FK, then project → client).
  // These models relate to Client through Project, NOT directly.
  note:             ['project', 'client'],
  projectcommunication: ['project', 'client'],
  chatmessage:      ['project', 'client'],
  revisionround:    ['project', 'client'],
  task:             ['project', 'client'],
  milestone:        ['project', 'client'],
  timesession:      ['project', 'client'],
  projectcontext:   ['project', 'client'],
  timeentry:        ['project', 'client'],
  activity:         ['project', 'client'],
  approval:         ['project', 'client'],

  // 1-hop to Thread (via threadId FK, then thread → client)
  message:          ['thread', 'client'],
  internalnote:     ['thread', 'client'],
  response:         ['thread', 'client'],

  // 1-hop to Invoice (via invoiceId FK, then invoice → client)
  invoicelineitem:  ['invoice', 'client'],
  invoicepayment:   ['invoice', 'client'],

  // 1-hop to Proposal (via proposalId FK, then proposal → client)
  proposallineitem: ['proposal', 'client'],
  proposalversion:  ['proposal', 'client'],

  // NOTE: brandSettings, emailTriageItem, unmatchedEmail and taskTemplate are
  // intentionally NOT scoped here — the current schema gives them no relation
  // path to an Organization (global config / templates / raw inbox tables).
  // Adding a dedicated organizationId column is the correct long-term fix.

  // 1-hop to Task (via taskId FK, then task → project → client)
  taskcomment:      ['task', 'project', 'client'],

  // 1-hop to User (via userId FK, then user → organizationId)
  notification:     ['user'],
  pushsubscription: ['user'],
  snippet:          ['createdBy'],
  apikey:           ['user'],

  // Calendar events may be personal, so scope through their required creator.
  calendarevent:    ['createdBy'],
  eventattendee:    ['event', 'createdBy'],
  chatreaction:     ['message', 'project', 'client'],
  emailtriagedraft: ['item'],
  ashchatmessage:   ['conversation'],
  intakeformresponse: ['form', 'client'],

  // Media review (#417): annotations, decisions and share links belong to a
  // review session, which carries organizationId directly.
  reviewannotation: ['session'],
  reviewdecision:   ['session'],
  reviewsharelink:  ['session'],
};

const RELATION_OWNER_MODELS = {
  client: { model: 'client', delegate: 'client' },
  project: { model: 'project', delegate: 'project' },
  thread: { model: 'thread', delegate: 'thread' },
  invoice: { model: 'invoice', delegate: 'invoice' },
  proposal: { model: 'proposal', delegate: 'proposal' },
  task: { model: 'task', delegate: 'task' },
  user: { model: 'user', delegate: 'user' },
  createdBy: { model: 'user', delegate: 'user' },
  event: { model: 'calendarevent', delegate: 'calendarEvent' },
  message: { model: 'chatmessage', delegate: 'chatMessage' },
  item: { model: 'emailtriageitem', delegate: 'emailTriageItem' },
  conversation: { model: 'ashconversation', delegate: 'ashConversation' },
  form: { model: 'intakeform', delegate: 'intakeForm' },
  session: { model: 'reviewsession', delegate: 'reviewSession' },
};

export const tenantModelPolicy = Object.freeze({
  ...Object.fromEntries([...DIRECT_SCOPED_MODELS].map((model) => [model, 'direct'])),
  ...Object.fromEntries(Object.keys(TENANT_PATHS).map((model) => [model, 'relation'])),
  ...Object.fromEntries([...GLOBAL_MODELS].map((model) => [model, 'global'])),
  ...Object.fromEntries([...RESTRICTED_MODELS].map((model) => [model, 'restricted'])),
});

/**
 * Build a Prisma `where` filter that scopes a query to a given
 * organizationId, by walking the relation chain in `path`.
 *
 * Example:
 *   buildTenantWhere(['project', 'client'], 'org_abc')
 *   → { project: { client: { organizationId: 'org_abc' } } }
 */
function buildTenantWhere(path, organizationId) {
  let result = { organizationId };
  for (let i = path.length - 1; i >= 0; i--) {
    result = { [path[i]]: result };
  }
  return result;
}

// Delegate methods a request-scoped client may call. Anything else (a method a
// future Prisma adds, or one this proxy has no scoping rule for) is refused
// instead of passing through unscoped.
const READ_METHODS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
]);
const CREATE_METHODS = new Set(['create', 'createMany', 'createManyAndReturn']);
const BULK_UPDATE_METHODS = new Set(['updateMany', 'updateManyAndReturn']);
const WRITE_METHODS = new Set([
  ...CREATE_METHODS, 'update', ...BULK_UPDATE_METHODS, 'upsert', 'delete', 'deleteMany',
]);
export const SCOPED_DELEGATE_METHODS = Object.freeze([...READ_METHODS, ...WRITE_METHODS]);

// Nested relation operations. Writes that create or upsert a *parent* record
// through a to-one relation, and connectOrCreate anywhere, cannot be verified
// before Prisma runs them, so they are refused in request scope.
const NESTED_TO_ONE_REFUSED = new Set(['create', 'connectOrCreate', 'upsert']);
const NESTED_TO_MANY_REFUSED = new Set(['connectOrCreate']);

/**
 * A tenant-isolation refusal. `statusCode` is what the API answers
 * (src/utils/http-errors.js): 404 for a record outside the organization, 400
 * for a missing owner, 500 for a policy/programming error. The message (with
 * ids) is for logs only and never reaches a client.
 */
export class TenancyError extends Error {
  constructor(message, statusCode = 500) {
    super(`Tenancy Error: ${message}`);
    this.name = 'TenancyError';
    this.code = 'TENANCY_VIOLATION';
    this.statusCode = statusCode;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A foreign-key scalar write: `'id'`, `{ set: 'id' }`, or null (no owner). */
function scalarKeyValue(value) {
  if (typeof value === 'string') return value;
  if (isPlainObject(value) && typeof value.set === 'string') return value.set;
  return null;
}

function describeWhere(where) {
  if (isPlainObject(where) && typeof where.id === 'string' && Object.keys(where).length === 1) return where.id;
  return JSON.stringify(where);
}

export function createScopedPrisma(prisma, organizationId) {
  if (!organizationId) {
    throw new TenancyError('organizationId is required for scoped queries');
  }

  // Apply soft-delete wrapper first, then tenant scoping
  const softPrisma = withSoftDelete(prisma);

  /** The where that proves a record of `modelKey` belongs to this organization. */
  function ownedWhere(modelKey, where) {
    if (DIRECT_SCOPED_MODELS.has(modelKey)) return { ...where, organizationId };
    return { AND: [where, buildTenantWhere(TENANT_PATHS[modelKey], organizationId)] };
  }

  /**
   * Prove that the record of `modelKey` matching `where` (a unique input)
   * belongs to this organization. Each distinct record is checked once per
   * call (`verified`).
   */
  async function verifyOwned(label, modelKey, where, verified) {
    if (!isPlainObject(where) || Object.keys(where).length === 0) {
      throw new TenancyError(`${label} reference is not a unique record`, 400);
    }
    const cacheKey = `${modelKey}:${JSON.stringify(where)}`;
    if (verified.has(cacheKey)) return;
    if (modelKey === 'organization') {
      if (where.id !== organizationId || Object.keys(where).length !== 1) {
        throw new TenancyError(`${label} ${describeWhere(where)} does not belong to organization ${organizationId}`, 404);
      }
      verified.add(cacheKey);
      return;
    }
    if (GLOBAL_MODELS.has(modelKey)) {
      throw new TenancyError(`${label} links a shared ${modelKey} record, which scoped writes may not do`);
    }
    if (!DIRECT_SCOPED_MODELS.has(modelKey) && !TENANT_PATHS[modelKey]) {
      throw new TenancyError(`${label} references ${modelKey}, which is not classified for tenant access`);
    }
    const meta = relationsFor(modelKey);
    const delegate = softPrisma[meta?.delegate ?? modelKey];
    if (!delegate || typeof delegate.findFirst !== 'function') {
      throw new TenancyError(`${label} references ${modelKey}, which cannot be verified`);
    }
    const owner = await delegate.findFirst({ where: ownedWhere(modelKey, where), select: { id: true } });
    if (!owner) {
      throw new TenancyError(`${label} ${describeWhere(where)} does not belong to organization ${organizationId}`, 404);
    }
    verified.add(cacheKey);
  }

  /**
   * Validate one row of write data for `modelKey`: every foreign-key scalar
   * and every nested relation write that points at a tenant-owned record must
   * stay inside this organization. Nested creates of direct-scoped models get
   * this organization injected, like top-level creates.
   */
  async function validateWriteData(modelKey, data, verified, { creating, nested = false }) {
    if (!isPlainObject(data)) return;
    const meta = relationsFor(modelKey);
    if (!meta) throw new TenancyError(`no relation metadata for ${modelKey}; the write cannot be validated`);
    if (nested && creating && DIRECT_SCOPED_MODELS.has(modelKey) && data.organization === undefined) {
      data.organizationId = organizationId;
    }

    for (const [key, value] of Object.entries(data)) {
      const relationName = meta.foreignKeys[key];
      if (relationName) {
        const ownerId = scalarKeyValue(value);
        if (ownerId === null) continue;
        await verifyOwned(relationName, meta.relations[relationName].target, { id: ownerId }, verified);
        continue;
      }
      const relation = meta.relations[key];
      if (!relation || value === undefined || value === null) continue;
      if (!isPlainObject(value)) {
        throw new TenancyError(`${modelKey}.${key} has an unsupported nested write`);
      }
      const toOne = relation.fk !== null;
      for (const [operation, operand] of Object.entries(value)) {
        if ((toOne ? NESTED_TO_ONE_REFUSED : NESTED_TO_MANY_REFUSED).has(operation)) {
          throw new TenancyError(`nested ${key}.${operation} is not allowed in scoped writes`);
        }
        switch (operation) {
          case 'connect':
          case 'set':
            for (const where of asList(operand)) await verifyOwned(key, relation.target, where, verified);
            break;
          case 'create':
            for (const row of asList(operand)) {
              await validateWriteData(relation.target, row, verified, { creating: true, nested: true });
            }
            break;
          case 'createMany':
            for (const row of asList(operand?.data)) {
              await validateWriteData(relation.target, row, verified, { creating: true, nested: true });
            }
            break;
          case 'update':
          case 'updateMany':
            for (const entry of asList(operand)) {
              // To-many (and filtered to-one) updates are { where, data };
              // a plain to-one update is the data itself.
              const rowData = isPlainObject(entry) && isPlainObject(entry.data) && (!toOne || entry.where !== undefined)
                ? entry.data
                : entry;
              await validateWriteData(relation.target, rowData, verified, { creating: false, nested: true });
            }
            break;
          case 'upsert':
            for (const entry of asList(operand)) {
              await validateWriteData(relation.target, entry?.create, verified, { creating: true, nested: true });
              await validateWriteData(relation.target, entry?.update, verified, { creating: false, nested: true });
            }
            break;
          case 'disconnect':
          case 'delete':
          case 'deleteMany':
            break;
          default:
            throw new TenancyError(`nested ${key}.${operation} is not supported in scoped writes`);
        }
      }
    }
  }

  /** Validate the data rows of a top-level write call. */
  async function validateWriteArgs(modelKey, methodName, queryArgs, verified) {
    if (methodName === 'upsert') {
      await validateWriteData(modelKey, queryArgs.create, verified, { creating: true });
      await validateWriteData(modelKey, queryArgs.update, verified, { creating: false });
      return;
    }
    if (CREATE_METHODS.has(methodName) || methodName === 'update' || BULK_UPDATE_METHODS.has(methodName)) {
      const creating = CREATE_METHODS.has(methodName);
      const rows = asList(queryArgs.data);
      if (creating) {
        // A batch may link rows it creates itself (a reply's parentId naming a
        // root in the same createMany). Those rows are created in this
        // organization, and each is validated below, so they count as owned.
        // Not with skipDuplicates: a skipped row could name an existing
        // record of another organization.
        for (const row of queryArgs.skipDuplicates ? [] : rows) {
          if (typeof row?.id === 'string') verified.add(`${modelKey}:${JSON.stringify({ id: row.id })}`);
        }
      }
      for (const row of rows) await validateWriteData(modelKey, row, verified, { creating });
    }
  }

  return new Proxy(softPrisma, {
    get(target, modelName) {
      if (modelName === Symbol.for('__proxy__')) return true;
      // Preserve both policies inside interactive transactions. Array-form
      // transactions already receive promises created through this proxy.
      if (modelName === '$transaction') {
        return (input, ...options) => {
          if (typeof input !== 'function') return target.$transaction(input, ...options);
          return target.$transaction(
            (transaction) => input(createScopedPrisma(transaction, organizationId)),
            ...options,
          );
        };
      }
      const model = target[modelName];

      // Not a Prisma model or non-object → return as-is (still has soft-delete)
      if (typeof model !== 'object' || model === null) return model;

      const modelKey = modelName.toLowerCase();
      const isDirect = DIRECT_SCOPED_MODELS.has(modelKey);
      const tenantPath = TENANT_PATHS[modelKey];

      if (GLOBAL_MODELS.has(modelKey)) return model;
      if (RESTRICTED_MODELS.has(modelKey)) {
        throw new TenancyError(`model ${String(modelName)} has no tenant owner and is unavailable in request scope`);
      }

      // Application model delegates must be classified explicitly. This
      // makes future schema additions fail closed until their ownership
      // policy is reviewed.
      if (!isDirect && !tenantPath) {
        throw new TenancyError(`model ${String(modelName)} is not classified for tenant access`);
      }

      return new Proxy(model, {
        get(modelTarget, methodName) {
          const method = modelTarget[methodName];
          if (typeof method !== 'function') return method;
          if (!READ_METHODS.has(methodName) && !WRITE_METHODS.has(methodName)) {
            return async () => {
              throw new TenancyError(`${String(modelName)}.${String(methodName)} is not permitted in request scope`);
            };
          }
          if (APPEND_ONLY_MODELS.has(modelKey) && APPEND_ONLY_BLOCKED_METHODS.has(methodName)) {
            return async () => {
              throw new TenancyError(`${String(modelName)} is append-only; ${String(methodName)} is not permitted`);
            };
          }

          return async (...args) => {
            const queryArgs = args[0] || {};
            // Each distinct referenced record is verified once per call, so a
            // batched createMany costs one check per owner instead of per row.
            const verified = new Set();

            // Path A: direct-scoped model (client/project/user)
            if (isDirect) {
              if (READ_METHODS.has(methodName)) {
                queryArgs.where = { ...queryArgs.where, organizationId };
              } else if (CREATE_METHODS.has(methodName)) {
                if (Array.isArray(queryArgs.data)) {
                  queryArgs.data = queryArgs.data.map(d => ({ ...d, organizationId }));
                } else {
                  queryArgs.data = { ...queryArgs.data, organizationId };
                }
              } else if (methodName === 'upsert') {
                queryArgs.where = { ...queryArgs.where, organizationId };
                queryArgs.create = { ...queryArgs.create, organizationId };
                queryArgs.update = { ...queryArgs.update, organizationId };
              } else if (methodName === 'update' || methodName === 'delete' || methodName === 'deleteMany' || BULK_UPDATE_METHODS.has(methodName)) {
                queryArgs.where = { ...queryArgs.where, organizationId };
                if (queryArgs.data) {
                  queryArgs.data = { ...queryArgs.data, organizationId };
                }
              }

              const parentRelations = DIRECT_PARENT_RELATIONS[modelKey] || [];
              const isCreate = CREATE_METHODS.has(methodName);
              const ownershipWrites = methodName === 'upsert'
                ? [{ row: queryArgs.create, creating: true }, { row: queryArgs.update, creating: false }]
                : (isCreate || methodName === 'update' || BULK_UPDATE_METHODS.has(methodName))
                  ? asList(queryArgs.data).map((row) => ({ row, creating: isCreate }))
                  : [];
              for (const { row, creating } of ownershipWrites) {
                for (const parent of parentRelations) {
                  if (row?.[parent.relation]?.create || row?.[parent.relation]?.connectOrCreate) {
                    throw new TenancyError(`nested ${parent.relation} creation is not allowed in scoped writes`);
                  }
                  const ownerId = row?.[parent.field] ?? row?.[parent.relation]?.connect?.id;
                  if (!ownerId && creating && parent.required) {
                    throw new TenancyError(`${String(modelName)}.${parent.field} is required`, 400);
                  }
                }
              }
              await validateWriteArgs(modelKey, methodName, queryArgs, verified);
              logger.debug({ modelName, methodName, organizationId }, 'Scoped Query Execution');
              return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
            }

            // Path B: tenant-path-scoped model (Thread, Task, Invoice, etc.)
            // Auto-inject a relation filter that walks to organizationId.
            const tenantWhere = buildTenantWhere(tenantPath, organizationId);
            const ownerRelation = tenantPath[0];
            const ownerIdField = `${ownerRelation}Id`;

            // findUnique on Prisma requires the where to be a unique input —
            // a relation filter AND id filter breaks that. Convert to
            // findFirst (which accepts arbitrary where) and preserve
            // include/select from the original args.
            if (methodName === 'findUnique' || methodName === 'findUniqueOrThrow') {
              const findFirstArgs = {
                where: { AND: [queryArgs.where ?? {}, tenantWhere] },
              };
              if (queryArgs.include) findFirstArgs.include = queryArgs.include;
              if (queryArgs.select)  findFirstArgs.select  = queryArgs.select;
              if (queryArgs.orderBy) findFirstArgs.orderBy = queryArgs.orderBy;
              if (queryArgs.cursor)  findFirstArgs.cursor  = queryArgs.cursor;
              if (queryArgs.distinct) findFirstArgs.distinct = queryArgs.distinct;
              const scopedMethod = methodName === 'findUniqueOrThrow' ? 'findFirstOrThrow' : 'findFirst';
              logger.debug({ modelName, methodName: `${scopedMethod}(from-unique)`, organizationId, tenantPath }, 'Tenant-path Query Execution');
              return modelTarget[scopedMethod](findFirstArgs);
            }

            if (READ_METHODS.has(methodName) || methodName === 'deleteMany' || BULK_UPDATE_METHODS.has(methodName)) {
              queryArgs.where = { AND: [queryArgs.where ?? {}, tenantWhere] };
            }

            // Prisma update/delete require a WhereUniqueInput. Adding a
            // relation filter via AND makes that input invalid. Prove the
            // target belongs to this tenant first, then execute the original
            // unique mutation. Every foreign key and nested relation write is
            // independently checked so a record cannot be moved or linked
            // across tenants.
            if (methodName === 'update' || methodName === 'delete') {
              const scopedTarget = await modelTarget.findFirst({
                where: { AND: [queryArgs.where ?? {}, tenantWhere] },
                select: { id: true },
              });
              if (!scopedTarget) {
                throw new TenancyError(`${String(modelName)} record is unavailable in this organization`, 404);
              }
              if (methodName === 'update') await validateWriteArgs(modelKey, methodName, queryArgs, verified);
              logger.debug({ modelName, methodName, organizationId, tenantPath }, 'Tenant-path Unique Mutation');
              return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
            }
            if (methodName === 'upsert') {
              if (!RELATION_OWNER_MODELS[ownerRelation]) {
                throw new TenancyError(`no owner policy for relation ${ownerRelation}`);
              }

              const scopedTarget = await modelTarget.findFirst({
                where: { AND: [queryArgs.where ?? {}, tenantWhere] },
                select: { id: true },
              });
              const branch = scopedTarget ? queryArgs.update : queryArgs.create;
              if (!scopedTarget && !branch?.[ownerIdField]) {
                throw new TenancyError(`${String(modelName)}.${ownerIdField} is required`, 400);
              }
              await validateWriteData(modelKey, branch, verified, { creating: !scopedTarget });

              const branchArgs = scopedTarget
                ? { where: queryArgs.where, data: queryArgs.update }
                : { data: queryArgs.create };
              if (queryArgs.include) branchArgs.include = queryArgs.include;
              if (queryArgs.select) branchArgs.select = queryArgs.select;
              const branchMethod = scopedTarget ? 'update' : 'create';
              logger.debug({ modelName, methodName: `${branchMethod}(from-upsert)`, organizationId, tenantPath }, 'Tenant-path Upsert');
              return modelTarget[branchMethod](branchArgs);
            }
            if (CREATE_METHODS.has(methodName)) {
              if (!RELATION_OWNER_MODELS[ownerRelation]) {
                throw new TenancyError(`no owner policy for relation ${ownerRelation}`);
              }
              for (const row of asList(queryArgs.data)) {
                if (!row?.[ownerIdField]) {
                  throw new TenancyError(`${String(modelName)}.${ownerIdField} is required`, 400);
                }
              }
            }
            if (CREATE_METHODS.has(methodName) || BULK_UPDATE_METHODS.has(methodName)) {
              await validateWriteArgs(modelKey, methodName, queryArgs, verified);
            }

            logger.debug({ modelName, methodName, organizationId, tenantPath }, 'Tenant-path Query Execution');
            return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
          };
        }
      });
    }
  });
}
