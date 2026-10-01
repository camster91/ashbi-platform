/**
 * Schedule event chips put status-token text on a tint of the same token.
 * At /20, text-destructive is only ~4.35:1 on the dark card (and ~4.3:1 on
 * the light background); at /10 every event type clears 5:1 in both themes.
 * Dimming that text with opacity drops it well below AA, so it must not.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

describe('Schedule event contrast', () => {
  it('uses a /10 tint behind every event type', () => {
    const types = source.match(/const EVENT_TYPES = \[([\s\S]*?)\];/)[1];
    const tints = [...types.matchAll(/bg: 'bg-(\w+)\/(\d+)'/g)];
    expect(tints).toHaveLength(4);
    for (const [, token, alpha] of tints) expect(`${token}/${alpha}`).toBe(`${token}/10`);
  });

  it('never dims event text with opacity', () => {
    expect(source).not.toMatch(/style\.text,\s*'opacity-\d+'/);
  });
});
