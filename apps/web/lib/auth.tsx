import { TemujiraClient, type User } from '@temujira/client';
import * as React from 'react';
import { Platform } from 'react-native';
import { createClient } from './api';

/**
 * Native-only session token, kept in memory (no secure storage wrapper wired yet).
 * On web the session is an HttpOnly cookie the browser sends with every request, so we
 * deliberately never persist a session token in localStorage — that would hand any XSS
 * a live, cookie-equivalent credential.
 */
let memToken: string | null = null;

const IS_WEB = Platform.OS === 'web';

function setClientToken(client: TemujiraClient, token: string | null | undefined) {
  memToken = token ?? null;
  client.setToken(token ?? undefined);
}

export interface AuthState {
  client: TemujiraClient;
  /** null while we're still determining whether a stored session is valid. */
  loading: boolean;
  user: User | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
  /** Adopt an already-issued session token + user (used after setup). */
  setSession: (token: string, user: User) => void;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(() => createClient(), []);
  const [loading, setLoading] = React.useState(true);
  const [user, setUser] = React.useState<User | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const applyUser = React.useCallback((u: User) => {
    setUser(u);
    setError(null);
  }, []);

  const clearSession = React.useCallback(() => {
    setClientToken(client, null);
    setUser(null);
  }, [client]);

  // On mount, restore the existing session. Web reuses the HttpOnly cookie (no stored
  // token); native restores the in-memory bearer token and validates it against /auth/me.
  React.useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (IS_WEB) {
        try {
          const { user: me } = await client.me();
          if (!cancelled) applyUser(me);
        } catch {
          // No valid cookie session — stay logged out.
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }
      if (!memToken) {
        if (!cancelled) setLoading(false);
        return;
      }
      client.setToken(memToken);
      try {
        const { user: me } = await client.me();
        if (!cancelled) applyUser(me);
      } catch {
        // Expired/revoked session — drop it.
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const { user: u, token } = await client.login({ email, password });
        if (!IS_WEB) setClientToken(client, token);
        applyUser(u);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed');
        throw e;
      }
    },
    [client, applyUser]
  );

  const logout = React.useCallback(async () => {
    try {
      await client.logout();
    } catch {
      // ignore — we clear the local session regardless
    } finally {
      clearSession();
    }
  }, [client, clearSession]);

  const refresh = React.useCallback(async () => {
    try {
      const { user: u } = await client.me();
      applyUser(u);
    } catch {
      clearSession();
    }
  }, [client, applyUser, clearSession]);

  const setSession = React.useCallback(
    (token: string, u: User) => {
      if (!IS_WEB) setClientToken(client, token);
      applyUser(u);
    },
    [client, applyUser]
  );

  const value = React.useMemo<AuthState>(
    () => ({
      client,
      loading,
      user,
      error,
      login,
      logout,
      refresh,
      setUser: applyUser,
      setSession,
    }),
    [client, loading, user, error, login, logout, refresh, applyUser, setSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
