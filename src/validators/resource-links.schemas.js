import { z } from 'zod';
const id = z.string().min(1).max(100);
const integer = z.number().int().min(1).max(2147483646);
export const resourceLinkUrlSchema = z.string().min(1).max(8192).refine(value => {
    // eslint-disable-next-line no-control-regex
    if (/[\s\\\u0000-\u001f\u007f]/u.test(value))
        return false;
    try {
        const u = new URL(value);
        return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password;
    }
    catch {
        return false;
    }
}, 'Use an exact HTTP(S) URL without credentials or whitespace');
export const resourceLinkSourceSchema = z.object({ system: z.string().min(1).max(100), recordId: z.string().min(1).max(500), originalTitle: z.string().max(500), originalUrl: resourceLinkUrlSchema, originalCreatedAt: z.string().max(200).nullable(), originalPosition: z.number().int().min(0).max(2147483646).nullable() }).strict();
export const resourceLinkTargetSchema = z.object({ entityType: z.enum(['PROJECT', 'TASK']), entityId: id }).strict();
export const resourceLinkCreateSchema = resourceLinkTargetSchema.extend({ title: z.string().trim().min(1).max(500), url: resourceLinkUrlSchema, clientVisible: z.boolean().default(false), createIntentId: z.string().uuid().transform(v => v.toLowerCase()), source: resourceLinkSourceSchema.optional() }).strict();
export const resourceLinkUpdateBaseSchema = z.object({ expectedRevision: integer, title: z.string().trim().min(1).max(500).optional(), url: resourceLinkUrlSchema.optional(), clientVisible: z.boolean().optional() }).strict();
export const resourceLinkUpdateSchema = resourceLinkUpdateBaseSchema.refine(v => Object.keys(v).length > 1, 'Provide a change');
export const resourceLinkArchiveSchema = z.object({ expectedRevision: integer, archived: z.boolean() }).strict();
export const resourceLinkReorderBaseSchema = resourceLinkTargetSchema.extend({ ordered: z.array(z.object({ id, expectedRevision: integer }).strict()).max(500) }).strict();
export const resourceLinkReorderSchema = resourceLinkReorderBaseSchema.refine(v => new Set(v.ordered.map(x => x.id)).size === v.ordered.length, 'Duplicate record');
export const resourceLinkPageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: z.string().max(500).optional() }).strict();
export const resourceLinkListSchema = resourceLinkTargetSchema.extend({ ...resourceLinkPageSchema.shape, includeArchived: z.enum(['true', 'false']).transform(v => v === 'true').optional() }).strict();
export const resourceLinkPortalQuerySchema = resourceLinkPageSchema;
