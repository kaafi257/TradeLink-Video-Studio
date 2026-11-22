import { describe, expect, it } from 'vitest';
import { canEditSettings, isMember, needsMfa, type Profile } from './roles';

const p = (role: Profile['role'], active: boolean): Profile => ({
  id: '00000000-0000-0000-0000-000000000000',
  full_name: null,
  role,
  active,
});

describe('roles', () => {
  it('treats inactive or missing profiles as non-members', () => {
    expect(isMember(null)).toBe(false);
    expect(isMember(p('owner', false))).toBe(false);
    expect(isMember(p('viewer', true))).toBe(true);
  });
  it('only an active owner can edit settings', () => {
    expect(canEditSettings(p('owner', true))).toBe(true);
    expect(canEditSettings(p('owner', false))).toBe(false);
    expect(canEditSettings(p('editor', true))).toBe(false);
    expect(canEditSettings(p('viewer', true))).toBe(false);
    expect(canEditSettings(null)).toBe(false);
  });
  it('only an active owner is forced through MFA', () => {
    expect(needsMfa(p('owner', true))).toBe(true);
    expect(needsMfa(p('editor', true))).toBe(false);
    expect(needsMfa(p('owner', false))).toBe(false);
  });
});
