import { parseEnv } from "./lib/env.server.ts";
import { createLogger } from "./lib/logger.server.ts";

// Fails fast at startup with a list of problems (never secret values).
export const env = parseEnv(process.env);
export const logger = createLogger({ level: env.logLevel });
