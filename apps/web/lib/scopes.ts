import type { User } from '@temujira/client';
import type { ScopeId } from '@temujira/shared';

/** Admins implicitly hold every scope; members hold exactly their assigned list. */
export function hasScope(user: User | null | undefined, scope: ScopeId): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.scopes.includes(scope);
}
