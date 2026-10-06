import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import Modal, { ModalFooter } from './Modal';
import { Button, Field, Textarea } from './ui';

const RETURN_REASON_MAX = 1_000;

/**
 * Admin decision on a client reply waiting for approval: Approve, or Return
 * it to the writer with a reason. Approving sends nothing; the writer (or
 * anyone on the team) sends the approved text from the conversation.
 */
export default function ResponseReviewActions({ response, threadSubject, className }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['responses', 'pending'] });
    if (response.threadId) queryClient.invalidateQueries({ queryKey: ['thread', response.threadId] });
  };

  const approve = useMutation({
    mutationFn: () => api.approveResponse(response.id),
    onSuccess: () => {
      refresh();
      toast.success('Reply approved', 'Nothing was sent. It can now be sent from the conversation.');
    },
    onError: (error) => toast.error('Could not approve the reply', error?.message),
  });

  const sendBack = useMutation({
    mutationFn: () => api.rejectResponse(response.id, reason.trim()),
    onSuccess: () => {
      refresh();
      setReturning(false);
      setReason('');
      toast.success('Reply returned', 'The writer can see your reason on the conversation.');
    },
  });

  const busy = approve.isPending || sendBack.isPending;
  const closeReturn = () => {
    if (sendBack.isPending) return;
    sendBack.reset();
    setReturning(false);
  };
  const subject = threadSubject || response.thread?.subject;

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="sm"
          variant="success"
          onClick={() => approve.mutate()}
          loading={approve.isPending}
          disabled={busy}
          leftIcon={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
          aria-label={subject ? `Approve reply to ${subject}` : 'Approve reply'}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setReturning(true)}
          disabled={busy}
          leftIcon={<Undo2 className="w-4 h-4" aria-hidden="true" />}
          aria-label={subject ? `Return reply to ${subject}` : 'Return reply'}
        >
          Return…
        </Button>
      </div>

      <Modal isOpen={returning} onClose={closeReturn} title="Return to the writer" size="sm" showCloseButton={!sendBack.isPending}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) sendBack.mutate();
          }}
        >
          <Field
            label="What should change?"
            hint="The writer sees this on the conversation and can edit the draft and ask again."
            error={sendBack.error ? `${sendBack.error.message || 'The reply could not be returned.'} Try again.` : undefined}
            required
          >
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={RETURN_REASON_MAX}
              rows={4}
              disabled={sendBack.isPending}
              placeholder="For example: confirm the new launch date before promising it"
            />
          </Field>
          <ModalFooter className="flex-col-reverse sm:flex-row">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={closeReturn} disabled={sendBack.isPending}>
              Cancel
            </Button>
            <Button type="submit" className="w-full sm:w-auto" loading={sendBack.isPending} disabled={!reason.trim()}>
              Return reply
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
