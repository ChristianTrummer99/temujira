import { SetupInputSchema } from "@temujira/shared";

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
  /** Absolute/relative directory of the statically-exported Expo web app (served with SPA fallback). */
  webDist?: string;
}

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const dev = env.NODE_ENV !== "production";
  const admin = adminFromEnv(env);
  return {
    dataDir: env.DATA_DIR ?? "./data",
    maxUploadMb: positiveNumber(env.MAX_UPLOAD_MB, "MAX_UPLOAD_MB", 50),
    cookieSecure: cookieSecureFromEnv(env.COOKIE_SECURE),
    devOrigins: dev ? ["http://localhost:8081", "http://127.0.0.1:8081"] : [],
    version: VERSION,
    ...admin,
    webDist: env.WEB_DIST,
  };
}

function cookieSecureFromEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "" || raw.toLowerCase() === "auto")
    return undefined;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new Error("COOKIE_SECURE must be auto, 1/true/yes, or 0/false/no");
}

function positiveNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function adminFromEnv(
  env: NodeJS.ProcessEnv,
): Pick<ServerConfig, "adminEmail" | "adminPassword" | "adminName"> {
  const email = env.TEMUJIRA_ADMIN_EMAIL;
  const password = env.TEMUJIRA_ADMIN_PASSWORD;
  if (!email && !password) return {};
  if (!email || !password) {
    throw new Error(
      "TEMUJIRA_ADMIN_EMAIL and TEMUJIRA_ADMIN_PASSWORD must be set together",
    );
  }
  const parsed = SetupInputSchema.safeParse({
    email,
    password,
    name: env.TEMUJIRA_ADMIN_NAME ?? "Admin",
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid TEMUJIRA_ADMIN_* configuration: ${details}`);
  }
  return {
    adminEmail: parsed.data.email,
    adminPassword: parsed.data.password,
    adminName: parsed.data.name,
  };
}
