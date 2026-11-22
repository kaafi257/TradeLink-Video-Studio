import { describe, expect, it } from 'vitest';
import { checkStudioConfig, jwtRole } from './config';

const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (role: string) => `${b64url({ alg: 'HS256' })}.${b64url({ role })}.signaturesignature`;

const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';

describe('checkStudioConfig', () => {
  it('accepts a publishable key', () => {
    const r = checkStudioConfig(URL_OK, 'sb_publishable_abcdefghijklmnop');
    expect(r.ok).toBe(true);
  });
  it('accepts a legacy anon key', () => {
    expect(checkStudioConfig(URL_OK, jwt('anon')).ok).toBe(true);
  });
  it('rejects missing values', () => {
    expect(checkStudioConfig(undefined, 'x').ok).toBe(false);
    expect(checkStudioConfig(URL_OK, undefined).ok).toBe(false);
  });
  it('rejects non-https and non-supabase addresses', () => {
    expect(checkStudioConfig('http://abc.supabase.co', 'sb_publishable_abcdefghij').ok).toBe(false);
    expect(checkStudioConfig('https://example.com', 'sb_publishable_abcdefghij').ok).toBe(false);
    expect(checkStudioConfig('not a url', 'sb_publishable_abcdefghij').ok).toBe(false);
  });
  it('refuses the marketplace project address', () => {
    const r = checkStudioConfig('https://gqjdferuonclqgpugxjr.supabase.co', 'sb_publishable_abcdefghij');
    expect(r.ok).toBe(false);
  });
  it('refuses secret and service-role keys', () => {
    expect(checkStudioConfig(URL_OK, `sb_${'secret'}_abcdefghijklmnop`).ok).toBe(false);
    expect(checkStudioConfig(URL_OK, jwt('service_role')).ok).toBe(false);
  });
  it('refuses unrecognised keys', () => {
    expect(checkStudioConfig(URL_OK, 'hello-world').ok).toBe(false);
    expect(checkStudioConfig(URL_OK, jwt('something_else')).ok).toBe(false);
  });
});

describe('jwtRole', () => {
  it('reads the role claim', () => {
    expect(jwtRole(jwt('anon'))).toBe('anon');
  });
  it('returns null for junk', () => {
    expect(jwtRole('abc')).toBe(null);
    expect(jwtRole('a.b.c')).toBe(null);
  });
});
