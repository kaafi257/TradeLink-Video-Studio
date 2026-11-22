import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './roles';

interface MfaState {
  hasVerifiedFactor: boolean;
  level: 'aal1' | 'aal2' | null;
}

interface AuthValue {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  mfa: MfaState;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const emptyMfa: MfaState = { hasVerifiedFactor: false, level: null };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mfa, setMfa] = useState<MfaState>(emptyMfa);

  const loadFor = useCallback(async (s: Session | null) => {
    if (!supabase || !s) {
      setProfile(null);
      setMfa(emptyMfa);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, active')
      .eq('id', s.user.id)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);

    const factors = await supabase.auth.mfa.listFactors();
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setMfa({
      hasVerifiedFactor: (factors.data?.totp?.length ?? 0) > 0,
      level: aal.data?.currentLevel ?? null,
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await loadFor(data.session);
      if (!cancelled) setLoading(false);
    });
    // Do not await other Supabase calls inside this callback (it can deadlock); defer instead.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setTimeout(() => {
        void loadFor(s);
      }, 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadFor]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return false;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return !error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setMfa(emptyMfa);
  }, []);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadFor(data.session);
  }, [loadFor]);

  const value = useMemo(
    () => ({ loading, session, profile, mfa, signIn, signOut, reload }),
    [loading, session, profile, mfa, signIn, signOut, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
