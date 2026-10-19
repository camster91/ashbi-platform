import { Check } from 'lucide-react';

// Read-only explanation of what a connected agent can do with each API key
// scope (Settings mockup: "What Claude can do" and "Safety rules"). Every
// statement mirrors a server rule: src/auth/api-key-scopes.js,
// src/routes/api-key.routes.js and src/integrations/workspace-tools.js.
// The mockup's per-area toggles and editable rules are not implemented:
// access is chosen per key, by scope, when the key is created.

const ACCESS_ROWS = [
  { scope: 'Read workspace', see: 'Yes', prepare: 'No', unattended: 'Never' },
  { scope: 'Workspace actions', see: 'No', prepare: 'Yes, as a preview', unattended: 'Never' },
  { scope: 'Embedded AI chat (legacy)', see: 'Yes', prepare: 'No', unattended: 'Never' },
  { scope: 'AI bridge actions (legacy)', see: 'No', prepare: 'Yes, as a preview', unattended: 'Never' },
];

const headClass = 'py-2 px-2 text-eyebrow font-normal text-muted-foreground';

export function AgentAccessTable() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        An agent works as the person who created its key, so it never sees more than your role allows.
        &ldquo;Prepare&rdquo; means the agent builds a preview; nothing changes until a separate confirm call runs it.
      </p>
      <div tabIndex={0} role="region" aria-label="Agent access by scope" className="overflow-x-auto rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${headClass} pl-0 text-left`}>Scope</th>
              <th scope="col" className={`${headClass} text-center`}>See</th>
              <th scope="col" className={`${headClass} text-center`}>Prepare</th>
              <th scope="col" className={`${headClass} pr-0 text-center`}>Change without confirming</th>
            </tr>
          </thead>
          <tbody>
            {ACCESS_ROWS.map((row) => (
              <tr key={row.scope} className="border-t border-border/40">
                <th scope="row" className="py-2.5 pr-2 text-left font-semibold text-foreground">{row.scope}</th>
                <td className="py-2.5 px-2 text-center text-foreground">{row.see}</td>
                <td className="py-2.5 px-2 text-center text-foreground">{row.prepare}</td>
                <td className="py-2.5 pl-2 text-center text-muted-foreground">{row.unattended}</td>
              </tr>
            ))}
            <tr className="border-t border-border/40">
              <th scope="row" className="py-2.5 pr-2 text-left font-semibold text-foreground">Client site logins</th>
              <td colSpan={3} className="py-2.5 pl-2 text-center text-muted-foreground">Never shared with agents</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SAFETY_RULES = [
  'Every change an agent prepares waits as a preview until a separate confirm call runs it.',
  'An agent can send that confirm call with its own key, so give Workspace actions only to agents you trust to check with you first.',
  'Creating a key asks for your password or two-factor code.',
  'Keys expire after at most one year, and you can revoke one at any time.',
  'Each person can have up to five active keys.',
  'Publishing a saved client report needs an administrator.',
  'Workspace tools never read stored client logins.',
];

export function AgentSafetyRules() {
  return (
    <ul className="divide-y divide-border/40 text-sm">
      {SAFETY_RULES.map((rule) => (
        <li key={rule} className="flex min-h-11 items-start gap-2.5 py-2.5 text-foreground">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <span>{rule}</span>
        </li>
      ))}
    </ul>
  );
}
