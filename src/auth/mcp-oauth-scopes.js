// Defaults stay read-only. Optional scopes never imply broad workspace:actions.
export const MCP_OAUTH_DEFAULT_SCOPES = Object.freeze(['workspace:read']);
export const MCP_OAUTH_ACTION_SCOPES = Object.freeze({
  create_client_task: 'workspace:client-tasks:write',
  publish_client_service_report_snapshot: 'workspace:service-reports:publish',
});
export const MCP_OAUTH_OPTIONAL_SCOPES = Object.freeze([
  { scope: 'workspace:client-tasks:write', label: 'Create client task proposals and confirm them' },
  { scope: 'workspace:service-reports:publish', label: 'Publish saved client reports, including replacement or removal' },
]);
export const MCP_OAUTH_SUPPORTED_SCOPES = Object.freeze([...MCP_OAUTH_DEFAULT_SCOPES, ...MCP_OAUTH_OPTIONAL_SCOPES.map(row => row.scope)]);
export const hasMcpWriteScope = scopes => scopes?.some(scope => Object.values(MCP_OAUTH_ACTION_SCOPES).includes(scope));
export function normalizeMcpScopes(scopes) {
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => !MCP_OAUTH_SUPPORTED_SCOPES.includes(scope)) || !scopes.includes('workspace:read')) return null;
  return MCP_OAUTH_SUPPORTED_SCOPES.filter(scope => scopes.includes(scope));
}
