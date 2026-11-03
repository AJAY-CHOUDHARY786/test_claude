/**
 * Environment validation. Pure function: pass in process.env.
 * Error messages name the variable, never its value, so secrets cannot leak into logs.
 */
export type NodeEnv = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type EnvSource = Record<string, string | undefined>;

export interface AppEnv {
  nodeEnv: NodeEnv;
  shopifyApiKey: string;
  shopifyApiSecret: string;
  scopes: string[];
  appUrl: string;
  databaseUrl: string;
  logLevel: LogLevel;
  appHandle: string | null;
  email: { mode: "sink" | "resend"; from: string | null; resendApiKey: string | null; webhookSecret: string | null };
  storage: null | { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; publicBaseUrl: string };
}

export class EnvError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid environment configuration: ${problems.join("; ")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

const NODE_ENVS: readonly string[] = ["development", "test", "production"];
const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];
const SCOPE_PATTERN = /^[a-z][a-z0-9_]*$/;

export function parseEnv(source: EnvSource): AppEnv {
  const problems: string[] = [];
  const get = (key: string): string | undefined => {
    const value = source[key]?.trim();
    return value ? value : undefined;
  };
  const required = (key: string): string => {
    const value = get(key);
    if (!value) problems.push(`${key} is missing`);
    return value ?? "";
  };

  const rawNodeEnv = get("NODE_ENV") ?? "development";
  if (!NODE_ENVS.includes(rawNodeEnv)) problems.push("NODE_ENV must be development, test or production");
  const nodeEnv = (NODE_ENVS.includes(rawNodeEnv) ? rawNodeEnv : "development") as NodeEnv;

  const rawLogLevel = get("LOG_LEVEL") ?? "info";
  if (!LOG_LEVELS.includes(rawLogLevel)) problems.push("LOG_LEVEL must be debug, info, warn or error");
  const logLevel = (LOG_LEVELS.includes(rawLogLevel) ? rawLogLevel : "info") as LogLevel;

  const shopifyApiKey = required("SHOPIFY_API_KEY");
  const shopifyApiSecret = required("SHOPIFY_API_SECRET");

  const rawScopes = required("SCOPES");
  const scopes = rawScopes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawScopes && scopes.length === 0) problems.push("SCOPES must list at least one scope");
  if (scopes.some((s) => !SCOPE_PATTERN.test(s))) problems.push("SCOPES contains an invalid scope name");

  let appUrl = required("SHOPIFY_APP_URL");
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      if (nodeEnv === "production" && parsed.protocol !== "https:") {
        problems.push("SHOPIFY_APP_URL must use https in production");
      }
      appUrl = appUrl.replace(/\/+$/, "");
    } catch {
      problems.push("SHOPIFY_APP_URL is not a valid URL");
    }
  }

  const databaseUrl = required("DATABASE_URL");
  if (databaseUrl && !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    problems.push("DATABASE_URL must start with postgresql://");
  }

  // Email: real sending is off unless EMAIL_MODE=resend is set on purpose.
  const emailMode = get("EMAIL_MODE") ?? "sink";
  if (emailMode !== "sink" && emailMode !== "resend") problems.push("EMAIL_MODE must be sink or resend");
  const emailFrom = get("EMAIL_FROM") ?? null;
  const resendApiKey = get("RESEND_API_KEY") ?? null;
  if (emailMode === "resend" && (!emailFrom || !resendApiKey)) problems.push("EMAIL_FROM and RESEND_API_KEY are required when EMAIL_MODE=resend");

  // Storage: photo uploads stay disabled until all S3 variables are set.
  const s3Keys = ["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL"];
  const s3Present = s3Keys.filter((k) => get(k));
  let storage: AppEnv["storage"] = null;
  if (s3Present.length > 0 && s3Present.length < s3Keys.length) {
    problems.push(`Incomplete storage configuration: set all of ${s3Keys.join(", ")} or none`);
  } else if (s3Present.length === s3Keys.length) {
    storage = {
      endpoint: get("S3_ENDPOINT")!, bucket: get("S3_BUCKET")!, region: get("S3_REGION")!,
      accessKeyId: get("S3_ACCESS_KEY_ID")!, secretAccessKey: get("S3_SECRET_ACCESS_KEY")!,
      publicBaseUrl: get("S3_PUBLIC_BASE_URL")!.replace(/\/+$/, ""),
    };
  }

  if (problems.length > 0) throw new EnvError(problems);
  return {
    nodeEnv, shopifyApiKey, shopifyApiSecret, scopes, appUrl, databaseUrl, logLevel,
    appHandle: get("SHOPIFY_APP_HANDLE") ?? null,
    email: { mode: emailMode as "sink" | "resend", from: emailFrom, resendApiKey, webhookSecret: get("RESEND_WEBHOOK_SECRET") ?? null },
    storage,
  };
}
