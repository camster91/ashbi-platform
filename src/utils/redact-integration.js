// Strip OAuth secrets from integration records before returning to clients.

const SECRET_FIELDS = ['accessToken', 'refreshToken'];

export function redactIntegration(integration) {
  if (!integration) return integration;
  const redacted = { ...integration };
  for (const field of SECRET_FIELDS) {
    if (redacted[field]) redacted[field] = '[REDACTED]';
  }
  return redacted;
}

export function redactIntegrations(integrations) {
  return integrations.map(redactIntegration);
}
