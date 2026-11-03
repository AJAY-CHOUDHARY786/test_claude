import { startWorker } from "./worker.server.ts";
import { logger } from "../config.server.ts";

const stop = startWorker();
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => { logger.info("Worker stopping", { signal: sig }); stop(); setTimeout(() => process.exit(0), 1000); });
}
