// Request bodies built from staff forms. Kept outside the page components so
// src/tests/unit/ui-payload-contract.test.js can run the exact payloads through
// the server's Zod schemas.

// Number inputs hold strings; the API takes numbers. Empty means "not set".
export function toOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function buildRetainerCreatePayload(form) {
  return {
    clientId: form.clientId,
    tier: form.tier || 'custom',
    hoursPerMonth: toOptionalNumber(form.hoursPerMonth),
    monthlyAmountUsd: toOptionalNumber(form.monthlyAmountUsd),
    monthlyAmountCad: toOptionalNumber(form.monthlyAmountCad),
  };
}

// The edit form does not offer the tier, so it is never resent; an emptied
// amount is sent as null to clear it.
export function buildRetainerUpdatePayload(form) {
  return {
    hoursPerMonth: toOptionalNumber(form.hoursPerMonth),
    monthlyAmountUsd: toOptionalNumber(form.monthlyAmountUsd) ?? null,
    monthlyAmountCad: toOptionalNumber(form.monthlyAmountCad) ?? null,
  };
}

export function buildRetainerLogHoursPayload(form) {
  return {
    hours: toOptionalNumber(form.hours),
    description: form.description?.trim() || undefined,
  };
}

// Credentials form (web/src/pages/Credentials.jsx). Empty optional text is not
// sent on create; on edit an emptied username or URL is sent as null so the
// stored value is cleared. A client or project is always required on create.
export function buildCredentialPayload(form, { editing = false } = {}) {
  const emptied = editing ? null : undefined;
  return {
    label: form.label.trim(),
    username: form.username?.trim() || emptied,
    password: form.password,
    url: form.url?.trim() || emptied,
    notes: editing ? form.notes ?? '' : form.notes || undefined,
    category: form.category || undefined,
    clientId: form.clientId || undefined,
    projectId: form.projectId || undefined,
  };
}

// Asset Library "Add asset" (web/src/pages/AssetLibrary.jsx). type is the
// API's uppercase enum value; an empty description is not sent.
export function buildAssetCreatePayload(asset, clientId) {
  return {
    name: asset.name.trim(),
    type: asset.type,
    category: asset.category || undefined,
    url: asset.url.trim(),
    description: asset.description?.trim() || undefined,
    clientId: clientId.trim(),
  };
}

// POST /api/ai/chat takes a single `message` (aiChatSchema, at most 8000
// characters).
export const AI_CHAT_MESSAGE_MAX_LENGTH = 8000;

// Contracts "AI refine": returns null when the prompt would exceed the limit.
export function buildContractRefineChatPayload(instruction, contractContent) {
  const message = `Refine the following contract content with this instruction: "${instruction.trim()}"\n\nContract content:\n${contractContent}\n\nReturn only the revised contract content.`;
  return message.length > AI_CHAT_MESSAGE_MAX_LENGTH ? null : { message };
}
