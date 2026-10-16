import { portalFetch } from '../pages/client-portal/shared';

async function request(projectId, token, suffix = '', body) {
  const response = await portalFetch(`/api/client-portal/projects/${encodeURIComponent(projectId)}/assistant${suffix}`, token,
    body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw Object.assign(new Error('Assistant request unavailable.'), { status: response.status });
  return response.json();
}
export const portalAssistant = {
  list: (id, token, after) => request(id, token, `?${new URLSearchParams({ limit: '20', ...(after ? { after } : {}) })}`),
  create: (id, token, body) => request(id, token, '/runs', body),
  byIntent: (id, token, key) => request(id, token, `/runs/by-intent/${encodeURIComponent(key)}`),
  get: (id, token, runId) => request(id, token, `/runs/${encodeURIComponent(runId)}`),
  dispatch: (id, token, runId) => request(id, token, `/runs/${encodeURIComponent(runId)}/dispatch`, {}),
  cancel: (id, token, runId) => request(id, token, `/runs/${encodeURIComponent(runId)}/cancel`, {}),
  recover: (id, token, runId) => request(id, token, `/runs/${encodeURIComponent(runId)}/recover`, {}),
};
