import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import Modal from '../Modal';
import { Alert, Button, Field, Input } from '../ui';

// "Client portal" on the client page (admins only). Uses the existing
// invitation flow, POST /api/auth/admin/clients/:clientId/invite: the person
// gets an email with a 7-day, single-use link to /client/invite, where they
// confirm the invited address and choose a password. Nothing new is issued
// here; contacts can also ask for a sign-in link from the portal's own page.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ClientPortalAccess({ clientId, clientName, contacts = [], isOpen, onClose }) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [copied, setCopied] = useState(false);

  const invite = useMutation({
    mutationFn: (address) => api.inviteClientToPortal(clientId, address),
    onMutate: () => setCopied(false),
  });

  const close = () => {
    if (invite.isPending) return;
    invite.reset();
    setEmail('');
    setEmailError('');
    onClose();
  };

  const send = (address) => {
    const value = String(address || '').trim();
    if (!EMAIL_PATTERN.test(value)) {
      setEmailError('Enter an email address like name@example.com.');
      return;
    }
    setEmailError('');
    invite.mutate(value);
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const sent = invite.data;
  const pendingEmail = invite.isPending ? invite.variables : null;
  const contactsWithEmail = contacts.filter((contact) => contact.email);

  return (
    <Modal isOpen={isOpen} onClose={close} title="Client portal" size="md">
      <div className="space-y-5 text-sm">
        <p className="text-muted-foreground">
          Invite someone at {clientName} to the client portal. They get an email with a link that works once and
          expires in 7 days, and they choose their own password. Someone who is not a contact yet becomes one when they accept.
        </p>

        {sent && (
          <Alert variant="success" title={`Invitation sent to ${sent.email}`}>
            {sent.expiresAt && <>The link expires on {formatDate(sent.expiresAt)}. </>}
            {sent.inviteLink && (
              <span className="mt-2 block">
                If the email does not arrive, send them this link yourself. Share it only with {sent.email}.
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <Input readOnly value={sent.inviteLink} aria-label="Invitation link" className="min-w-0 flex-1" onFocus={(event) => event.target.select()} />
                  <Button type="button" size="sm" variant="outline" onClick={() => copyLink(sent.inviteLink)}>
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                </span>
              </span>
            )}
          </Alert>
        )}

        {invite.isError && (
          <Alert variant="error" title="The invitation was not sent">
            {invite.error?.status === 400 && invite.error?.message ? `${invite.error.message}.` : 'Try again in a moment.'}
          </Alert>
        )}

        <section aria-labelledby="portal-contacts-heading" className="space-y-2">
          <h3 id="portal-contacts-heading" className="font-semibold text-foreground">Contacts</h3>
          {contactsWithEmail.length > 0 ? (
            <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
              {contactsWithEmail.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground break-words">{contact.name}</span>
                    <span className="block text-muted-foreground break-all">{contact.email}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={pendingEmail === contact.email}
                    disabled={invite.isPending}
                    aria-label={`Invite ${contact.name} (${contact.email}) to the portal`}
                    onClick={() => send(contact.email)}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" /> Invite
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">This client has no contacts with an email address yet.</p>
          )}
        </section>

        <form
          noValidate
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(email);
          }}
        >
          <Field label="Invite someone else" hint="Use the address they will sign in with." error={emailError || undefined}>
            <Input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={invite.isPending} />
          </Field>
          <Button type="submit" size="sm" loading={invite.isPending && pendingEmail === email.trim()} disabled={invite.isPending}>
            Send invitation
          </Button>
        </form>
      </div>
    </Modal>
  );
}
