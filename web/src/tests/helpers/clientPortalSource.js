import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// The client portal route is split across ClientPortal.jsx, lazily loaded
// sections in pages/client-portal/, and a static stylesheet (to keep the route
// chunk within budget). Source-level contracts assert against all of them.
const dir = resolve(process.cwd(), 'src/pages/client-portal');

export const clientPortalCss = () => readFileSync(resolve(dir, 'portal.css'), 'utf8');

export function clientPortalSource() {
  const parts = [readFileSync(resolve(process.cwd(), 'src/pages/ClientPortal.jsx'), 'utf8')];
  for (const file of readdirSync(dir).sort()) {
    if (/\.(jsx?|css)$/.test(file)) parts.push(readFileSync(resolve(dir, file), 'utf8'));
  }
  return parts.join('\n');
}
