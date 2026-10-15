import Button from './ui/Button';

const COPY = {
  PREPARED: 'A send attempt is saved for this draft. Check its delivery status before starting another send.',
  UNKNOWN: 'Email delivery is uncertain. It may already have been sent. Check the status; do not send a replacement email.',
  DISPATCHING: 'This email is being dispatched. Check its status before taking another action.',
  ACCEPTED_PENDING_RECORD: 'Gmail accepted the email, but Hub has not finished saving its record. Finish saving without sending another email.',
  COMPLETED: 'The email was sent and its Hub record is saved.',
  REJECTED: 'This send attempt was rejected. No email was accepted for delivery.',
  NOT_DISPATCHED: 'The server has no dispatched send attempt for this saved key. You can clear it and review the draft before sending.',
};

export default function GmailSendRecovery({ recovery }) {
  const { intent, status, storageError, error, checking, reconciling, checkReceipt, reconcileReceipt, clearConfirmedIntent } = recovery;
  if (!intent && !storageError) return null;
  const terminal = ['COMPLETED', 'REJECTED', 'NOT_DISPATCHED'].includes(status);
  return <section aria-label="Email delivery status" className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
    {storageError && <p role="alert">Browser storage could not retain this send attempt. Sending is blocked. Restore browser storage before continuing.</p>}
    {intent && <p role="status">{COPY[status] || COPY.UNKNOWN}</p>}
    {error && <p role="alert">{error}</p>}
    {intent && <div className="flex flex-wrap gap-2">
      {!terminal && <Button type="button" size="sm" variant="outline" loading={checking} disabled={reconciling} onClick={checkReceipt}>Check delivery status</Button>}
      {status === 'ACCEPTED_PENDING_RECORD' && <Button type="button" size="sm" loading={reconciling} disabled={checking || storageError} onClick={reconcileReceipt}>Finish saving sent email</Button>}
      {terminal && <Button type="button" size="sm" variant="outline" disabled={checking || reconciling || storageError} onClick={clearConfirmedIntent}>Clear confirmed send attempt</Button>}
    </div>}
  </section>;
}
