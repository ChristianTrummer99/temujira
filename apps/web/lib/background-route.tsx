import * as React from 'react';
import { useGlobalSearchParams, usePathname } from 'expo-router';

type BackgroundRoute = { pathname: string; params: { key?: string; num?: string } };
const Context = React.createContext<BackgroundRoute>({ pathname: '/', params: {} });

/** Keep the shell's navigation and breadcrumbs on the screen below a ticket tray. */
export function BackgroundRouteProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ key?: string; num?: string }>();
  const background = React.useRef<BackgroundRoute>({ pathname: '/', params: {} });
  if (!/^\/w\/[^/]+\/t\/[^/]+\/?$/.test(pathname)) {
    background.current = { pathname, params: { ...params } };
  }
  return <Context.Provider value={background.current}>{children}</Context.Provider>;
}

export const useBackgroundRoute = () => React.useContext(Context);
