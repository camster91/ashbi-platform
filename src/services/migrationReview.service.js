import { verifyNotionBonsaiNativeProjectLinkReviewBrief } from './notionBonsaiNativeProjectLinkReviewBrief.service.js';
import { prepareNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';
import { verifyNotionBonsaiTaskDispositionReviewBrief } from './notionBonsaiTaskDispositionReviewBrief.service.js';
import { prepareNotionBonsaiTaskDispositionDecision } from './notionBonsaiTaskDispositionDecision.service.js';
import { verifyNotionBonsaiProjectDispositionReviewBrief } from './notionBonsaiProjectDispositionReviewBrief.service.js';
import { prepareNotionBonsaiProjectDispositionDecision } from './notionBonsaiProjectDispositionDecision.service.js';

const PROJECT_LINK_KIND = 'NOTION_BONSAI_PROJECT_LINK';
const TASK_DISPOSITION_KIND = 'NOTION_BONSAI_TASK_DISPOSITION';
const PROJECT_DISPOSITION_KIND = 'NOTION_BONSAI_PROJECT_DISPOSITION';
const DECISIONS = new Set(['APPROVED', 'REJECTED']);

function text(value) {
  return String(value ?? '').trim();
}

function requireDelegate(prismaClient, name) {
  if (!prismaClient?.[name]) throw new TypeError('A tenant-scoped Prisma client is required');
  return prismaClient[name];
}

function canonical(value) {
  return JSON.stringify(value);
}

function isUniqueConflict(error) {
  return error?.code === 'P2002';
}

function evidenceMatches(packet, input) {
  return packet.kind === PROJECT_LINK_KIND
    && packet.sourceReviewSha256 === input.reviewSha256
    && packet.mappingDecisionSha256 === input.mappingDecisionSha256
    && (packet.supplementalSha256 ?? null) === (input.supplementalEvidenceSha256 ?? null)
    && canonical(packet.sourceReview) === canonical(input.review)
    && canonical(packet.mappingDecision) === canonical(input.mappingDecision)
    && canonical(packet.supplementalEvidence ?? null) === canonical(input.supplementalEvidence ?? null)
    && canonical(packet.reviewBrief) === canonical(input.reviewBrief);
}

function taskDependencyEvidence(input) {
  return {
    format: 'ashbi-hub-task-disposition-review-dependencies',
    version: 1,
    taskLinkDecision: input.taskLinkDecision,
    taskLinkDecisionSha256: input.taskLinkDecisionSha256,
    mappingDecision: input.mappingDecision ?? null,
    mappingDecisionSha256: input.mappingDecisionSha256 ?? null,
    dispositionDecision: input.dispositionDecision,
    dispositionDecisionSha256: input.dispositionDecisionSha256,
  };
}

function taskEvidenceMatches(packet, input) {
  return packet.kind === TASK_DISPOSITION_KIND
    && packet.sourceReviewSha256 === input.reviewSha256
    && packet.mappingDecisionSha256 === input.dispositionDecisionSha256
    && packet.supplementalSha256 === null
    && canonical(packet.sourceReview) === canonical(input.review)
    && canonical(packet.mappingDecision) === canonical(taskDependencyEvidence(input))
    && packet.supplementalEvidence === null
    && canonical(packet.reviewBrief) === canonical(input.reviewBrief);
}

function projectDependencyEvidence(input) {
  return {
    format: 'ashbi-hub-project-disposition-review-dependencies',
    version: 1,
    projectLinkDecision: input.projectLinkDecision,
    projectLinkDecisionSha256: input.projectLinkDecisionSha256,
    dispositionDecision: input.dispositionDecision,
    dispositionDecisionSha256: input.dispositionDecisionSha256,
  };
}

function projectDispositionEvidenceMatches(packet, input) {
  return packet.kind === PROJECT_DISPOSITION_KIND
    && packet.sourceReviewSha256 === input.reviewSha256
    && packet.mappingDecisionSha256 === input.dispositionDecisionSha256
    && (packet.supplementalSha256 ?? null) === (input.supplementalEvidenceSha256 ?? null)
    && canonical(packet.sourceReview) === canonical(input.review)
    && canonical(packet.mappingDecision) === canonical(projectDependencyEvidence(input))
    && canonical(packet.supplementalEvidence ?? null) === canonical(input.supplementalEvidence ?? null)
    && canonical(packet.reviewBrief) === canonical(input.reviewBrief);
}

function latestDecisions(decisions = []) {
  const byCandidate = new Map();
  for (const decision of decisions) {
    if (!byCandidate.has(decision.candidateId)) byCandidate.set(decision.candidateId, decision);
  }
  return byCandidate;
}

function packetView(packet) {
  const candidates = Array.isArray(packet.reviewBrief?.candidates) ? packet.reviewBrief.candidates : [];
  const latest = latestDecisions(packet.decisions);
  const reviewedCandidates = candidates.map(candidate => ({
    ...candidate,
    decision: latest.get(candidate.candidateId)?.decision ?? 'PENDING',
    reviewNote: latest.get(candidate.candidateId)?.reviewNote ?? null,
    reviewedBy: latest.get(candidate.candidateId)?.reviewedBy ?? null,
    decidedAt: latest.get(candidate.candidateId)?.decidedAt ?? null,
  }));
  const approved = reviewedCandidates.filter(item => item.decision === 'APPROVED').length;
  const rejected = reviewedCandidates.filter(item => item.decision === 'REJECTED').length;
  const pending = reviewedCandidates.filter(item => item.decision === 'PENDING').length;
  return {
    id: packet.id,
    kind: packet.kind,
    sourceReviewSha256: packet.sourceReviewSha256,
    sourcePreparedAt: packet.sourcePreparedAt,
    importedBy: packet.importedBy,
    createdAt: packet.createdAt,
    updatedAt: packet.updatedAt,
    summary: { total: reviewedCandidates.length, approved, rejected, pending },
    complete: reviewedCandidates.length > 0 && pending === 0,
    candidates: reviewedCandidates,
    safeguards: {
      externalWritesPerformed: false,
      projectLinksApplied: false,
      taskDispositionsApplied: false,
      projectDispositionsApplied: false,
      duplicateGroupsConsolidated: false,
      sourceRepairsApplied: false,
      migrationOrCutoverAuthorized: false,
    },
  };
}

export async function importProjectLinkReviewPacket({ prismaClient, input, importedBy, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  if (!text(input?.requestId) || !text(importedBy)) throw new TypeError('requestId and importedBy are required');

  const verification = verifyNotionBonsaiNativeProjectLinkReviewBrief({
    review: input.review,
    reviewSha256: input.reviewSha256,
    mappingDecision: input.mappingDecision,
    mappingDecisionSha256: input.mappingDecisionSha256,
    supplementalEvidence: input.supplementalEvidence ?? null,
    supplementalEvidenceSha256: input.supplementalEvidenceSha256 ?? null,
    record: input.reviewBrief,
  });
  if (!verification.valid) {
    const error = new Error(`Project-link review evidence is invalid: ${verification.findings.join(', ')}`);
    error.statusCode = 422;
    throw error;
  }

  const existingRequest = await packets.findFirst({ where: { importRequestId: input.requestId }, include: { decisions: true } });
  if (existingRequest) {
    if (!evidenceMatches(existingRequest, input)) {
      const error = new Error('This import request ID is already bound to different evidence');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, packet: packetView(existingRequest) };
  }

  const existingEvidence = await packets.findFirst({
    where: { kind: PROJECT_LINK_KIND, sourceReviewSha256: input.reviewSha256 },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (existingEvidence) {
    if (!evidenceMatches(existingEvidence, input)) {
      const error = new Error('The source review checksum is already bound to different evidence');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, packet: packetView(existingEvidence) };
  }

  let packet;
  try {
    packet = await packets.create({
      data: {
        kind: PROJECT_LINK_KIND,
        importRequestId: input.requestId,
        sourceReviewSha256: input.reviewSha256,
        mappingDecisionSha256: input.mappingDecisionSha256,
        supplementalSha256: input.supplementalEvidenceSha256 ?? null,
        sourcePreparedAt: new Date(input.reviewBrief.preparedAt),
        sourceReview: input.review,
        mappingDecision: input.mappingDecision,
        supplementalEvidence: input.supplementalEvidence ?? undefined,
        reviewBrief: input.reviewBrief,
        importedBy,
        createdAt: now,
      },
      include: { decisions: true },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await packets.findFirst({
      where: { importRequestId: input.requestId },
      include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
    }) ?? await packets.findFirst({
      where: { kind: PROJECT_LINK_KIND, sourceReviewSha256: input.reviewSha256 },
      include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!winner || !evidenceMatches(winner, input)) {
      const conflict = new Error('Concurrent import resolved to different evidence');
      conflict.statusCode = 409;
      throw conflict;
    }
    return { replayed: true, packet: packetView(winner) };
  }
  return { replayed: false, packet: packetView(packet) };
}

export async function importTaskDispositionReviewPacket({ prismaClient, input, importedBy, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  if (!text(input?.requestId) || !text(importedBy)) throw new TypeError('requestId and importedBy are required');

  const verification = verifyNotionBonsaiTaskDispositionReviewBrief({
    review: input.review,
    reviewSha256: input.reviewSha256,
    taskLinkDecision: input.taskLinkDecision,
    taskLinkDecisionSha256: input.taskLinkDecisionSha256,
    mappingDecision: input.mappingDecision ?? null,
    mappingDecisionSha256: input.mappingDecisionSha256 ?? null,
    decision: input.dispositionDecision,
    decisionSha256: input.dispositionDecisionSha256,
    record: input.reviewBrief,
  });
  if (!verification.valid) {
    const error = new Error(`Task-disposition review evidence is invalid: ${verification.findings.join(', ')}`);
    error.statusCode = 422;
    throw error;
  }

  const existingRequest = await packets.findFirst({ where: { importRequestId: input.requestId }, include: { decisions: true } });
  if (existingRequest) {
    if (!taskEvidenceMatches(existingRequest, input)) {
      const error = new Error('This import request ID is already bound to different evidence');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, packet: packetView(existingRequest) };
  }

  const existingEvidence = await packets.findFirst({
    where: { kind: TASK_DISPOSITION_KIND, sourceReviewSha256: input.reviewSha256 },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (existingEvidence) {
    if (!taskEvidenceMatches(existingEvidence, input)) {
      const error = new Error('The source review checksum is already bound to different evidence');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, packet: packetView(existingEvidence) };
  }

  let packet;
  try {
    packet = await packets.create({
      data: {
        kind: TASK_DISPOSITION_KIND,
        importRequestId: input.requestId,
        sourceReviewSha256: input.reviewSha256,
        mappingDecisionSha256: input.dispositionDecisionSha256,
        supplementalSha256: null,
        sourcePreparedAt: new Date(input.reviewBrief.preparedAt),
        sourceReview: input.review,
        mappingDecision: taskDependencyEvidence(input),
        supplementalEvidence: null,
        reviewBrief: input.reviewBrief,
        importedBy,
        createdAt: now,
      },
      include: { decisions: true },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await packets.findFirst({
      where: { importRequestId: input.requestId },
      include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
    }) ?? await packets.findFirst({
      where: { kind: TASK_DISPOSITION_KIND, sourceReviewSha256: input.reviewSha256 },
      include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!winner || !taskEvidenceMatches(winner, input)) {
      const conflict = new Error('Concurrent import resolved to different evidence');
      conflict.statusCode = 409;
      throw conflict;
    }
    return { replayed: true, packet: packetView(winner) };
  }
  return { replayed: false, packet: packetView(packet) };
}

export async function importProjectDispositionReviewPacket({ prismaClient, input, importedBy, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  if (!text(input?.requestId) || !text(importedBy)) throw new TypeError('requestId and importedBy are required');

  const verification = verifyNotionBonsaiProjectDispositionReviewBrief({
    review: input.review,
    reviewSha256: input.reviewSha256,
    projectLinkDecision: input.projectLinkDecision,
    projectLinkDecisionSha256: input.projectLinkDecisionSha256,
    projectDispositionDecision: input.dispositionDecision,
    projectDispositionDecisionSha256: input.dispositionDecisionSha256,
    supplementalEvidence: input.supplementalEvidence ?? null,
    supplementalEvidenceSha256: input.supplementalEvidenceSha256 ?? null,
    record: input.reviewBrief,
  });
  if (!verification.valid) {
    const error = new Error(`Project-disposition review evidence is invalid: ${verification.findings.join(', ')}`);
    error.statusCode = 422;
    throw error;
  }

  const existingRequest = await packets.findFirst({ where: { importRequestId: input.requestId }, include: { decisions: true } });
  if (existingRequest) {
    if (!projectDispositionEvidenceMatches(existingRequest, input)) {
      const error = new Error('This import request ID is already bound to different evidence');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, packet: packetView(existingRequest) };
  }

  const existingEvidence = await packets.findFirst({
    where: { kind: PROJECT_DISPOSITION_KIND, sourceReviewSha256: input.reviewSha256 },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (existingEvidence) {
    if (!projectDispositionEvidenceMatches(existingEvidence, input)) {
      const error = new Error('The source review checksum is already bound to different evidence');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, packet: packetView(existingEvidence) };
  }

  let packet;
  try {
    packet = await packets.create({
      data: {
        kind: PROJECT_DISPOSITION_KIND,
        importRequestId: input.requestId,
        sourceReviewSha256: input.reviewSha256,
        mappingDecisionSha256: input.dispositionDecisionSha256,
        supplementalSha256: input.supplementalEvidenceSha256 ?? null,
        sourcePreparedAt: new Date(input.reviewBrief.preparedAt),
        sourceReview: input.review,
        mappingDecision: projectDependencyEvidence(input),
        supplementalEvidence: input.supplementalEvidence ?? null,
        reviewBrief: input.reviewBrief,
        importedBy,
        createdAt: now,
      },
      include: { decisions: true },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await packets.findFirst({
      where: { importRequestId: input.requestId },
      include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
    }) ?? await packets.findFirst({
      where: { kind: PROJECT_DISPOSITION_KIND, sourceReviewSha256: input.reviewSha256 },
      include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!winner || !projectDispositionEvidenceMatches(winner, input)) {
      const conflict = new Error('Concurrent import resolved to different evidence');
      conflict.statusCode = 409;
      throw conflict;
    }
    return { replayed: true, packet: packetView(winner) };
  }
  return { replayed: false, packet: packetView(packet) };
}

export async function listMigrationReviewPackets({ prismaClient }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  const rows = await packets.findMany({
    orderBy: { createdAt: 'desc' },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  return rows.map(packetView);
}

export async function getMigrationReviewPacket({ prismaClient, packetId }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  const packet = await packets.findFirst({
    where: { id: packetId },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  return packet ? packetView(packet) : null;
}

export async function recordMigrationReviewDecision({ prismaClient, packetId, candidateId, requestId, decision, reviewNote, reviewedBy, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  const decisions = requireDelegate(prismaClient, 'migrationReviewDecision');
  if (!DECISIONS.has(decision)) throw new TypeError('decision must be APPROVED or REJECTED');
  if (!text(candidateId) || !text(requestId) || !text(reviewedBy)) throw new TypeError('candidateId, requestId, and reviewedBy are required');

  const packet = await packets.findFirst({
    where: { id: packetId },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (!packet) return null;
  const candidate = packet.reviewBrief?.candidates?.find(item => item.candidateId === candidateId);
  if (!candidate) {
    const error = new Error('Candidate is not part of this evidence-bound review packet');
    error.statusCode = 404;
    throw error;
  }
  if (decision === 'APPROVED' && candidate.recommendation !== 'APPROVAL_READY') {
    const error = new Error('Only an approval-ready recommendation can be approved');
    error.statusCode = 422;
    throw error;
  }

  const existing = await decisions.findFirst({ where: { requestId } });
  if (existing) {
    const same = existing.packetId === packetId && existing.candidateId === candidateId
      && existing.decision === decision && (existing.reviewNote ?? null) === (reviewNote ?? null);
    if (!same) {
      const error = new Error('This decision request ID is already bound to a different action');
      error.statusCode = 409;
      throw error;
    }
    return { replayed: true, decision: existing, packet: packetView(packet) };
  }

  let created;
  try {
    created = await decisions.create({ data: {
      packetId,
      requestId,
      candidateId,
      decision,
      reviewNote: reviewNote ?? null,
      reviewedBy,
      decidedAt: now,
    } });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await decisions.findFirst({ where: { requestId } });
    const same = winner?.packetId === packetId && winner?.candidateId === candidateId
      && winner?.decision === decision && (winner?.reviewNote ?? null) === (reviewNote ?? null);
    if (!same) {
      const conflict = new Error('Concurrent decision resolved to a different action');
      conflict.statusCode = 409;
      throw conflict;
    }
    const updatedPacket = { ...packet, decisions: [winner, ...packet.decisions] };
    return { replayed: true, decision: winner, packet: packetView(updatedPacket) };
  }
  const updatedPacket = { ...packet, decisions: [created, ...packet.decisions] };
  return { replayed: false, decision: created, packet: packetView(updatedPacket) };
}

export async function exportProjectLinkDecision({ prismaClient, packetId, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  const packet = await packets.findFirst({
    where: { id: packetId },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (!packet) return null;
  const latest = latestDecisions(packet.decisions);
  const decisionRows = [...latest.values()];
  const preparedAt = new Date(Math.max(now.getTime(), Date.parse(packet.sourceReview.preparedAt), ...decisionRows.map(item => new Date(item.decidedAt).getTime()))).toISOString();
  const latestDecisionAt = decisionRows.length
    ? new Date(Math.max(...decisionRows.map(item => new Date(item.decidedAt).getTime()))).toISOString()
    : null;
  const reviewers = [...new Set(decisionRows.map(item => item.reviewedBy))].sort().join(', ');
  return prepareNotionBonsaiNativeProjectLinkDecision({
    review: packet.sourceReview,
    reviewSha256: packet.sourceReviewSha256,
    preparedAt,
    decisions: decisionRows.map(item => ({ candidateId: item.candidateId, decision: item.decision })),
    approver: decisionRows.length ? reviewers : null,
    decidedAt: latestDecisionAt,
    reference: decisionRows.length ? `hub-migration-review:${packet.id}` : null,
  });
}

export async function exportTaskDispositionDecision({ prismaClient, packetId, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  const packet = await packets.findFirst({
    where: { id: packetId },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (!packet) return null;
  if (packet.kind !== TASK_DISPOSITION_KIND) {
    const error = new Error('Migration review packet is not a task-disposition review');
    error.statusCode = 422;
    throw error;
  }
  const dependencies = packet.mappingDecision;
  const latest = latestDecisions(packet.decisions);
  const approvedRows = [...latest.values()].filter(item => item.decision === 'APPROVED');
  const approvedByCandidate = new Map(approvedRows.map(item => [item.candidateId, item]));
  const recommendations = packet.reviewBrief.candidates.filter(candidate => approvedByCandidate.has(candidate.candidateId));
  const sourceTimes = [
    now.getTime(),
    Date.parse(packet.sourceReview.preparedAt),
    Date.parse(dependencies.taskLinkDecision.preparedAt),
    Date.parse(dependencies.dispositionDecision.preparedAt),
    ...approvedRows.map(item => new Date(item.decidedAt).getTime()),
  ];
  const preparedAt = new Date(Math.max(...sourceTimes)).toISOString();
  const decidedAt = approvedRows.length
    ? new Date(Math.max(...approvedRows.map(item => new Date(item.decidedAt).getTime()))).toISOString()
    : null;
  const reviewers = [...new Set(approvedRows.map(item => item.reviewedBy))].sort().join(', ');
  return prepareNotionBonsaiTaskDispositionDecision({
    review: packet.sourceReview,
    reviewSha256: packet.sourceReviewSha256,
    taskLinkDecision: dependencies.taskLinkDecision,
    taskLinkDecisionSha256: dependencies.taskLinkDecisionSha256,
    mappingDecision: dependencies.mappingDecision,
    mappingDecisionSha256: dependencies.mappingDecisionSha256,
    preparedAt,
    decisions: recommendations.map(candidate => ({
      candidateId: candidate.candidateId,
      disposition: candidate.recommendedDisposition,
      rationale: approvedByCandidate.get(candidate.candidateId)?.reviewNote
        || `Approved evidence recommendation: ${candidate.reasonCode}`,
      reference: `hub-migration-review:${packet.id}:${candidate.candidateId}`,
      taskLinkCandidateId: candidate.taskLinkCandidateId,
    })),
    approver: approvedRows.length ? reviewers : null,
    decidedAt,
    reference: approvedRows.length ? `hub-migration-review:${packet.id}` : null,
  });
}

export async function exportProjectDispositionDecision({ prismaClient, packetId, now = new Date() }) {
  const packets = requireDelegate(prismaClient, 'migrationReviewPacket');
  const packet = await packets.findFirst({
    where: { id: packetId },
    include: { decisions: { orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (!packet) return null;
  if (packet.kind !== PROJECT_DISPOSITION_KIND) {
    const error = new Error('Migration review packet is not a project-disposition review');
    error.statusCode = 422;
    throw error;
  }
  const dependencies = packet.mappingDecision;
  const latest = latestDecisions(packet.decisions);
  const approvedRows = [...latest.values()].filter(item => item.decision === 'APPROVED');
  const approvedByCandidate = new Map(approvedRows.map(item => [item.candidateId, item]));
  const recommendations = packet.reviewBrief.candidates.filter(candidate => approvedByCandidate.has(candidate.candidateId));
  const sourceTimes = [
    now.getTime(),
    Date.parse(packet.sourceReview.preparedAt),
    Date.parse(dependencies.projectLinkDecision.preparedAt),
    Date.parse(dependencies.dispositionDecision.preparedAt),
    ...approvedRows.map(item => new Date(item.decidedAt).getTime()),
  ];
  const preparedAt = new Date(Math.max(...sourceTimes)).toISOString();
  const decidedAt = approvedRows.length
    ? new Date(Math.max(...approvedRows.map(item => new Date(item.decidedAt).getTime()))).toISOString()
    : null;
  const reviewers = [...new Set(approvedRows.map(item => item.reviewedBy))].sort().join(', ');
  return prepareNotionBonsaiProjectDispositionDecision({
    review: packet.sourceReview,
    reviewSha256: packet.sourceReviewSha256,
    projectLinkDecision: dependencies.projectLinkDecision,
    projectLinkDecisionSha256: dependencies.projectLinkDecisionSha256,
    preparedAt,
    decisions: recommendations.map(candidate => ({
      candidateId: candidate.candidateId,
      disposition: candidate.recommendedDisposition,
      rationale: approvedByCandidate.get(candidate.candidateId)?.reviewNote
        || `Approved evidence recommendation: ${candidate.reasonCode}`,
      reference: `hub-migration-review:${packet.id}:${candidate.candidateId}`,
      projectLinkCandidateId: candidate.projectLinkCandidateId,
    })),
    approver: approvedRows.length ? reviewers : null,
    decidedAt,
    reference: approvedRows.length ? `hub-migration-review:${packet.id}` : null,
  });
}

export async function exportMigrationReviewDecision(options) {
  const packets = requireDelegate(options.prismaClient, 'migrationReviewPacket');
  const packet = await packets.findFirst({ where: { id: options.packetId }, include: { decisions: true } });
  if (!packet) return null;
  if (packet.kind === TASK_DISPOSITION_KIND) return exportTaskDispositionDecision(options);
  if (packet.kind === PROJECT_DISPOSITION_KIND) return exportProjectDispositionDecision(options);
  return exportProjectLinkDecision(options);
}

export { PROJECT_LINK_KIND, TASK_DISPOSITION_KIND, PROJECT_DISPOSITION_KIND };
