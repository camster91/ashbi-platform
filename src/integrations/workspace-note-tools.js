import { z } from 'zod';
import { authorizeNote, publicNote, readNoteAccess, noteAccessSchema, prepareNoteAccess, saveNoteAccessInTransaction } from '../services/note-access.service.js';
import { wikiToolCall } from './workspace-wiki-tool-errors.js';
import { targetUnavailable } from '../ai/tools/registry.js';

const noteId = z.string().min(1).max(80);
const inputSchema = noteAccessSchema.innerType().extend({ noteId }).strict().refine(input => new Set(input.members.map(row => row.userId)).size === input.members.length);
const read = (name, description, schema, run) => ({ name, description, class: 'read', roles: ['ADMIN', 'TEAM'], timeoutMs: 10_000, inputSchema: schema, resolveScope: ({ user }) => ({ ids: { organizationId: user.organizationId } }), run: context => wikiToolCall(() => run(context)) });
const preparation = async ({ prisma, user, input }) => { const { noteId: id, ...data } = input; return prepareNoteAccess(prisma, id, data, user); };
export const WORKSPACE_NOTE_TOOLS = [
  read('get_project_note', 'Read an authorized internal project document. Ancestor restrictions and current staff membership apply.', z.object({ noteId }).strict(), async ({ prisma, user, input }) => { const access = await authorizeNote(prisma, input.noteId, user); return publicNote(access.note, access.permissions); }),
  read('get_project_note_access', 'Read document audience and grants. Requires owner/administrator management rights through all ancestors.', z.object({ noteId }).strict(), ({ prisma, user, input }) => readNoteAccess(prisma, input.noteId, user)),
  read('preview_project_note_access', 'Preview an exact audience change and obtain its fingerprint. Existing inherited restrictions remain; descendant visibility can change.', inputSchema, preparation),
  {
    name: 'set_project_note_access', description: 'Change a document audience after exact preview and human confirmation. Current ownership, ancestor rights, staff roles and audit are revalidated atomically.', class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: inputSchema.innerType().extend({ previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(input => new Set(input.members.map(row => row.userId)).size === input.members.length),
    resolveScope: context => wikiToolCall(async () => { const { previewFingerprint, ...input } = context.input; const prepared = await preparation({ ...context, input }); if (prepared.fingerprint !== previewFingerprint) throw targetUnavailable('Document audience preview changed'); return { ids: { noteId: input.noteId, organizationId: context.user.organizationId }, records: { prepared } }; }),
    preview: ({ scope }) => scope.records.prepared,
    rollback: 'Failure rolls back audience, audit and receipt. Reverse a committed change through a fresh exact preview and observed revision.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async context => { const { noteId: id, previewFingerprint, ...input } = context.input; const prepared = await prepareNoteAccess(context.prisma, id, input, context.user); if (prepared.fingerprint !== previewFingerprint) throw targetUnavailable('Document audience preview changed'); return saveNoteAccessInTransaction(context.prisma, id, input, context.user); } },
  },
];
