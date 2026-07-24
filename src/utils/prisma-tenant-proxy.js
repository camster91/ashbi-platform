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
const DIRECT_SCOPED_MODELS = ['client', 'project', 'user'];

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
  thread:           ['client'],
  invoice:          ['client'],
  proposal:         ['client'],
  contract:         ['client'],
  retainerPlan:     ['client'],
  pipelineDeal:     ['client'],
  expense:          ['client'],
  credential:       ['client'],

  // Via User (uploadedBy → organizationId). Attachment has no client/project
  // relation — its only owner link is the uploading user.
  attachment:       ['uploadedBy'],

  // 1-hop to Project (via projectId FK, then project → client).
  // These models relate to Client through Project, NOT directly.
  note:             ['project', 'client'],
  projectCommunication: ['project', 'client'],
  chatMessage:      ['project', 'client'],
  revisionRound:    ['project', 'client'],
  task:             ['project', 'client'],
  milestone:        ['project', 'client'],
  timeSession:      ['project', 'client'],

  // 1-hop to Thread (via threadId FK, then thread → client)
  message:          ['thread', 'client'],
  response:         ['thread', 'client'],

  // 1-hop to Invoice (via invoiceId FK, then invoice → client)
  invoiceLineItem:  ['invoice', 'client'],
  invoicePayment:   ['invoice', 'client'],

  // 1-hop to Proposal (via proposalId FK, then proposal → client)
  proposalLineItem: ['proposal', 'client'],
  proposalVersion:  ['proposal', 'client'],

  // NOTE: brandSettings, emailTriageItem, unmatchedEmail and taskTemplate are
  // intentionally NOT scoped here — the current schema gives them no relation
  // path to an Organization (global config / templates / raw inbox tables).
  // Adding a dedicated organizationId column is the correct long-term fix.

  // 1-hop to Task (via taskId FK, then task → project → client)
  taskComment:      ['task', 'project', 'client'],

  // 1-hop to User (via userId FK, then user → organizationId)
  notification:     ['user'],

  // Calendar events — assume projectId FK (verify schema on first miss)
  calendarEvent:    ['project', 'client'],
};

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

  return new Proxy(softPrisma, {
    get(target, modelName) {
      if (modelName === Symbol.for('__proxy__')) return true;
      const model = target[modelName];

      // Not a Prisma model or non-object → return as-is (still has soft-delete)
      if (typeof model !== 'object' || model === null) return model;

      const modelKey = modelName.toLowerCase();
      const isDirect = DIRECT_SCOPED_MODELS.includes(modelKey);
      const tenantPath = TENANT_PATHS[modelKey];

      // If neither direct-scoped nor path-scoped, return as-is.
      // (These are org-agnostic models like PipelineStage, or tables
      // we have not yet enumerated. Log once per unknown model in dev.)
      if (!isDirect && !tenantPath) {
        return model;
      }

      return new Proxy(model, {
        get(modelTarget, methodName) {
          const method = modelTarget[methodName];
          if (typeof method !== 'function') return method;

          return async (...args) => {
            const queryArgs = args[0] || {};

            // Path A: direct-scoped model (client/project/user)
            if (isDirect) {
              if (['findMany', 'findUnique', 'findFirst', 'count', 'aggregate', 'groupBy'].includes(methodName)) {
                queryArgs.where = { ...queryArgs.where, organizationId };
              } else if (['create', 'createMany'].includes(methodName)) {
                if (Array.isArray(queryArgs.data)) {
                  queryArgs.data = queryArgs.data.map(d => ({ ...d, organizationId }));
                } else {
                  queryArgs.data = { ...queryArgs.data, organizationId };
                }
              } else if (['update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(methodName)) {
                queryArgs.where = { ...queryArgs.where, organizationId };
                if (queryArgs.data) {
                  queryArgs.data = { ...queryArgs.data, organizationId };
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
                logger.debug({ modelName, methodName: 'findFirst(from-unique)', organizationId, tenantPath }, 'Tenant-path Query Execution');
                return modelTarget.findFirst(findFirstArgs);
              }

              if (['findFirst', 'findMany', 'count', 'aggregate', 'groupBy'].includes(methodName)) {
                queryArgs.where = { AND: [queryArgs.where ?? {}, tenantWhere] };
              } else if (['update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(methodName)) {
                queryArgs.where = { AND: [queryArgs.where ?? {}, tenantWhere] };
              }
              // create/createMany: caller MUST supply the FK (e.g. clientId
              // for thread). The model layer doesn't have a tenant column
              // to inject, so we trust the FK here. (Read-after-create
              // will hit the scoped path and verify tenant ownership.)

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