import { ToolError, recordNotFound, targetUnavailable } from '../ai/tools/registry.js';

// Preserve governed denial auditing instead of turning an authorization failure
// from a shared API service into an unclassified read/tool execution error.
export async function wikiToolCall(work) {
  try { return await work(); }
  catch (error) {
    if (error instanceof ToolError) throw error;
    if (error.statusCode === 404) throw recordNotFound('Knowledge page or teammate unavailable');
    if (error.statusCode === 403) throw new ToolError('FORBIDDEN', error.message, { statusCode: 403 });
    if (error.statusCode === 409) throw targetUnavailable(error.message);
    if (error.statusCode === 400) throw new ToolError('INVALID_INPUT', error.message, { statusCode: 400 });
    throw error;
  }
}
