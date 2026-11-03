/**
 * Structured JSON logger with secret redaction.
 * Sensitive keys and token-like strings are masked before anything is written.
 */
import type { LogLevel } from "./env.server.ts";

export const REDACTED = "[REDACTED]";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key|email|phone/i;
const SHOPIFY_TOKEN = /\bshp(?:at|ca|ss|pa)_[A-Za-z0-9]{8,}\b/g;
const DB_URL_PASSWORD = /(postgres(?:ql)?:\/\/[^:\/\s@]+:)[^@\s]+(@)/gi;
const MAX_DEPTH = 6;

function redactString(value: string): string {
  return value.replace(SHOPIFY_TOKEN, REDACTED).replace(DB_URL_PASSWORD, `$1${REDACTED}$2`);
}

export function redact(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, seen, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
  now?: () => Date;
  bindings?: Record<string, unknown>;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const write = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const emit = (lvl: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const body = redact({ ...bindings, ...fields }) as Record<string, unknown>;
    // Reserved keys are written last so callers cannot overwrite them.
    write(JSON.stringify({ ...body, time: now().toISOString(), level: lvl, msg: redactString(msg) }));
  };

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger({ level, write, now, bindings: { ...bindings, ...extra } }),
  };
}
