import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import NoteAudience from '../components/NoteAudience';
import { api } from '../lib/api';
vi.mock('../lib/api',()=>({api:{getNoteAccess:vi.fn(),getTeam:vi.fn(),saveNoteAccess:vi.fn()}}));
it('retains sharing drafts and their original revision through a conflict, refetch and failed reload',async()=>{
 let current={noteId:'note',ownerId:'owner',revision:4,mode:'TEAM',members:[]};api.getNoteAccess.mockImplementation(async()=>current);api.getTeam.mockResolvedValue([{id:'member',name:'Bianca',role:'TEAM',isActive:true}]);api.saveNoteAccess.mockRejectedValue(new Error('Document access changed'));
 const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={cache}><NoteAudience noteId="note"/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Manage document sharing'}));fireEvent.change(await screen.findByLabelText('Audience'),{target:{value:'RESTRICTED'}});
 fireEvent.change(await screen.findByLabelText('Add teammate'),{target:{value:'member'}});fireEvent.click(screen.getByRole('button',{name:'Add teammate',exact:true}));
 current={...current,revision:5};await cache.invalidateQueries({queryKey:['note-access','note']});fireEvent.click(screen.getByRole('button',{name:'Save sharing'}));await screen.findByText(/Document access changed/);
 expect(api.saveNoteAccess).toHaveBeenCalledWith('note',{revision:4,mode:'RESTRICTED',members:[{userId:'member',role:'READ'}]});api.getNoteAccess.mockRejectedValueOnce(new Error('Offline'));fireEvent.click(screen.getByRole('button',{name:'Discard sharing draft and reload'}));await screen.findByText(/Offline/);expect(screen.getByLabelText('Audience')).toHaveValue('RESTRICTED');
 fireEvent.click(screen.getByRole('button',{name:'Discard sharing draft and reload'}));await waitFor(()=>expect(screen.getByLabelText('Audience')).toHaveValue('TEAM'));
});
