export type AppRole = 'owner' | 'editor' | 'viewer';

export interface Profile {
  id: string;
  full_name: string | null;
  role: AppRole;
  active: boolean;
}

export function isMember(profile: Profile | null): profile is Profile {
  return profile !== null && profile.active;
}

export function canEditSettings(profile: Profile | null): boolean {
  return isMember(profile) && profile.role === 'owner';
}

// Owners must use an authenticator app. Editors and viewers are not forced in Phase 1.
export function needsMfa(profile: Profile | null): boolean {
  return isMember(profile) && profile.role === 'owner';
}
