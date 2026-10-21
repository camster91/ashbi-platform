import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { Alert, Button, Field, Textarea } from '../ui';

// The client's pinned note (Client.clientNotes), edited in place by staff.
// Saved with PUT /api/clients/:id { clientNotes }; an empty note is cleared.
// The page owns `editing` so its header "Add note" button can open the form.

export const CLIENT_NOTE_MAX_LENGTH = 10_000;

export default function ClientNotePanel({ clientId, note, canEdit, editing, onEditingChange }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(note || '');
  const textareaRef = useRef(null);
  const editButtonRef = useRef(null);
  const restoreFocus = useRef(false);
  const errorId = useId();

  const save = useMutation({
    mutationFn: (value) => api.updateClient(clientId, { clientNotes: value }),
    onSuccess: (saved, value) => {
      // Only the note changed; keep the rest of the cached client (its money
      // summary is not in the PUT response) and refresh it in the background.
      queryClient.setQueryData(['client', clientId], (current) => (current ? { ...current, clientNotes: saved?.clientNotes ?? value } : current));
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      restoreFocus.current = true;
      onEditingChange(false);
    },
  });

  // Opening the form starts from the saved note and puts the cursor in it.
  useEffect(() => {
    if (editing) {
      setDraft(note || '');
      save.reset();
      textareaRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButtonRef.current?.focus();
    }
    // Only when the form opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const trimmed = draft.trim();
  const tooLong = draft.length > CLIENT_NOTE_MAX_LENGTH;
  const unchanged = trimmed === (note || '').trim();

  if (!editing && !note) return null;

  const cancel = () => {
    restoreFocus.current = true;
    onEditingChange(false);
  };

  return (
    <section aria-labelledby="client-note-heading" className="rounded-lg border border-accent bg-accent/25 p-5 text-foreground">
      <div className="flex items-start justify-between gap-2">
        <h2 id="client-note-heading" className="text-eyebrow">Pinned note</h2>
        {canEdit && !editing && (
          <Button ref={editButtonRef} variant="ghost" size="xs" type="button" className="-my-3 -mr-3" onClick={() => onEditingChange(true)} aria-label="Edit pinned note">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (tooLong || save.isPending) return;
            save.mutate(trimmed ? trimmed : null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !save.isPending) {
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <Field
            label="Note"
            hint={`Only your team sees this. ${draft.length.toLocaleString()} of ${CLIENT_NOTE_MAX_LENGTH.toLocaleString()} characters.`}
            error={tooLong ? 'This note is too long. Shorten it to save.' : undefined}
          >
            <Textarea
              ref={textareaRef}
              value={draft}
              rows={5}
              onChange={(event) => setDraft(event.target.value)}
              disabled={save.isPending}
              aria-describedby={save.isError ? errorId : undefined}
            />
          </Field>
          {save.isError && (
            <Alert id={errorId} variant="error" title="The note was not saved">
              {save.error?.message && save.error.message !== 'Request failed' ? `${save.error.message}. ` : ''}Your text is still here. Try again.
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={tooLong || unchanged}>
              {trimmed || !note ? 'Save note' : 'Clear note'}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={cancel}>Cancel</Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words">{note}</p>
      )}
    </section>
  );
}
