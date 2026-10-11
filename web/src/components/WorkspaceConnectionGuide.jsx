import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import actionsSchema from '../../../docs/workspace-actions.openapi.json';
import { Button } from './ui';

export default function WorkspaceConnectionGuide() {
  const [feedback, setFeedback] = useState(null);
  const origin = window.location.origin;
  const endpoints = [
    { label: 'MCP endpoint', url: `${origin}/api/mcp` },
    { label: 'Tool discovery', url: `${origin}/api/agent/tools` },
  ];

  async function copy(label, text) {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback({ message: `${label} copied.`, error: false });
    } catch {
      setFeedback({ message: 'Copy failed. Select the URL and copy it manually.', error: true });
    }
  }

  function downloadSchema() {
    const document = { ...actionsSchema, servers: [{ url: origin }] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'ashbi-workspace-actions.openapi.json';
    link.click();
    URL.revokeObjectURL(url);
    setFeedback({ message: 'Actions schema downloaded for this workspace host.', error: false });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4 mb-5">
      <h3 className="text-sm font-semibold">Connect your assistant</h3>
      <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
        <li>Create a named key below with Read workspace access.</li>
        <li>Store the key in your assistant’s authentication settings as a Bearer token.</li>
        <li>Ask it to list projects to verify the connection.</li>
      </ol>
      <div className="space-y-3">
        {endpoints.map(({ label, url }) => (
          <div key={label} className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{label}</p>
              <code className="text-xs break-all select-all">{url}</code>
            </div>
            <Button variant="secondary" size="sm" onClick={() => copy(label, url)} aria-label={`Copy ${label}`}>
              <Copy className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Use ChatGPT with GPT Actions</summary>
        <div className="space-y-3 mt-3 text-muted-foreground">
          <p>In your custom GPT’s Actions settings, import this schema and configure API key authentication with Bearer auth. It already uses this app’s URL. Test list_projects in GPT Preview.</p>
          <Button variant="secondary" size="sm" onClick={downloadSchema} leftIcon={<Download className="w-4 h-4" />}>Download Actions schema</Button>
          <p>Direct ChatGPT MCP connections need OAuth, which Ashbi does not support yet. Other MCP clients that accept a Bearer API key can use the endpoint above.</p>
        </div>
      </details>
      <p className="text-xs text-muted-foreground">Add Workspace actions only when needed. Task and calendar writes return a preview; review it before confirming. Never paste your key into a chat or prompt.</p>
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`text-sm ${feedback.error ? 'text-destructive' : 'text-muted-foreground'}`}>{feedback.message}</p>}
    </div>
  );
}
