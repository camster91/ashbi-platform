import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function NoteAudience({ noteId }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [memberId, setMemberId] = useState('');
  const [memberRole, setMemberRole] = useState('READ');
  const queryClient = useQueryClient();
  const access = useQuery({ queryKey: ['note-access', noteId], queryFn: () => api.getNoteAccess(noteId), enabled: open });
  const team = useQuery({ queryKey: ['team'], queryFn: api.getTeam, enabled: open });
  const save = useMutation({ mutationFn: data => api.saveNoteAccess(noteId, data), onSuccess: data => { setDraft(null); queryClient.setQueryData(['note-access', noteId], data); queryClient.invalidateQueries({ queryKey: ['all-notes'] }); } });
  const current = draft || access.data;
  const people = (Array.isArray(team.data) ? team.data : team.data?.members || []).filter(row => row.isActive !== false && ['ADMIN', 'TEAM'].includes(row.role) && row.id !== current?.ownerId);
  return <section className="mt-3 space-y-2 rounded border border-border p-3" aria-label="Document sharing">
    <button type="button" className="min-h-11 rounded px-2 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setOpen(value => !value)} aria-expanded={open}>Manage document sharing</button>
    {open && <>
      {access.isPending && <p role="status">Loading sharing…</p>}
      {access.isError && <p role="alert">{access.error.message} <button type="button" onClick={() => access.refetch()}>Reload sharing</button></p>}
      {current && <form className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate({ revision: current.revision, mode: current.mode, members: current.members.map(({ userId, role }) => ({ userId, role })) }); }}>
        <label className="block">Audience
          <select className="block min-h-11 w-full rounded border border-border bg-background px-2" value={current.mode} onChange={event => setDraft({ ...current, mode: event.target.value })} disabled={save.isPending}>
            <option value="TEAM">Ashbi team</option><option value="RESTRICTED">Selected teammates</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">The owner and active organization administrators retain access. Parent and preserved inherited restrictions still apply. Changing this audience can change access to nested documents.</p>
        {current.members.map(member => <div className="flex flex-wrap items-center gap-2" key={member.userId}>
          <span>{member.name || people.find(person => person.id === member.userId)?.name || 'Unavailable teammate'}{member.isActive === false ? ' (inactive)' : ''}</span>
          <select aria-label={`Access for ${member.name || 'teammate'}`} className="min-h-11 rounded border border-border bg-background px-2" value={member.role} disabled={save.isPending || member.isActive === false} onChange={event => setDraft({ ...current, members: current.members.map(row => row.userId === member.userId ? { ...row, role: event.target.value } : row) })}><option value="READ">Can read</option><option value="EDIT">Can edit</option></select>
          <button type="button" className="min-h-11 rounded px-2" disabled={save.isPending} onClick={() => setDraft({ ...current, members: current.members.filter(row => row.userId !== member.userId) })}>Remove {member.name || 'teammate'}</button>
        </div>)}
        {team.isError && <p role="alert">Teammates could not load. Your sharing draft is retained. <button type="button" onClick={() => team.refetch()}>Retry teammates</button></p>}
        <label className="block">Add teammate<select className="block min-h-11 w-full rounded border border-border bg-background px-2" value={memberId} onChange={event => setMemberId(event.target.value)} disabled={team.isPending || team.isError || save.isPending}><option value="">Choose teammate</option>{people.filter(row => !current.members.some(member => member.userId === row.id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <select aria-label="New teammate access" className="min-h-11 rounded border border-border bg-background px-2" value={memberRole} onChange={event => setMemberRole(event.target.value)} disabled={save.isPending}><option value="READ">Can read</option><option value="EDIT">Can edit</option></select>
        <button type="button" className="min-h-11 rounded px-2" disabled={!memberId || save.isPending || current.members.length >= 100} onClick={() => { setDraft({ ...current, members: [...current.members, { userId: memberId, role: memberRole, name: people.find(row => row.id === memberId)?.name }] }); setMemberId(''); }}>Add teammate</button>
        {save.isError && <p role="alert">{save.error.message} Your draft is retained. <button type="button" onClick={async () => { const result = await access.refetch(); if (!result.isError) { setDraft(null); save.reset(); } }}>Discard sharing draft and reload</button></p>}
        {save.isSuccess && !draft && <p role="status">Sharing saved</p>}
        <button type="submit" className="min-h-11 rounded bg-primary px-3 text-primary-foreground" disabled={!draft || save.isPending}>Save sharing</button>
      </form>}
    </>}
  </section>;
}
