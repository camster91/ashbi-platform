// Stdio adapter for clients that cannot send an Authorization header over HTTP.
// All authorization and execution stay on the remote Ashbi server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

try {
  const url = new URL(process.env.ASHBI_MCP_URL ?? '');
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('ASHBI_MCP_URL requires HTTPS (HTTP allowed only on loopback), without credentials or query parameters');
  }
  const key = process.env.ASHBI_API_KEY;
  if (!key?.startsWith('ashbi_')) throw new Error('Set ASHBI_API_KEY to a scoped Ashbi API key');
  const client = new Client({ name: 'ashbi-stdio-adapter', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  }));
  const server = new Server({ name: 'ashbi-workspace', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, request => client.listTools(request.params));
  server.setRequestHandler(CallToolRequestSchema, request => client.callTool(request.params));
  await server.connect(new StdioServerTransport());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await server.close(); await client.close(); process.exit(0);
  });
} catch {
  // Never print transport errors, which may contain request headers.
  process.stderr.write('Ashbi MCP connection failed. Check ASHBI_MCP_URL, ASHBI_API_KEY and server availability.\n');
  process.exitCode = 1;
}
