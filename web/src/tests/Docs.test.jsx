import { describe, expect, it } from 'vitest';
import { flattenNoteHierarchy } from '../pages/Docs';

describe('Docs hierarchy', () => {
  it('orders nested documents by parent without losing orphaned or cyclic legacy rows', () => {
    const notes = [
      { id: 'child', title: 'Child', parentId: 'root' },
      { id: 'root', title: 'Root', parentId: null },
      { id: 'orphan', title: 'Orphan', parentId: 'missing' },
      { id: 'cycle-a', title: 'Cycle A', parentId: 'cycle-b' },
      { id: 'cycle-b', title: 'Cycle B', parentId: 'cycle-a' },
    ];
    const result = flattenNoteHierarchy(notes);
    expect(result.map(({ note }) => note.id)).toEqual(['orphan', 'root', 'child', 'cycle-a', 'cycle-b']);
    expect(result.find(({ note }) => note.id === 'child').depth).toBe(1);
    expect(new Set(result.map(({ note }) => note.id)).size).toBe(notes.length);
  });
});
