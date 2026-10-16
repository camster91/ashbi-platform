import { lazy, Suspense, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const SavedReports = lazy(() => import('./ClientServiceReports'));
export default function ClientServicePanels({ clientId }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!clientId || !user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) return null;
  return <details className="rounded-lg border border-border bg-card p-4" onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-medium">Saved reports</summary>
    {open && <Suspense fallback={<p role="status">Loading saved reports...</p>}><SavedReports key={`${user.organizationId}:${user.id}:${user.role}:${clientId}`} clientId={clientId} user={user} /></Suspense>}
  </details>;
}
