// Immutable history is untrusted, potentially stale data, never current facts.
export const MAX_MEMORY_BYTES = 8192;
export const MAX_AGENT_PROMPT_BYTES = 96 * 1024;
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
export function textPrefix(value, limit) {
  let end = Math.min(value.length, limit);
  if (end && /[\uD800-\uDBFF]/u.test(value[end - 1])) end--;
  return value.slice(0, end);
}
export async function buildClientAgentMemory(prisma, run) {
  const cutoff = new Date(run.createdAt);
  if (!Number.isFinite(+cutoff)) throw new Error('Run creation cutoff is missing');
  const rows = await prisma.clientAgentRun.findMany({
    where: { organizationId: run.organizationId, conversationId: run.conversationId, status: 'SUCCEEDED',
      finishedAt: { lt: cutoff }, OR: [{ createdAt: { lt: cutoff } }, { createdAt: cutoff, id: { lt: run.id } }] },
    select: { id: true, organizationId: true, conversationId: true, status: true, createdAt: true, finishedAt: true, prompt: true, response: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5,
  });
  const eligible = rows.filter(row => row.organizationId === run.organizationId && row.conversationId === run.conversationId
    && row.status === 'SUCCEEDED' && row.finishedAt != null && row.createdAt != null && Number.isFinite(+new Date(row.finishedAt)) && +new Date(row.finishedAt) < +cutoff
    && Number.isFinite(+new Date(row.createdAt)) && (+new Date(row.createdAt) < +cutoff || (+new Date(row.createdAt) === +cutoff && row.id < run.id))
    && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 100
    && typeof row.prompt === 'string' && row.prompt.trim() && row.prompt.length <= 2000
    && typeof row.response === 'string' && row.response.trim())
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const unique = eligible.filter((row, index) => eligible.findIndex(other => other.id === row.id) === index);
  const memory = { version: 1, turns: unique.slice(0, 4).reverse().map(row => {
    const response = textPrefix(row.response, 4000);
    return { runId: row.id, prompt: row.prompt, response, responseTruncated: response !== row.response };
  }), truncated: unique.length > 4 };
  // Reserve whitespace added by PostgreSQL's JSONB canonical serialization.
  while (bytes(memory) > MAX_MEMORY_BYTES - 100 && memory.turns.length > 1) { memory.turns.shift(); memory.truncated = true; }
  while (bytes(memory) > MAX_MEMORY_BYTES - 100 && memory.turns.length) {
    const turn = memory.turns[0];
    turn.response = textPrefix(turn.response, turn.response.length - 1); turn.responseTruncated = true; memory.truncated = true;
    if (!turn.response.trim()) memory.turns.shift();
  }
  memory.truncated ||= memory.turns.some(turn => turn.responseTruncated);
  return memory;
}
