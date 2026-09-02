import { TemujiraClient } from '@temujira/client';
import { Platform } from 'react-native';

/**
 * The single shared API client instance used by every screen.
 *
 * - Web (production): same-origin relative `/api/v1` — works on any domain the server
 *   serves the static bundle from. No base URL needed.
 * - Dev / native: override with EXPO_PUBLIC_API_URL (e.g. http://localhost:3000).
 *
 * On web the session is an HttpOnly cookie managed by the browser, so the client sends
 * credentials instead of a Bearer token (the token is never stored in localStorage).
 * On native the session is a Bearer token kept in memory.
 */
export function createClient(): TemujiraClient {
  return new TemujiraClient({
    baseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    useCookies: Platform.OS === 'web',
  });
}
