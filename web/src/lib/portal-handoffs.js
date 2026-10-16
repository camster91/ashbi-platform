import { portalFetch } from '../pages/client-portal/shared';

async function request(projectId, token, suffix = '', options) {
  const response = await portalFetch(`/api/client-portal/projects/${encodeURIComponent(projectId)}/account-manager-requests${suffix}`, token, options);
  if (!response.ok) throw Object.assign(new Error('Team requests are unavailable.'), { status: response.status });
  return response.json();
}
export const portalHandoffs = {
  list: (projectId, token, after) => request(projectId, token, `?${new URLSearchParams({ limit: '20', ...(after ? { after } : {}) })}`),
  create: (projectId, token, body) => request(projectId, token, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  recover: (projectId, token, key) => request(projectId, token, `/by-intent/${encodeURIComponent(key)}`),
};
