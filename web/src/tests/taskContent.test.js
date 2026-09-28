import { describe, expect, it } from 'vitest';
import { normalizeTaskBlocks } from '../lib/taskContent';

describe('normalizeTaskBlocks', () => {
  it('keeps block arrays and coerces block content to strings', () => {
    expect(normalizeTaskBlocks([
      { type: 'heading1', content: 'Brief' },
      { type: 'paragraph', content: null },
      { type: 'paragraph', content: 42 },
      { type: 'todo', checked: false },
    ])).toEqual([
      { type: 'heading1', content: 'Brief' },
      { type: 'paragraph', content: '' },
      { type: 'paragraph', content: '42' },
      { type: 'todo', checked: false, content: '' },
    ]);
  });

  it('turns non-array stored values into one paragraph with the original value', () => {
    expect(normalizeTaskBlocks(null)).toEqual([]);
    expect(normalizeTaskBlocks(undefined)).toEqual([]);
    expect(normalizeTaskBlocks('Plain notes')).toEqual([{ type: 'paragraph', content: 'Plain notes' }]);
    expect(normalizeTaskBlocks(12)).toEqual([{ type: 'paragraph', content: '12' }]);
    expect(normalizeTaskBlocks(false)).toEqual([{ type: 'paragraph', content: 'false' }]);
    expect(normalizeTaskBlocks({ brief: 'hero' })).toEqual([{ type: 'paragraph', content: '{"brief":"hero"}' }]);
  });

  it('keeps stray non-block array entries as paragraphs', () => {
    expect(normalizeTaskBlocks(['text', 3, null])).toEqual([
      { type: 'paragraph', content: 'text' },
      { type: 'paragraph', content: '3' },
      { type: 'paragraph', content: '' },
    ]);
  });
});
