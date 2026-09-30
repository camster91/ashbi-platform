import { pathToFileURL } from 'node:url';

// No production credentials or response bodies are written to logs.
export async function release(env, { fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log } = {}) {
  const sha = env.RELEASE_SHA;
  const uuid = env.COOLIFY_APP_UUID;
  const branch = env.RELEASE_BRANCH;
  if (env.COOLIFY_RELEASE_ENABLED !== 'true') throw new Error('Release adoption has not been enabled');
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('A full verified release SHA is required');
  if (!/^[a-zA-Z0-9]+$/.test(uuid || '')) throw new Error('Invalid Coolify resource identifier');
  if (branch !== 'main') throw new Error('Invalid production branch');
  if (!env.COOLIFY_TOKEN) throw new Error('Missing Coolify token');
  const origin = new URL(env.COOLIFY_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)) {
    throw new Error('Coolify URL must be a trusted HTTPS origin');
  }
  const health = new URL('https://hub.ashbi.ca/api/health?strict=1');
  async function api(path, method = 'GET', body) {
    const response = await fetchImpl(new URL(`/api/v1${path}`, origin), {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${env.COOLIFY_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Coolify request failed (HTTP ${response.status})`);
    return response.json();
  }
  function validateResource(app) {
    const repository = (app.git_repository || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (app.uuid !== uuid || repository.toLowerCase() !== 'camster91/ashbi-platform' || app.git_branch !== branch || app.build_pack !== 'dockercompose'
      || app.docker_compose_location !== '/docker-compose.coolify.yml') {
      throw new Error('Coolify resource does not match the approved application');
    }
    const domainMap = typeof app.docker_compose_domains === 'string' ? JSON.parse(app.docker_compose_domains) : app.docker_compose_domains;
    const domains = (domainMap?.app?.domain || '').split(',').map(value => value.trim());
    if (!domains.includes('https://hub.ashbi.ca') || Number(app.domain_port_overrides?.['https://hub.ashbi.ca']) !== 3002) {
      throw new Error('Coolify resource does not own the expected production domain and API port');
    }
    const automatic = app.is_auto_deploy_enabled ?? app.settings?.is_auto_deploy_enabled;
    if (automatic !== false) throw new Error('Direct Git auto-deploy must be disabled to preserve the CI gate');
    if ((app.include_source_commit_in_build ?? app.settings?.include_source_commit_in_build) !== true) {
      throw new Error('Source revision metadata must be enabled for the API and worker');
    }
  }
  const original = await api(`/applications/${uuid}`);
  validateResource(original);
  await api(`/applications/${uuid}`, 'PATCH', { git_commit_sha: sha });
  const pinned = await api(`/applications/${uuid}`);
  validateResource(pinned);
  if (pinned.git_commit_sha !== sha) throw new Error('Coolify did not retain the verified release SHA');
  const queued = await api('/deploy', 'POST', { uuid });
  const deployment = queued.deployments?.find(item => item.resource_uuid === uuid);
  if (!/^[a-zA-Z0-9]+$/.test(deployment?.deployment_uuid || '')) throw new Error('Coolify did not return a matching deployment');
  log(`Queued verified revision ${sha}; previous source pin ${/^[a-f0-9]{40}$/.test(original.git_commit_sha || '') ? original.git_commit_sha : 'unrecorded'}`);
  for (let poll = 0; poll < 120; poll++) {
    const result = await api(`/deployments/${deployment.deployment_uuid}`);
    if (result.status === 'finished') {
      if (result.commit !== sha) throw new Error('Finished deployment revision does not match verified CI');
      const response = await fetchImpl(health, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error('Public database readiness check failed');
      const readiness = await response.json();
      if (readiness.status !== 'ok' || readiness.ready !== true
        || ['database', 'redis', 'worker'].some(name => readiness.checks?.[name]?.status !== 'ok')) {
        throw new Error('Public strict API and worker readiness check failed');
      }
      if (readiness.revision !== sha) throw new Error('Public serving revision does not match verified CI');
      log(`Coolify finished revision ${sha}; public serving revision and strict API/worker readiness passed`);
      return { sha, deploymentUuid: deployment.deployment_uuid };
    }
    if (!['queued', 'in_progress', 'pending'].includes(result.status)) throw new Error('Coolify deployment failed or returned an unknown status');
    await sleep(10000);
  }
  throw new Error('Coolify deployment timed out; inspect the specific deployment before retrying');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  release(process.env).catch(error => { console.error(error.message); process.exitCode = 1; });
}
