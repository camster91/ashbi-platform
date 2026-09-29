import { describe, expect, it } from 'vitest';
import { applyChatDelete, applyChatEdit } from '../lib/chat-thread-cache';

const threads = () => [
  { id: 't1', content: 'first', replies: [{ id: 'r1', content: 'reply one' }, { id: 'r2', content: 'reply two' }] },
  { id: 't2', content: 'second', replies: [] },
];

describe('chat thread cache', () => {
  it('applies an edit to a nested reply', () => {
    const next = applyChatEdit(threads(), { id: 'r2', content: 'edited reply', isEdited: true });
    expect(next[0].replies[1]).toMatchObject({ id: 'r2', content: 'edited reply', isEdited: true });
    expect(next[0].replies[0].content).toBe('reply one');
  });

  it('applies an edit to a thread and keeps its replies', () => {
    const next = applyChatEdit(threads(), { id: 't1', content: 'edited first' });
    expect(next[0].content).toBe('edited first');
    expect(next[0].replies).toHaveLength(2);
  });

  it('removes a deleted nested reply and a deleted thread', () => {
    expect(applyChatDelete(threads(), 'r1')[0].replies.map((r) => r.id)).toEqual(['r2']);
    expect(applyChatDelete(threads(), 't2').map((t) => t.id)).toEqual(['t1']);
  });

  it('leaves unrelated threads untouched', () => {
    const before = threads();
    const next = applyChatEdit(before, { id: 'r1', content: 'x' });
    expect(next[1]).toBe(before[1]);
  });
  it('keeps replyCount in step when a reply is deleted', () => {
    const windowed = [{ id: 't1', replyCount: 2, replies: [{ id: 'r1' }, { id: 'r2' }] }];
    const next = applyChatDelete(windowed, 'r2');
    expect(next[0].replies).toHaveLength(1);
    expect(next[0].replyCount).toBe(1);
    expect(next[0].replyCount > next[0].replies.length).toBe(false);
  });
});
