export class SignedContractProjectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SignedContractProjectError';
    this.code = code;
  }
}

const contractSelect = {
  id: true,
  title: true,
  status: true,
  clientId: true,
  client: { select: { id: true, name: true, organizationId: true } },
  proposal: { select: { id: true, title: true, total: true, projectId: true } },
};

const projectSelect = {
  id: true,
  name: true,
  clientId: true,
  organizationId: true,
  sourceContractId: true,
};

function assertProjectBinding(project, contract) {
  if (project.clientId !== contract.clientId
    || project.organizationId !== contract.client.organizationId
    || project.sourceContractId !== contract.id) {
    throw new SignedContractProjectError(
      'SIGNED_CONTRACT_PROJECT_CONFLICT',
      'The signed contract project is bound to inconsistent client or organization evidence',
    );
  }
}

async function bindProposalToProject(prisma, contract, project) {
  if (!contract.proposal) return;
  if (contract.proposal.projectId && contract.proposal.projectId !== project.id) {
    throw new SignedContractProjectError(
      'SIGNED_CONTRACT_PROPOSAL_PROJECT_CONFLICT',
      'The signed contract proposal is already bound to a different project',
    );
  }
  if (contract.proposal.projectId === project.id) return;
  const claimed = await prisma.proposal.updateMany({
    where: { id: contract.proposal.id, projectId: null, deletedAt: null },
    data: { projectId: project.id },
  });
  if (claimed.count === 1) {
    contract.proposal.projectId = project.id;
    return;
  }
  const reconciled = await prisma.proposal.findFirst({
    where: { id: contract.proposal.id, deletedAt: null },
    select: { projectId: true },
  });
  if (reconciled?.projectId !== project.id) {
    throw new SignedContractProjectError(
      'SIGNED_CONTRACT_PROPOSAL_PROJECT_CONFLICT',
      'The signed contract proposal could not be bound to its project',
    );
  }
  contract.proposal.projectId = project.id;
}

async function findSignedContract(prisma, contractId) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, status: 'SIGNED', deletedAt: null },
    select: contractSelect,
  });
  if (!contract) {
    throw new SignedContractProjectError(
      'SIGNED_CONTRACT_NOT_FOUND',
      'A current signed contract is required before creating its project',
    );
  }
  return contract;
}

async function ensureWithinTransaction(prisma, contractId) {
  const contract = await findSignedContract(prisma, contractId);
  const existing = await prisma.project.findUnique({
    where: { sourceContractId: contract.id },
    select: projectSelect,
  });
  if (existing) {
    assertProjectBinding(existing, contract);
    await bindProposalToProject(prisma, contract, existing);
    return { contract, project: existing, created: false };
  }

  const projectName = contract.proposal?.title || contract.title.replace(/^Contract:\s*/i, '');
  const project = await prisma.project.create({
    data: {
      name: projectName,
      description: `Auto-created from signed contract: ${contract.title}`,
      status: 'STARTING_UP',
      health: 'ON_TRACK',
      clientId: contract.clientId,
      organizationId: contract.client.organizationId,
      sourceContractId: contract.id,
    },
    select: projectSelect,
  });
  await bindProposalToProject(prisma, contract, project);
  return { contract, project, created: true };
}

export async function ensureSignedContractProject({ prisma, contractId }) {
  const normalizedContractId = String(contractId ?? '').trim();
  if (!normalizedContractId) {
    throw new SignedContractProjectError('CONTRACT_REQUIRED', 'Contract is required');
  }
  if (typeof prisma?.$transaction !== 'function') {
    throw new TypeError('A transactional Prisma client is required');
  }
  try {
    return await prisma.$transaction(transaction => ensureWithinTransaction(transaction, normalizedContractId));
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return prisma.$transaction(async (transaction) => {
      const contract = await findSignedContract(transaction, normalizedContractId);
      const project = await transaction.project.findUnique({
        where: { sourceContractId: contract.id },
        select: projectSelect,
      });
      if (!project) throw error;
      assertProjectBinding(project, contract);
      await bindProposalToProject(transaction, contract, project);
      return { contract, project, created: false };
    });
  }
}
