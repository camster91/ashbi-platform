function text(value) {
  return String(value ?? '').trim();
}

function check(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

function isNonProductionLabel(value) {
  const normalized = text(value).toLowerCase();
  return normalized.length >= 8
    && /(^|[._-])(sandbox|staging|test)([._-]|$)/.test(normalized)
    && !/production|(^|[_-])prod($|[_-])|live/.test(normalized);
}

function isNonProductionUrl(value) {
  try {
    const url = new URL(text(value));
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol)
      && !['ashbi.ca', 'www.ashbi.ca', 'hub.ashbi.ca'].includes(host)
      && (host === 'localhost' || host === '127.0.0.1' || /(^|[.-])(sandbox|staging|test)([.-]|$)/.test(host));
  } catch {
    return false;
  }
}

function isNonProductionDatabase(value) {
  try {
    const url = new URL(text(value));
    const target = `${url.hostname}${url.pathname}`.toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && /(^|[._/-])(sandbox|staging|test)([._/-]|$)/.test(target)
      && !/production|(^|[_-])prod($|[_-])/.test(target);
  } catch {
    return false;
  }
}

function hasExactReviewOrigin(value) {
  const origins = text(value).split(',').map((item) => item.trim()).filter(Boolean);
  return origins.length > 0 && origins.every((item) => {
    try {
      const url = new URL(item);
      return item === url.origin && isNonProductionUrl(item) && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}

export function assessPublicIntakeEnvironment(environment = {}) {
  const checks = [
    check(
      'sandbox-flag',
      text(environment.ASHBI_SANDBOX).toLowerCase() === 'true',
      'Explicit sandbox mode is enabled.',
      'Enable explicit sandbox mode before intake target inspection.',
    ),
    check(
      'environment-id',
      isNonProductionLabel(environment.ASHBI_SANDBOX_ENVIRONMENT_ID),
      'A non-production environment identifier is configured.',
      'Configure a specific sandbox, staging, or test environment identifier.',
    ),
    check(
      'target-url',
      isNonProductionUrl(environment.APP_URL),
      'The Hub URL is an identifiable non-production target.',
      'The Hub URL must identify a sandbox, staging, test, or localhost target.',
    ),
    check(
      'database-target',
      isNonProductionDatabase(environment.DATABASE_URL),
      'The database is identifiable as non-production.',
      'The database name or host must explicitly identify a sandbox, staging, or test target.',
    ),
    check(
      'organization-configured',
      text(environment.PUBLIC_INTAKE_ORGANIZATION_ID).length >= 8,
      'A target organization identifier is configured.',
      'Configure the exact target organization identifier.',
    ),
    check(
      'owner-configured',
      text(environment.PUBLIC_INTAKE_OWNER_USER_ID).length >= 8,
      'A target owner identifier is configured.',
      'Configure the exact active staff owner identifier.',
    ),
    check(
      'privacy-version',
      /^\d{4}-\d{2}-\d{2}(?:\.[A-Za-z0-9_-]+)?$/.test(text(environment.PUBLIC_INTAKE_PRIVACY_VERSION)),
      'A versioned privacy notice is configured.',
      'Configure the reviewed privacy notice version.',
    ),
    check(
      'review-origin',
      hasExactReviewOrigin(environment.PUBLIC_INTAKE_ALLOWED_ORIGINS),
      'At least one exact non-production browser origin is allowed.',
      'Allow an exact sandbox, staging, test, or localhost browser origin without a wildcard.',
    ),
  ];

  return { ready: checks.every((item) => item.ok), checks };
}

const REQUIRED_INTAKE_MIGRATIONS = [
  '20260826173000_public_client_acquisition_intake',
  '20260826234500_lead_pipeline_promotion',
  '20260827013000_lead_follow_up_control',
];

export async function inspectPublicIntakeTarget({ environment = {}, prisma }) {
  const environmentReport = assessPublicIntakeEnvironment(environment);
  if (!environmentReport.ready) {
    return { ready: false, inspected: false, checks: environmentReport.checks };
  }

  try {
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name IN (
        '20260826173000_public_client_acquisition_intake',
        '20260826234500_lead_pipeline_promotion',
        '20260827013000_lead_follow_up_control'
      )
    `;
    const organizationId = text(environment.PUBLIC_INTAKE_ORGANIZATION_ID);
    const ownerUserId = text(environment.PUBLIC_INTAKE_OWNER_USER_ID);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    const owner = await prisma.user.findFirst({
      where: {
        id: ownerUserId,
        organizationId,
        isActive: true,
        role: { in: ['ADMIN', 'TEAM'] },
      },
      select: { id: true },
    });
    const appliedMigrations = new Set(
      migrations
        .filter((migration) => migration.finished_at && !migration.rolled_back_at)
        .map((migration) => migration.migration_name),
    );
    const checks = [
      ...environmentReport.checks,
      check(
        'required-migrations',
        REQUIRED_INTAKE_MIGRATIONS.every((name) => appliedMigrations.has(name)),
        'Every required intake migration is finished and active.',
        'One or more required intake migrations are missing, unfinished, or rolled back.',
      ),
      check(
        'organization-exists',
        Boolean(organization),
        'The configured target organization exists.',
        'The configured target organization was not found.',
      ),
      check(
        'owner-active-staff',
        Boolean(owner),
        'The configured owner is active staff in the target organization.',
        'The configured owner is not active staff in the target organization.',
      ),
    ];
    return { ready: checks.every((item) => item.ok), inspected: true, checks };
  } catch {
    return {
      ready: false,
      inspected: true,
      checks: [
        ...environmentReport.checks,
        check(
          'target-inspection',
          false,
          'The target inspection completed.',
          'The target database could not be inspected safely.',
        ),
      ],
    };
  }
}
