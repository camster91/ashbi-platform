import { exec } from 'child_process';

export function notify(text) {
  // openclaw wake sends a cron wake event to the main session
  // Use --text as a single quoted arg to avoid shell splitting issues
  const escaped = JSON.stringify(text); // safely quote for shell
  exec(`openclaw cron wake --text ${escaped}`, (err) => {
    if (err) {
      // Fallback: write to a notify file the agent can pick up on heartbeat
      import('fs').then(({ writeFileSync }) => {
        try {
          writeFileSync('upwork-notify.txt', text, 'utf8');
        } catch { /* ignore */ }
      });
      console.error('Notify error:', err.message);
    }
  });
}
