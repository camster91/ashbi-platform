const REQUIRED_COMPOSE_MARKERS = Object.freeze([
  'name: ashbi-migration-sandbox',
  'image: pgvector/pgvector:pg16',
  'POSTGRES_DB: ashbi_sandbox',
  'image: redis:7-alpine',
  'ashbi-migration-sandbox-postgres:',
  'ashbi-migration-sandbox-redis:',
  'name: ashbi-migration-sandbox\n',
]);

const REQUIRED_ENV_MARKERS = Object.freeze([
  'NODE_ENV=production',
  'APP_URL=http://localhost:13002',
  'DATABASE_URL=postgresql://ashbi_sandbox:REPLACE_WITH_SANDBOX_DB_PASSWORD@postgres:5432/ashbi_sandbox?schema=public',
  'REDIS_URL=redis://:REPLACE_WITH_SANDBOX_REDIS_PASSWORD@redis:6379',
  'ASHBI_SANDBOX=true',
  'ASHBI_SANDBOX_ENVIRONMENT_ID=ashbi-migration-sandbox',
  'ASHBI_SANDBOX_ORGANIZATION_ID=',
  'operator+sandbox@example.test',
  'client+sandbox@example.test',
]);

const REQUIRED_RUNBOOK_MARKERS = Object.freeze([
  '--root-dir /opt/ashbi-platform-migration-sandbox',
  '--container ashbi-platform-migration-sandbox',
  '--worker-container ashbi-platform-migration-sandbox-worker',
  '--host-port 13002 --network ashbi-migration-sandbox',
  'ssh -L 13002:127.0.0.1:13002 coolify',
]);

const REQUIRED_RELEASE_GUARD_MARKERS = Object.freeze([
  'MIGRATION_SANDBOX_ROOT=/opt/ashbi-platform-migration-sandbox',
  'MIGRATION_SANDBOX_CONTAINER=ashbi-platform-migration-sandbox',
  'MIGRATION_SANDBOX_WORKER=ashbi-platform-migration-sandbox-worker',
  'MIGRATION_SANDBOX_PORT=13002',
  'MIGRATION_SANDBOX_NETWORK=ashbi-migration-sandbox',
  'if [[ $ENVIRONMENT == migration-sandbox ]]; then',
  '[[ $ROOT_DIR == "$MIGRATION_SANDBOX_ROOT" ]]',
  '[[ $CONTAINER == "$MIGRATION_SANDBOX_CONTAINER" ]]',
  '[[ $WORKER_CONTAINER == "$MIGRATION_SANDBOX_WORKER" ]]',
  '[[ $HOST_PORT == "$MIGRATION_SANDBOX_PORT" ]]',
  '[[ $NETWORK == "$MIGRATION_SANDBOX_NETWORK" ]]',
  '[[ $ROOT_DIR != "$MIGRATION_SANDBOX_ROOT" ]]',
  '[[ $NETWORK != "$MIGRATION_SANDBOX_NETWORK" ]]',
]);

function check(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

export function assessMigrationSandboxInfrastructure({ composeText = '', environmentTemplate = '', runbookText = '', releaseScriptText = '' } = {}) {
  const compose = String(composeText).replace(/\r\n/g, '\n');
  const environment = String(environmentTemplate).replace(/\r\n/g, '\n');
  const runbook = String(runbookText).replace(/\r\n/g, '\n');
  const releaseScript = String(releaseScriptText).replace(/\r\n/g, '\n');
  const releaseGuardIndex = releaseScript.indexOf('if [[ $ENVIRONMENT == migration-sandbox ]]');
  const firstDockerMutationIndex = releaseScript.indexOf('docker load -i');
  const checks = [
    check('isolated-compose-identities', REQUIRED_COMPOSE_MARKERS.every(marker => compose.includes(marker)),
      'The data services, volumes, and network use migration-sandbox identities.',
      'Use only the dedicated migration-sandbox service, volume, and network identities.'),
    check('no-datastore-host-ports', !/^\s*ports\s*:/m.test(compose) && !/network_mode\s*:\s*host/i.test(compose),
      'The sandbox data stores publish no host ports.',
      'Remove datastore host ports and host networking.'),
    check('no-production-compose-targets', !/container_name|hub\.ashbi\.ca|ashbi-platform-worker\s*$|external\s*:\s*true/im.test(compose),
      'The data stack contains no production container, route, or external-network target.',
      'Remove production container, route, and external-network references.'),
    check('safe-environment-template', REQUIRED_ENV_MARKERS.every(marker => environment.includes(marker))
      && !/sk_live_|rk_live_|@ashbi\.ca|DATABASE_URL=.*\/(ashbi|production)(\?|$)/i.test(environment),
    'The environment template is sandbox-labelled and contains no live provider or production identity.',
    'Use only sandbox-labelled placeholder values and reserved synthetic identities.'),
    check('provider-values-deferred', ['STRIPE_SECRET_KEY=', 'STRIPE_WEBHOOK_SECRET=', 'MAILGUN_API_KEY=', 'MAILGUN_DOMAIN=']
      .every(marker => environment.includes(marker)) && !/STRIPE_SECRET_KEY=.+|MAILGUN_API_KEY=.+/m.test(environment),
    'Provider credentials remain empty until the separate provider-sandbox gate.',
    'Leave provider credentials empty in the migration-only template.'),
    check('explicit-deployment-isolation', REQUIRED_RUNBOOK_MARKERS.every(marker => runbook.includes(marker)),
      'The deployment procedure explicitly overrides root, containers, port, and network.',
      'Document every isolation override and loopback-only access path.'),
    check('release-controller-fail-closed', REQUIRED_RELEASE_GUARD_MARKERS.every(marker => releaseScript.includes(marker))
      && releaseGuardIndex >= 0 && firstDockerMutationIndex > releaseGuardIndex,
    'The release controller enforces the exact sandbox identities before any Docker mutation.',
    'Make the release controller reject missing or mixed sandbox identities before loading an image.'),
  ];
  return { ready: checks.every(item => item.ok), checks };
}
