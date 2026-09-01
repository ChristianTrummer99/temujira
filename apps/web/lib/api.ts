import { TemujiraClient } from '@temujira/client';

/**
 * The single shared API client instance used by every screen.
 *
 * - Web (production): same-origin relative `/api/v1` — works on any domain the server
 *   serves the static bundle from. No base URL needed.
 * - Dev / native: override with EXPO_PUBLIC_API_URL (e.g. http://localhost:3000).
 *
 * Auth is Bearer-token based, so it works identically on web and native.
 */
export function createClient(): TemujiraClient {
  return new TemujiraClient({
    baseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  });
}
