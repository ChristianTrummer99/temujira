import { TemujiraClient, type User } from '@temujira/client';
import * as React from 'react';
import { Platform } from 'react-native';
import { createClient } from './api';

/**
 * Token persistence. Web/native-safe: use globalThis.localStorage when available
 * (React Native Web provides it on web; native falls back to an in-memory map).
 */
const STORAGE_KEY = 'temujira.session_token';

function readStoredToken(): string | null {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY);
    }
    // Native: no synchronous storage wrapper wired yet; keep token in memory.
    return memToken;
  } catch {
    return null;
  }
}

let memToken: string | null = null;

function writeStoredToken(token: string | null) {
  memToken = token;
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem(STORAGE_KEY, token);
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
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

  const applyUser = React.useCallback(
    (u: User) => {
      setUser(u);
      setError(null);
    },
    [],
  );

  const clearSession = React.useCallback(() => {
    client.setToken(undefined);
    writeStoredToken(null);
    setUser(null);
  }, [client]);

  // On mount, restore a stored token and validate it against /auth/me.
  React.useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const stored = readStoredToken();
      if (!stored) {
        if (!cancelled) setLoading(false);
        return;
      }
      client.setToken(stored);
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
        client.setToken(token);
        writeStoredToken(token);
        applyUser(u);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed');
        throw e;
      }
    },
    [client, applyUser],
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
      client.setToken(token);
      writeStoredToken(token);
      applyUser(u);
    },
    [client, applyUser],
  );

  const value = React.useMemo<AuthState>(
    () => ({ client, loading, user, error, login, logout, refresh, setUser: applyUser, setSession }),
    [client, loading, user, error, login, logout, refresh, applyUser, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
