export const VERSION = "0.1.0";

export interface ServerConfig {
  dataDir: string;
  maxUploadMb: number;
  /** undefined = auto: Secure cookie when the request arrived over https (direct or X-Forwarded-Proto). */
  cookieSecure?: boolean;
  /** Extra origins allowed for credentialed CORS and the CSRF Origin check (dev only). */
  devOrigins: string[];
  version: string;
  /** Headless first-admin provisioning (applied at boot only while no users exist). */
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const cookieSecure =
    env.COOKIE_SECURE === undefined ? undefined : ["1", "true", "yes"].includes(env.COOKIE_SECURE.toLowerCase());
  const dev = env.NODE_ENV !== "production";
  return {
    dataDir: env.DATA_DIR ?? "./data",
    maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 50),
    cookieSecure,
    devOrigins: dev ? ["http://localhost:8081", "http://127.0.0.1:8081"] : [],
    version: VERSION,
    adminEmail: env.TEMUJIRA_ADMIN_EMAIL,
    adminPassword: env.TEMUJIRA_ADMIN_PASSWORD,
    adminName: env.TEMUJIRA_ADMIN_NAME,
  };
}
