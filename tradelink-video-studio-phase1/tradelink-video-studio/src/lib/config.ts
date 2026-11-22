// Pure configuration checks (no browser or network code) so they can be unit tested.

// The TradeLink marketplace's Supabase project. The Studio must NEVER point at it.
export const FORBIDDEN_PROJECT_REFS: readonly string[] = ['gqjdferuonclqgpugxjr'];

export type ConfigCheck = { ok: true; url: string; key: string } | { ok: false; reason: string };

export function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    const payload: unknown = JSON.parse(atob(padded));
    if (payload && typeof payload === 'object' && 'role' in payload) {
      const role = (payload as { role: unknown }).role;
      return typeof role === 'string' ? role : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function checkStudioConfig(
  url: string | undefined,
  key: string | undefined,
): ConfigCheck {
  if (!url) return { ok: false, reason: 'VITE_STUDIO_SUPABASE_URL is missing.' };
  if (!key) return { ok: false, reason: 'VITE_STUDIO_SUPABASE_PUBLISHABLE_KEY is missing.' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'The Studio project address is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'The Studio project address must use https.' };
  }
  if (!parsed.hostname.endsWith('.supabase.co')) {
    return { ok: false, reason: 'The Studio project address must be a supabase.co address.' };
  }
  const ref = parsed.hostname.split('.')[0] ?? '';
  if (FORBIDDEN_PROJECT_REFS.includes(ref)) {
    return { ok: false, reason: 'This address belongs to the marketplace project. Refusing to start.' };
  }

  if (key.startsWith('sb_secret_')) {
    return { ok: false, reason: 'A secret key was supplied. Use the publishable key only.' };
  }
  if (key.startsWith('sb_publishable_')) {
    return { ok: true, url: parsed.origin, key };
  }
  const role = jwtRole(key);
  if (role === 'anon') return { ok: true, url: parsed.origin, key };
  if (role === 'service_role') {
    return { ok: false, reason: 'A service-role key was supplied. Refusing to start.' };
  }
  return { ok: false, reason: 'The key is not a recognised publishable (public) key.' };
}
