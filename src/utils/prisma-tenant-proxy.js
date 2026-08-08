import logger from './logger.js';
import { withSoftDelete } from '../services/soft-delete.service.js';

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
  'pipelinestage', 'promptversion'
]);

// Models that are intentionally shared across organizations. Every Prisma
// model must be present here, DIRECT_SCOPED_MODELS, or TENANT_PATHS; an
// unclassified delegate is rejected instead of silently bypassing tenancy.
const GLOBAL_MODELS = new Set(['organization']);

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
  credential:       ['client'],
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

  // Calendar events — assume projectId FK (verify schema on first miss)
  calendarevent:    ['project', 'client'],
  eventattendee:    ['event', 'project', 'client'],
  chatreaction:     ['message', 'project', 'client'],
  emailtriagedraft: ['item'],
  ashchatmessage:   ['conversation'],
  intakeformresponse: ['form', 'client'],

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

export function createScopedPrisma(prisma, organizationId) {
  if (!organizationId) {
    throw new Error('Tenancy Error: organizationId is required for scoped queries');
  }

  // Apply soft-delete wrapper first, then tenant scoping
  const softPrisma = withSoftDelete(prisma);

  async function verifyTenantOwner({ relation, model, delegate }, ownerId) {
    const ownerPath = TENANT_PATHS[model];
    const ownerWhere = DIRECT_SCOPED_MODELS.has(model)
      ? { id: ownerId, organizationId }
      : { AND: [{ id: ownerId }, buildTenantWhere(ownerPath, organizationId)] };
    const owner = await softPrisma[delegate].findFirst({
      where: ownerWhere,
      select: { id: true },
    });
    if (!owner) {
      throw new Error(`Tenancy Error: ${relation} ${ownerId} does not belong to organization ${organizationId}`);
    }
  }

  return new Proxy(softPrisma, {
    get(target, modelName) {
      if (modelName === Symbol.for('__proxy__')) return true;
      const model = target[modelName];

      // Not a Prisma model or non-object → return as-is (still has soft-delete)
      if (typeof model !== 'object' || model === null) return model;

      const modelKey = modelName.toLowerCase();
      const isDirect = DIRECT_SCOPED_MODELS.has(modelKey);
      const tenantPath = TENANT_PATHS[modelKey];

      if (GLOBAL_MODELS.has(modelKey)) return model;
      if (RESTRICTED_MODELS.has(modelKey)) {
        throw new Error(`Tenancy Error: model ${String(modelName)} has no tenant owner and is unavailable in request scope`);
      }

      // Application model delegates must be classified explicitly. This
      // makes future schema additions fail closed until their ownership
      // policy is reviewed.
      if (!isDirect && !tenantPath) {
        throw new Error(`Tenancy Error: model ${String(modelName)} is not classified for tenant access`);
      }

      return new Proxy(model, {
        get(modelTarget, methodName) {
          const method = modelTarget[methodName];
          if (typeof method !== 'function') return method;

          return async (...args) => {
            const queryArgs = args[0] || {};

            // Path A: direct-scoped model (client/project/user)
            if (isDirect) {
              if (['findMany', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'].includes(methodName)) {
                queryArgs.where = { ...queryArgs.where, organizationId };
              } else if (['create', 'createMany'].includes(methodName)) {
                if (Array.isArray(queryArgs.data)) {
                  queryArgs.data = queryArgs.data.map(d => ({ ...d, organizationId }));
                } else {
                  queryArgs.data = { ...queryArgs.data, organizationId };
                }
              } else if (methodName === 'upsert') {
                queryArgs.where = { ...queryArgs.where, organizationId };
                queryArgs.create = { ...queryArgs.create, organizationId };
                queryArgs.update = { ...queryArgs.update, organizationId };
              } else if (['update', 'updateMany', 'delete', 'deleteMany'].includes(methodName)) {
                queryArgs.where = { ...queryArgs.where, organizationId };
                if (queryArgs.data) {
                  queryArgs.data = { ...queryArgs.data, organizationId };
                }
              }

              const parentRelations = DIRECT_PARENT_RELATIONS[modelKey] || [];
              const isCreate = methodName === 'create' || methodName === 'createMany';
              const ownershipWrites = methodName === 'upsert'
                ? [{ row: queryArgs.create, creating: true }, { row: queryArgs.update, creating: false }]
                : (isCreate || methodName === 'update' || methodName === 'updateMany')
                  ? (Array.isArray(queryArgs.data) ? queryArgs.data : [queryArgs.data])
                    .map((row) => ({ row, creating: isCreate }))
                  : [];
              for (const { row, creating } of ownershipWrites) {
                for (const parent of parentRelations) {
                  if (row?.[parent.relation]?.create || row?.[parent.relation]?.connectOrCreate) {
                    throw new Error(`Tenancy Error: nested ${parent.relation} creation is not allowed in scoped writes`);
                  }
                  const ownerId = row?.[parent.field] ?? row?.[parent.relation]?.connect?.id;
                  if (!ownerId) {
                    if (creating && parent.required) {
                      throw new Error(`Tenancy Error: ${String(modelName)}.${parent.field} is required`);
                    }
                    continue;
                  }
                  await verifyTenantOwner(parent, ownerId);
                }
              }
              logger.debug({ modelName, methodName, organizationId }, 'Scoped Query Execution');
              return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
            }

            // Path B: tenant-path-scoped model (Thread, Task, Invoice, etc.)
            // Auto-inject a relation filter that walks to organizationId.
            if (tenantPath) {
              const tenantWhere = buildTenantWhere(tenantPath, organizationId);

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

              if (['findFirst', 'findMany', 'count', 'aggregate', 'groupBy'].includes(methodName)) {
                queryArgs.where = { AND: [queryArgs.where ?? {}, tenantWhere] };
              } else if (['update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(methodName)) {
                queryArgs.where = { AND: [queryArgs.where ?? {}, tenantWhere] };
              }
              if (methodName === 'create' || methodName === 'createMany' || methodName === 'upsert') {
                const ownerRelation = tenantPath[0];
                const ownerIdField = `${ownerRelation}Id`;
                const ownerPolicy = RELATION_OWNER_MODELS[ownerRelation];
                if (!ownerPolicy) {
                  throw new Error(`Tenancy Error: no owner policy for relation ${ownerRelation}`);
                }
                const ownershipWrites = methodName === 'upsert'
                  ? [{ row: queryArgs.create, required: true }, { row: queryArgs.update, required: false }]
                  : (Array.isArray(queryArgs.data) ? queryArgs.data : [queryArgs.data])
                    .map((row) => ({ row, required: true }));
                for (const { row, required } of ownershipWrites) {
                  const ownerId = row?.[ownerIdField];
                  if (!ownerId) {
                    if (required) {
                      throw new Error(`Tenancy Error: ${String(modelName)}.${ownerIdField} is required`);
                    }
                    continue;
                  }

                  await verifyTenantOwner({ relation: ownerRelation, ...ownerPolicy }, ownerId);
                }
              }

              logger.debug({ modelName, methodName, organizationId, tenantPath }, 'Tenant-path Query Execution');
              return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
            }

            return method.apply(modelTarget, args);
          };
        }
      });
    }
  });
}
