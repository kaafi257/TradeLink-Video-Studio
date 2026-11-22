import { describe, expect, it } from 'vitest';
import { en } from './en';
import { am, AM_DRAFT } from './am';

describe('dictionaries', () => {
  it('Amharic has exactly the same keys as English', () => {
    expect(Object.keys(am).sort()).toEqual(Object.keys(en).sort());
  });
  it('no string is empty', () => {
    for (const v of Object.values(en)) expect(v.trim().length > 0).toBe(true);
    for (const v of Object.values(am)) expect(v.trim().length > 0).toBe(true);
  });
  it('Amharic stays flagged DRAFT until a native speaker approves it', () => {
    expect(AM_DRAFT).toBe(true);
  });
});
