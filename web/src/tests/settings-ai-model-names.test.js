import { describe, expect, it } from 'vitest';
import { toModelNames } from '../pages/Settings.jsx';

describe('AI model picker values', () => {
  it('uses model names, not array positions, from the live model list', () => {
    expect(toModelNames(['gemma4:31b', 'qwen3:32b-cloud'])).toEqual(['gemma4:31b', 'qwen3:32b-cloud']);
  });

  it('uses the model names, not the keys, of the known-model map', () => {
    expect(toModelNames({ DEFAULT: 'gemma4:31b' })).toEqual(['gemma4:31b']);
  });

  it('ignores missing and malformed entries', () => {
    expect(toModelNames(undefined)).toEqual([]);
    expect(toModelNames([null, '', 42, 'gemma4:31b'])).toEqual(['gemma4:31b']);
  });
});
