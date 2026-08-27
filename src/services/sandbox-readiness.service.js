function text(value) {
  return String(value ?? '').trim();
}

function check(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

function isSyntheticEmail(value) {
  const email = text(value).toLowerCase();
  return email.includes('+sandbox@') || email.endsWith('@example.com') || email.endsWith('@example.test');
}

function isSandboxUrl(value) {
  try {
    const url = new URL(text(value));
    const host = url.hostname.toLowerCase();
    return !['ashbi.ca', 'www.ashbi.ca', 'hub.ashbi.ca'].includes(host)
      && (host === 'localhost' || /(^|[.-])(sandbox|staging|test)([.-]|$)/.test(host));
  } catch {
    return false;
  }
}

function isSandboxDatabase(value) {
  try {
    const url = new URL(text(value));
    const target = `${url.hostname}${url.pathname}`.toLowerCase();
    return /sandbox|staging|test/.test(target) && !/production|(^|[_-])prod($|[_-])/.test(target);
  } catch {
    return false;
  }
}

export function assessSandboxReadiness(environment = {}) {
  const environmentId = text(environment.ASHBI_SANDBOX_ENVIRONMENT_ID).toLowerCase();
  const approvalReference = text(environment.ASHBI_SANDBOX_APPROVAL_REFERENCE).toLowerCase();
  const mailgunDomain = text(environment.MAILGUN_DOMAIN).toLowerCase();
  const checks = [
    check(
      'sandbox-flag',
      text(environment.ASHBI_SANDBOX).toLowerCase() === 'true',
      'Explicit sandbox flag is enabled.',
      'Set the explicit sandbox flag before provider validation.',
    ),
    check(
      'environment-id',
      environmentId.length >= 8 && /sandbox|staging|test/.test(environmentId) && !/production|(^|[_-])prod($|[_-])|live/.test(environmentId),
      'A non-production environment identifier is recorded.',
      'Record a specific non-production environment identifier.',
    ),
    check(
      'target-url',
      isSandboxUrl(environment.APP_URL),
      'The application URL is an identifiable non-production target.',
      'The application URL must identify a sandbox, staging, test, or localhost target.',
    ),
    check(
      'database-target',
      isSandboxDatabase(environment.DATABASE_URL),
      'The database target is identifiable as non-production.',
      'The database target must be explicitly identifiable as sandbox, staging, or test.',
    ),
    check(
      'synthetic-staff',
      isSyntheticEmail(environment.ASHBI_SANDBOX_STAFF_EMAIL),
      'A synthetic staff identity is recorded.',
      'Record a synthetic staff identity using a sandbox or reserved test address.',
    ),
    check(
      'synthetic-client',
      isSyntheticEmail(environment.ASHBI_SANDBOX_CLIENT_EMAIL),
      'A synthetic client identity is recorded.',
      'Record a synthetic client identity using a sandbox or reserved test address.',
    ),
    check(
      'backup-reference',
      text(environment.ASHBI_SANDBOX_BACKUP_REFERENCE).length >= 12,
      'A backup reference is recorded.',
      'Record the verified backup reference before changing sandbox data.',
    ),
    check(
      'approval-reference',
      approvalReference.length >= 12 && !/pending|tbd|todo|placeholder/.test(approvalReference),
      'An action-time approval reference is recorded.',
      'Record Cameron’s exact action-time approval reference; pending approval is not sufficient.',
    ),
    check(
      'stripe-restricted-test-key',
      text(environment.STRIPE_SECRET_KEY).startsWith('rk_test_'),
      'A restricted Stripe test-mode key is configured.',
      'Use a least-privilege restricted Stripe test-mode key; live or broad secret keys are rejected.',
    ),
    check(
      'stripe-webhook-secret',
      text(environment.STRIPE_WEBHOOK_SECRET).startsWith('whsec_'),
      'A Stripe webhook signing secret is configured.',
      'Configure the sandbox endpoint webhook signing secret.',
    ),
    check(
      'mailgun-sandbox',
      text(environment.MAILGUN_API_KEY).length >= 12
        && mailgunDomain !== 'ashbi.ca'
        && /sandbox|test/.test(mailgunDomain),
      'A non-production Mailgun domain and credential are configured.',
      'Use a Mailgun sandbox or test domain; the production Ashbi domain is rejected.',
    ),
  ];

  return {
    ready: checks.every((item) => item.ok),
    checks,
  };
}
