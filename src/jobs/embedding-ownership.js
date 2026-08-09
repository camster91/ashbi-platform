import { rawPrisma } from '../config/db.js';

export async function resolveEmbeddingOrganizationId(jobData, prismaClient = rawPrisma) {
  if (jobData?.organizationId) return jobData.organizationId;
  if (!jobData?.clientId) return undefined;
  const owner = await prismaClient.client.findUnique({
    where: { id: jobData.clientId },
    select: { organizationId: true },
  });
  return owner?.organizationId;
}
